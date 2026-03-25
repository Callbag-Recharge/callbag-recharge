// ---------------------------------------------------------------------------
// agentMemory persistence — auto-checkpoint wiring
// ---------------------------------------------------------------------------
// Subscribes to collection structural changes and persists nodes + embeddings
// to a CheckpointAdapter. Provides restore() to hydrate from saved state.
//
// Uses subscribe() (single-dep, per §1.19) — no DIRTY/RESOLVED overhead.
// ---------------------------------------------------------------------------

import { subscribe } from "../../core/subscribe";
import type { Collection, MemoryNode, SerializedMeta, VectorIndex } from "../../memory/types";
import { rawFromAny } from "../../raw/fromAny";
import { rawSubscribe } from "../../raw/subscribe";
import type { CheckpointAdapter } from "../../utils/checkpoint";

/** Serialized persistence format. */
export interface PersistedState {
	nodes: Array<{
		id: string;
		content: string;
		meta: SerializedMeta;
	}>;
	embeddings: Record<string, number[]>;
}

function serializeMeta(node: MemoryNode<string>): SerializedMeta {
	const meta = node.meta.get();
	return {
		id: meta.id,
		createdAt: meta.createdAt,
		updatedAt: meta.updatedAt,
		accessedAt: meta.accessedAt,
		accessCount: meta.accessCount,
		importance: meta.importance,
		tags: Array.from(meta.tags),
	};
}

function serializeState(
	col: Collection<string>,
	embeddings: Map<string, Float32Array | number[]>,
): PersistedState {
	const nodes = col.nodes.get().map((node) => ({
		id: node.id,
		content: node.content.get(),
		meta: serializeMeta(node),
	}));

	const embeddingsObj: Record<string, number[]> = {};
	for (const [id, vec] of embeddings) {
		embeddingsObj[id] = Array.from(vec);
	}

	return { nodes, embeddings: embeddingsObj };
}

/**
 * Wire auto-persistence on a collection + vectorIndex.
 *
 * @param col - The collection to persist.
 * @param vi - The vector index to persist.
 * @param embeddings - Parallel map of id → embedding vectors.
 * @param adapter - Checkpoint adapter (IndexedDB, SQLite, file, etc.).
 * @param key - Persistence key (namespace-prefixed).
 */
export function autoPersist(
	col: Collection<string>,
	vi: VectorIndex,
	embeddings: Map<string, Float32Array | number[]>,
	adapter: CheckpointAdapter,
	key: string,
): { dispose(): void; restore(): void } {
	let disposed = false;
	let _restoring = false; // P3: suppress saves during hydration

	// Subscribe to collection structural changes → save
	const sub = subscribe(col.nodes, () => {
		if (disposed || _restoring) return;
		const state = serializeState(col, embeddings);
		const result = adapter.save(key, state);
		// Fire-and-forget async saves — surface errors via onEnd (A5)
		if (result !== undefined) {
			rawSubscribe(result, () => {}, {
				onEnd: (err?: unknown) => {
					if (err !== undefined) {
						// Save error — silently logged for now; v2 exposes persistError store
					}
				},
			});
		}
	});

	function restore(): void {
		const result = adapter.load(key);
		if (result === undefined || result === null) return;

		// Handle sync adapters (return the value directly)
		if (typeof result !== "function") {
			_restoring = true;
			hydrateState(result as PersistedState, col, vi, embeddings);
			_restoring = false;
			return;
		}

		// Handle async adapters (return CallbagSource)
		_restoring = true;
		rawSubscribe(rawFromAny(result), (loaded: unknown) => {
			if (loaded && typeof loaded === "object") {
				hydrateState(loaded as PersistedState, col, vi, embeddings);
			}
			_restoring = false;
		});
	}

	function dispose(): void {
		disposed = true;
		sub.unsubscribe();
	}

	return { dispose, restore };
}

function hydrateState(
	state: PersistedState,
	col: Collection<string>,
	vi: VectorIndex,
	embeddings: Map<string, Float32Array | number[]>,
): void {
	if (!state.nodes || !Array.isArray(state.nodes)) return;

	for (const saved of state.nodes) {
		const node = col.add(saved.content, {
			id: saved.id,
			importance: saved.meta.importance,
			tags: saved.meta.tags,
			// P4: restore timestamps from persisted metadata
			createdAt: saved.meta.createdAt,
			updatedAt: saved.meta.updatedAt,
			accessedAt: saved.meta.accessedAt,
		});
		if (node) {
			// Replay access count
			for (let i = 0; i < saved.meta.accessCount; i++) {
				node.touch();
			}
		}
	}

	// Restore embeddings
	if (state.embeddings) {
		for (const [id, vec] of Object.entries(state.embeddings)) {
			const arr = new Float32Array(vec);
			vi.add(id, arr);
			embeddings.set(id, arr);
		}
	}
}
