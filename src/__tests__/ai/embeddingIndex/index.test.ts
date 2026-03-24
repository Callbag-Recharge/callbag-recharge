import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingManifest, EmbeddingPipeline, ScoredDoc } from "../../../ai/embeddingIndex";
import { embeddingIndex } from "../../../ai/embeddingIndex";
import { subscribe } from "../../../core/subscribe";

// ---------------------------------------------------------------------------
// Test fixtures — no vi.mock needed, uses _embedFn injection
// ---------------------------------------------------------------------------

const DIMS = 4; // small dims for testing

let mockEmbed: ReturnType<typeof vi.fn>;

function makeManifest(count: number): EmbeddingManifest {
	const ids = Array.from({ length: count }, (_, i) => `doc-${i}`);
	const entries: Record<string, { title: string; source: string }> = {};
	for (const id of ids) {
		entries[id] = { title: `Title ${id}`, source: "test" };
	}
	return { dimensions: DIMS, count, ids, entries };
}

function makeVectorBinary(count: number, dims: number): ArrayBuffer {
	const arr = new Float32Array(count * dims);
	for (let i = 0; i < count; i++) {
		for (let d = 0; d < dims; d++) {
			arr[i * dims + d] = d === i % dims ? 1.0 : 0.0;
		}
	}
	return arr.buffer;
}

function mockFetchForIndex(
	manifest: EmbeddingManifest,
	vectorBuf: ArrayBuffer,
): typeof globalThis.fetch {
	return vi.fn().mockImplementation((url: string) => {
		if (url.includes("manifest") || url.includes(".json")) {
			return Promise.resolve(
				new Response(JSON.stringify(manifest), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		}
		if (url.includes("vectors") || url.includes(".bin")) {
			return Promise.resolve(new Response(vectorBuf, { status: 200 }));
		}
		return Promise.resolve(new Response(null, { status: 404 }));
	}) as any;
}

let currentIdx: ReturnType<typeof embeddingIndex> | null = null;

beforeEach(() => {
	mockEmbed = vi.fn();
	// Default: return a unit vector along dim 0
	mockEmbed.mockResolvedValue({
		data: new Float32Array([1, 0, 0, 0]),
		dims: [1, DIMS],
	});
});

afterEach(() => {
	if (currentIdx) {
		currentIdx.destroy();
		currentIdx = null;
	}
});

describe("embeddingIndex", () => {
	it("sets loaded=true after data load", async () => {
		const manifest = makeManifest(3);
		const vectors = makeVectorBinary(3, DIMS);

		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			dimensions: DIMS,
			fetch: mockFetchForIndex(manifest, vectors),
			_embedFn: mockEmbed as EmbeddingPipeline,
		});

		await vi.waitFor(() => expect(currentIdx!.loaded.get()).toBe(true), { timeout: 1000 });
		expect(currentIdx!.error.get()).toBeUndefined();
	});

	it("sets error on fetch failure", async () => {
		const failFetch = vi
			.fn()
			.mockResolvedValue(new Response(null, { status: 500, statusText: "Server Error" })) as any;

		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			fetch: failFetch,
			_embedFn: mockEmbed as EmbeddingPipeline,
		});

		await vi.waitFor(() => expect(currentIdx!.error.get()).toBeDefined(), { timeout: 1000 });
		expect(currentIdx!.loaded.get()).toBe(false);
	});

	it("sets error on vector binary size mismatch", async () => {
		const manifest = makeManifest(3);
		const wrongVectors = makeVectorBinary(2, DIMS);

		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			dimensions: DIMS,
			fetch: mockFetchForIndex(manifest, wrongVectors),
			_embedFn: mockEmbed as EmbeddingPipeline,
		});

		await vi.waitFor(() => expect(currentIdx!.error.get()).toBeDefined(), { timeout: 1000 });
		expect((currentIdx!.error.get() as Error).message).toContain("mismatch");
		expect(currentIdx!.loaded.get()).toBe(false);
	});

	it("results starts as empty array", () => {
		const manifest = makeManifest(3);
		const vectors = makeVectorBinary(3, DIMS);
		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			dimensions: DIMS,
			fetch: mockFetchForIndex(manifest, vectors),
			_embedFn: mockEmbed as EmbeddingPipeline,
		});
		expect(currentIdx.results.get()).toEqual([]);
	});

	it("search() embeds query and returns scored docs", async () => {
		const manifest = makeManifest(3);
		const vectors = makeVectorBinary(3, DIMS);

		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			dimensions: DIMS,
			fetch: mockFetchForIndex(manifest, vectors),
			_embedFn: mockEmbed as EmbeddingPipeline,
		});

		await vi.waitFor(() => expect(currentIdx!.loaded.get()).toBe(true), { timeout: 1000 });

		currentIdx.search("test query", 2);

		await vi.waitFor(() => expect(currentIdx!.results.get().length).toBeGreaterThan(0), {
			timeout: 1000,
		});

		const results = currentIdx.results.get();
		expect(results.length).toBeLessThanOrEqual(2);

		// First result should be the most similar
		expect(results[0].score).toBeGreaterThanOrEqual(results[results.length - 1].score);
		expect(results[0].id).toBeDefined();
		expect(results[0].metadata).toBeDefined();

		// Verify embed function was called with query
		expect(mockEmbed).toHaveBeenCalledWith("test query", {
			pooling: "mean",
			normalize: true,
		});
	});

	it("search() with empty query returns empty results", async () => {
		const manifest = makeManifest(3);
		const vectors = makeVectorBinary(3, DIMS);

		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			dimensions: DIMS,
			fetch: mockFetchForIndex(manifest, vectors),
			_embedFn: mockEmbed as EmbeddingPipeline,
		});

		await vi.waitFor(() => expect(currentIdx!.loaded.get()).toBe(true), { timeout: 1000 });

		currentIdx.search("   ");
		expect(currentIdx.results.get()).toEqual([]);
	});

	it("search() before loaded returns empty results", () => {
		const manifest = makeManifest(3);
		const vectors = makeVectorBinary(3, DIMS);
		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			dimensions: DIMS,
			fetch: mockFetchForIndex(manifest, vectors),
			_embedFn: mockEmbed as EmbeddingPipeline,
		});
		expect(currentIdx.loaded.get()).toBe(false);

		currentIdx.search("test");
		expect(currentIdx.results.get()).toEqual([]);
	});

	it("search() sets error on embedding failure", async () => {
		const manifest = makeManifest(3);
		const vectors = makeVectorBinary(3, DIMS);

		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			dimensions: DIMS,
			fetch: mockFetchForIndex(manifest, vectors),
			_embedFn: mockEmbed as EmbeddingPipeline,
		});

		await vi.waitFor(() => expect(currentIdx!.loaded.get()).toBe(true), { timeout: 1000 });

		mockEmbed.mockRejectedValueOnce(new Error("Model inference failed"));
		currentIdx.search("test");

		await vi.waitFor(() => expect(currentIdx!.error.get()).toBeDefined(), { timeout: 1000 });
		expect(currentIdx.results.get()).toEqual([]);
	});

	it("results store is reactive via subscribe", async () => {
		const manifest = makeManifest(3);
		const vectors = makeVectorBinary(3, DIMS);

		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			dimensions: DIMS,
			fetch: mockFetchForIndex(manifest, vectors),
			_embedFn: mockEmbed as EmbeddingPipeline,
		});

		await vi.waitFor(() => expect(currentIdx!.loaded.get()).toBe(true), { timeout: 1000 });

		const observed: ScoredDoc[][] = [];
		const sub = subscribe(currentIdx.results, (v) => observed.push(v));

		currentIdx.search("test");

		await vi.waitFor(() => expect(observed.length).toBeGreaterThan(0), { timeout: 1000 });
		expect(observed[observed.length - 1].length).toBeGreaterThan(0);

		sub.unsubscribe();
	});

	it("search() results include metadata from manifest", async () => {
		const manifest = makeManifest(3);
		const vectors = makeVectorBinary(3, DIMS);

		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			dimensions: DIMS,
			fetch: mockFetchForIndex(manifest, vectors),
			_embedFn: mockEmbed as EmbeddingPipeline,
		});

		await vi.waitFor(() => expect(currentIdx!.loaded.get()).toBe(true), { timeout: 1000 });

		currentIdx.search("test", 1);

		await vi.waitFor(() => expect(currentIdx!.results.get().length).toBe(1), { timeout: 1000 });

		const result = currentIdx.results.get()[0];
		expect(result.metadata).toHaveProperty("title");
		expect(result.metadata).toHaveProperty("source", "test");
	});

	it("destroy() tears down and resets stores", async () => {
		const manifest = makeManifest(3);
		const vectors = makeVectorBinary(3, DIMS);

		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			dimensions: DIMS,
			fetch: mockFetchForIndex(manifest, vectors),
			_embedFn: mockEmbed as EmbeddingPipeline,
		});

		await vi.waitFor(() => expect(currentIdx!.loaded.get()).toBe(true), { timeout: 1000 });

		currentIdx.destroy();

		expect(currentIdx.loaded.get()).toBe(false);
		expect(currentIdx.results.get()).toEqual([]);
		expect(currentIdx.error.get()).toBeUndefined();
		currentIdx = null;
	});

	it("search() after destroy returns empty", async () => {
		const manifest = makeManifest(3);
		const vectors = makeVectorBinary(3, DIMS);

		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			dimensions: DIMS,
			fetch: mockFetchForIndex(manifest, vectors),
			_embedFn: mockEmbed as EmbeddingPipeline,
		});

		await vi.waitFor(() => expect(currentIdx!.loaded.get()).toBe(true), { timeout: 1000 });

		currentIdx.destroy();
		currentIdx.search("test");
		expect(currentIdx.results.get()).toEqual([]);
		currentIdx = null;
	});

	it("scores are cosine similarity (0–1 range)", async () => {
		const manifest = makeManifest(3);
		const vectors = makeVectorBinary(3, DIMS);

		// Return a query vector identical to doc-0's vector
		mockEmbed.mockResolvedValue({
			data: new Float32Array([1, 0, 0, 0]),
			dims: [1, DIMS],
		});

		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			dimensions: DIMS,
			fetch: mockFetchForIndex(manifest, vectors),
			_embedFn: mockEmbed as EmbeddingPipeline,
		});

		await vi.waitFor(() => expect(currentIdx!.loaded.get()).toBe(true), { timeout: 1000 });

		currentIdx.search("test");

		await vi.waitFor(() => expect(currentIdx!.results.get().length).toBeGreaterThan(0), {
			timeout: 1000,
		});

		const results = currentIdx.results.get();
		// Best match should have similarity close to 1.0
		expect(results[0].score).toBeGreaterThan(0.9);
		// All scores in valid range
		for (const r of results) {
			expect(r.score).toBeGreaterThanOrEqual(0);
			expect(r.score).toBeLessThanOrEqual(1);
		}
	});

	it("rapid search() calls — only latest result wins (no stale overwrite)", async () => {
		const manifest = makeManifest(3);
		const vectors = makeVectorBinary(3, DIMS);

		// First call: slow, returns vector for doc-1
		// Second call: fast, returns vector for doc-0
		let callCount = 0;
		const slowEmbed = vi.fn().mockImplementation((_query: string) => {
			callCount++;
			if (callCount === 1) {
				// First call — slow, resolves to doc-1's vector
				return new Promise((resolve) =>
					setTimeout(() => resolve({ data: new Float32Array([0, 1, 0, 0]), dims: [1, DIMS] }), 100),
				);
			}
			// Second call — fast, resolves to doc-0's vector
			return Promise.resolve({ data: new Float32Array([1, 0, 0, 0]), dims: [1, DIMS] });
		});

		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			dimensions: DIMS,
			fetch: mockFetchForIndex(manifest, vectors),
			_embedFn: slowEmbed as EmbeddingPipeline,
		});

		await vi.waitFor(() => expect(currentIdx!.loaded.get()).toBe(true), { timeout: 1000 });

		// Fire both searches rapidly
		currentIdx.search("slow query");
		currentIdx.search("fast query");

		// Wait for both to settle — second call should win
		await vi.waitFor(() => expect(currentIdx!.results.get().length).toBeGreaterThan(0), {
			timeout: 1000,
		});

		// After both resolve, results should reflect the LAST search (doc-0 vector)
		// Wait extra time for the slow promise to also resolve
		await new Promise((r) => setTimeout(r, 150));

		const results = currentIdx.results.get();
		// doc-0 should be the best match (exact match for [1,0,0,0])
		expect(results[0].id).toBe("doc-0");
		expect(results[0].score).toBeGreaterThan(0.9);
	});

	it("respects default limit option", async () => {
		const manifest = makeManifest(3);
		const vectors = makeVectorBinary(3, DIMS);

		currentIdx = embeddingIndex({
			vectors: "/vectors.bin",
			manifest: "/manifest.json",
			dimensions: DIMS,
			limit: 1,
			fetch: mockFetchForIndex(manifest, vectors),
			_embedFn: mockEmbed as EmbeddingPipeline,
		});

		await vi.waitFor(() => expect(currentIdx!.loaded.get()).toBe(true), { timeout: 1000 });

		currentIdx.search("test");

		await vi.waitFor(() => expect(currentIdx!.results.get().length).toBe(1), { timeout: 1000 });
	});
});
