// ---------------------------------------------------------------------------
// embeddingIndex — in-browser semantic search via Transformers.js + HNSW
// ---------------------------------------------------------------------------
// Loads a small embedding model (default: all-MiniLM-L6-v2, ~23MB) via
// Transformers.js, plus pre-computed embedding vectors from a binary file.
// Queries are embedded at runtime and matched against the HNSW index from
// `memory/vectorIndex`.
//
// Usage:
//   const idx = embeddingIndex({
//     vectors: '/docs-embeddings.bin',
//     manifest: '/docs-embeddings.json',
//   });
//   subscribe(idx.loaded, ready => { if (ready) idx.search('reactive state') });
//   subscribe(idx.results, hits => console.log(hits));
//
// Peer dependency: @huggingface/transformers (dynamic import — not bundled).
// ---------------------------------------------------------------------------

import { batch, teardown } from "../../core/protocol";
import { state } from "../../core/state";
import type { Store } from "../../core/types";
import { vectorIndex as createVectorIndex } from "../../memory/vectorIndex";
import { latestAsync } from "../../raw/latestAsync";

export interface ScoredDoc {
	/** Document chunk ID (matches manifest keys). */
	id: string;
	/** Cosine similarity score (0–1, higher = more relevant). */
	score: number;
	/** Metadata from the manifest (title, source, tags, etc.). */
	metadata: Record<string, unknown>;
}

export interface EmbeddingManifestEntry {
	/** Document title. */
	title?: string;
	/** Origin file or section. */
	source?: string;
	/** Tags. */
	tags?: string[];
	/** Any additional metadata. */
	[key: string]: unknown;
}

/** Manifest maps document IDs to metadata, with a header for dimensions/count. */
export interface EmbeddingManifest {
	/** Embedding dimensions (must match model output). */
	dimensions: number;
	/** Number of vectors in the binary file. */
	count: number;
	/** Ordered list of document IDs (same order as binary vectors). */
	ids: string[];
	/** Metadata per document ID. */
	entries: Record<string, EmbeddingManifestEntry>;
}

/** @internal Embedding function signature — subset of Transformers.js pipeline output. */
export type EmbeddingPipeline = (
	texts: string | string[],
	options?: { pooling?: string; normalize?: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

export interface EmbeddingIndexOptions {
	/** HuggingFace model ID for embeddings. Default: 'Xenova/all-MiniLM-L6-v2' */
	model?: string;
	/** URL or path to pre-computed embeddings binary (Float32Array, row-major). */
	vectors: string | URL;
	/** URL or path to JSON manifest with document metadata + index info. */
	manifest: string | URL;
	/** Vector dimensions. If omitted, read from manifest. Default: 384 (MiniLM). */
	dimensions?: number;
	/** Maximum results per search. Default: 10 */
	limit?: number;
	/** Debug name for Inspector. */
	name?: string;
	/** Custom fetch implementation (for testing or edge runtimes). */
	fetch?: typeof globalThis.fetch;
	/** @internal Injected embedding function for testing — skips dynamic import of Transformers.js. */
	_embedFn?: EmbeddingPipeline;
}

export interface EmbeddingIndexResult {
	/** Embed the query and search for nearest neighbors. Updates `results` store. */
	search(query: string, k?: number): void;
	/** Reactive search results (empty array initially). */
	results: Store<ScoredDoc[]>;
	/** True once model + vectors are loaded and ready. */
	loaded: Store<boolean>;
	/** Last error from loading or searching, if any. */
	error: Store<unknown | undefined>;
	/** Tear down model and index resources. */
	destroy(): void;
}

/**
 * Create an in-browser semantic search index.
 *
 * Loads an embedding model via Transformers.js and pre-computed vectors
 * from a binary file. Queries are embedded at runtime and matched against
 * an HNSW index (from `memory/vectorIndex`).
 */
export function embeddingIndex(opts: EmbeddingIndexOptions): EmbeddingIndexResult {
	const modelId = opts.model ?? "Xenova/all-MiniLM-L6-v2";
	const vectorsUrl = typeof opts.vectors === "string" ? opts.vectors : opts.vectors.href;
	const manifestUrl = typeof opts.manifest === "string" ? opts.manifest : opts.manifest.href;
	const defaultLimit = opts.limit ?? 10;
	const fetchFn = opts.fetch ?? globalThis.fetch;

	// Reactive stores
	const results = state<ScoredDoc[]>([], { name: opts.name ? `${opts.name}.results` : undefined });
	const loaded = state(false, { name: opts.name ? `${opts.name}.loaded` : undefined });
	const error = state<unknown | undefined>(undefined, {
		name: opts.name ? `${opts.name}.error` : undefined,
	});

	// Internal state
	let embedFn: EmbeddingPipeline | null = opts._embedFn ?? null;
	let manifest: EmbeddingManifest | null = null;
	let index: ReturnType<typeof createVectorIndex> | null = null;
	let destroyed = false;

	// Stale-result guard: only deliver the result of the most recent search call
	const latestSearch = latestAsync(
		({ query, embedder }: { query: string; embedder: EmbeddingPipeline }) =>
			embedder(query, { pooling: "mean", normalize: true }),
	);

	// Kick off loading — skip model import if embed function injected
	if (opts._embedFn) {
		loadDataOnly();
	} else {
		load();
	}

	async function loadDataOnly(): Promise<void> {
		try {
			const [manifestData, vectorBytes] = await Promise.all([
				fetchFn(manifestUrl).then((res) => {
					if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status} ${res.statusText}`);
					return res.json() as Promise<EmbeddingManifest>;
				}),
				fetchFn(vectorsUrl).then((res) => {
					if (!res.ok) throw new Error(`Failed to fetch vectors: ${res.status} ${res.statusText}`);
					return res.arrayBuffer();
				}),
			]);

			if (destroyed) return;

			manifest = manifestData;
			buildIndex(vectorBytes);
		} catch (e) {
			if (!destroyed) {
				batch(() => {
					loaded.set(false);
					error.set(e);
				});
			}
		}
	}

	async function load(): Promise<void> {
		try {
			const [manifestData, vectorBytes, pipelineFn] = await Promise.all([
				fetchFn(manifestUrl).then((res) => {
					if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status} ${res.statusText}`);
					return res.json() as Promise<EmbeddingManifest>;
				}),
				fetchFn(vectorsUrl).then((res) => {
					if (!res.ok) throw new Error(`Failed to fetch vectors: ${res.status} ${res.statusText}`);
					return res.arrayBuffer();
				}),
				import("@huggingface/transformers").then((mod) => {
					const pipeline = mod.pipeline ?? mod.default?.pipeline;
					if (!pipeline)
						throw new Error("Could not find pipeline export from @huggingface/transformers");
					return pipeline("feature-extraction", modelId) as Promise<EmbeddingPipeline>;
				}),
			]);

			if (destroyed) return;

			manifest = manifestData;
			embedFn = pipelineFn;
			buildIndex(vectorBytes);
		} catch (e) {
			if (!destroyed) {
				batch(() => {
					loaded.set(false);
					error.set(e);
				});
			}
		}
	}

	function buildIndex(vectorBytes: ArrayBuffer): void {
		const dims = opts.dimensions ?? manifest!.dimensions ?? 384;
		const vectors = new Float32Array(vectorBytes);
		const expectedLength = manifest!.count * dims;

		if (vectors.length !== expectedLength) {
			throw new Error(
				`Vector binary size mismatch: expected ${expectedLength} floats (${manifest!.count} × ${dims}), got ${vectors.length}`,
			);
		}

		index = createVectorIndex({
			dimensions: dims,
			distance: "cosine",
		});

		for (let i = 0; i < manifest!.count; i++) {
			const id = manifest!.ids[i];
			const vec = vectors.subarray(i * dims, (i + 1) * dims);
			index.add(id, vec);
		}

		batch(() => {
			loaded.set(true);
			error.set(undefined);
		});
	}

	function search(query: string, k?: number): void {
		if (!embedFn || !index || !manifest || destroyed) {
			results.set([]);
			return;
		}

		if (!query.trim()) {
			batch(() => {
				results.set([]);
				error.set(undefined);
			});
			return;
		}

		const effectiveK = k ?? defaultLimit;
		const capturedIndex = index;
		const capturedManifest = manifest;

		// latestAsync discards stale results if a newer search() call overtakes this one
		latestSearch.call(
			{ query, embedder: embedFn },
			(output) => {
				if (destroyed) return;
				const hits = capturedIndex.search(output.data, effectiveK);

				// Convert distances to similarity scores (cosine distance → similarity)
				// Clamp to [0, 1] — cosine similarity can be negative for non-normalized vectors
				const scored: ScoredDoc[] = hits.map((hit) => ({
					id: hit.id,
					score: Math.max(0, Math.min(1, 1 - hit.distance)),
					metadata: capturedManifest.entries[hit.id] ?? {},
				}));

				batch(() => {
					results.set(scored);
					error.set(undefined);
				});
			},
			(e) => {
				if (!destroyed) {
					batch(() => {
						results.set([]);
						error.set(e);
					});
				}
			},
		);
	}

	function destroy(): void {
		destroyed = true;
		latestSearch.cancel(); // invalidate any in-flight search
		if (index) {
			index.destroy();
			index = null;
		}
		embedFn = null;
		manifest = null;
		batch(() => {
			loaded.set(false);
			results.set([]);
			error.set(undefined);
		});
		teardown(results);
		teardown(loaded);
		teardown(error);
	}

	return {
		search,
		results,
		loaded,
		error,
		destroy,
	};
}
