// ---------------------------------------------------------------------------
// Phase 6c: Knowledge Graph — reactive entity relationships
// ---------------------------------------------------------------------------
// A knowledge graph manages typed, directed relations between entities stored
// in a Collection<T>. Relations carry temporal metadata (createdAt, updatedAt,
// weight) and are indexed by type via ReactiveIndex.
//
// Design:
// - Entities delegate to Collection<T> (decay, scoring, admission, eviction)
// - Relations stored in _relations Map<string, Relation>
// - Adjacency: _outEdges Map<entityId, Set<relId>>, _inEdges Map<entityId, Set<relId>>
// - Type index via ReactiveIndex: relationType → Set<relationId>
// - Version-gated reactive stores for relationCount
// - Cascade deletion: subscribe(collection.nodes) cleans up orphaned relations
// - Per-entity reactive query caches (relationsOf, neighborsOf)
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";
import { reactiveIndex } from "../data/reactiveIndex";
import { collection as createCollection } from "./collection";
import type {
	AddRelationOptions,
	Collection,
	KnowledgeGraph as KnowledgeGraphInterface,
	KnowledgeGraphOptions,
	MemoryNode,
	MemoryNodeOptions,
	Relation,
	TraverseOptions,
} from "./types";

let graphCounter = 0;
let relationCounter = 0;

function generateRelationId(): string {
	return `rel-${++relationCounter}`;
}

/**
 * Creates a reactive knowledge graph with entity relationships, temporal
 * tracking, and graph-based retrieval.
 *
 * @param opts - Optional configuration (all `CollectionOptions` pass through to the internal entity collection).
 *
 * @returns `KnowledgeGraph<T>` — entity CRUD, relation management, graph queries, reactive stores.
 *
 * @remarks **Entities** are stored in an internal `Collection<T>`, exposed via `.collection`. All collection features (topK, byTag, gc, summarize, admission/forget policies, eviction) are available.
 * @remarks **Relations** are directed, typed edges with temporal metadata (createdAt, updatedAt, weight). Indexed by type via `typeIndex`.
 * @remarks **Cascade deletion** — removing an entity automatically removes all its relations via `subscribe` on collection.nodes (§1.19).
 * @remarks **Graph traversal** — BFS via `traverse()`, shortest path via `shortestPath()`, subgraph extraction via `subgraph()`.
 * @remarks **Reactive queries** — `relationsOf()` and `neighborsOf()` return cached reactive stores that update when relations change.
 *
 * @example
 * ```ts
 * import { knowledgeGraph } from 'callbag-recharge/memory';
 *
 * const kg = knowledgeGraph<string>();
 * kg.addEntity("Alice", { id: "alice" });
 * kg.addEntity("Bob", { id: "bob" });
 * kg.addRelation("alice", "bob", "knows", { weight: 0.9 });
 *
 * kg.neighbors("alice"); // [MemoryNode<"Bob">]
 * kg.outgoing("alice", "knows"); // [Relation]
 * ```
 *
 * @seeAlso [collection](./collection) — entity storage, [vectorIndex](./vectorIndex) — semantic search
 * @category memory
 */
export function knowledgeGraph<T>(opts?: KnowledgeGraphOptions<T>): KnowledgeGraphInterface<T> {
	const id = ++graphCounter;
	const col: Collection<T> = createCollection<T>(opts);

	// --- Relation storage ---
	const _relations = new Map<string, Relation>();
	// entityId → Set<relationId> for outgoing edges
	const _outEdges = new Map<string, Set<string>>();
	// entityId → Set<relationId> for incoming edges
	const _inEdges = new Map<string, Set<string>>();

	// Type index: relationType → Set<relationId>
	const _typeIndex = reactiveIndex({ id: `kg-${id}:types` });

	// Version counter — bumped on relation structural changes
	const _relVersion = state<number>(0, { name: `kg-${id}:relVer` });
	const _relationCount = derived([_relVersion], () => _relations.size, {
		name: `kg-${id}:relCount`,
	});

	// Cached reactive query stores
	const _relationsOfCache = new Map<string, Store<Relation[]>>();
	const _neighborsOfCache = new Map<string, Store<MemoryNode<T>[]>>();

	let destroyed = false;

	function _bumpRelVersion(): void {
		_relVersion.update((v) => v + 1);
	}

	function _getOutSet(entityId: string): Set<string> {
		let s = _outEdges.get(entityId);
		if (!s) {
			s = new Set();
			_outEdges.set(entityId, s);
		}
		return s;
	}

	function _getInSet(entityId: string): Set<string> {
		let s = _inEdges.get(entityId);
		if (!s) {
			s = new Set();
			_inEdges.set(entityId, s);
		}
		return s;
	}

	function _removeRelationInternal(relId: string): boolean {
		const rel = _relations.get(relId);
		if (!rel) return false;

		_relations.delete(relId);

		const outSet = _outEdges.get(rel.sourceId);
		if (outSet) {
			outSet.delete(relId);
			if (outSet.size === 0) _outEdges.delete(rel.sourceId);
		}
		const inSet = _inEdges.get(rel.targetId);
		if (inSet) {
			inSet.delete(relId);
			if (inSet.size === 0) _inEdges.delete(rel.targetId);
		}

		_typeIndex.remove(relId);
		return true;
	}

	function _removeAllRelationsForEntity(entityId: string): void {
		// Collect all relation IDs involving this entity
		const toRemove: string[] = [];
		const outSet = _outEdges.get(entityId);
		if (outSet) for (const relId of outSet) toRemove.push(relId);
		const inSet = _inEdges.get(entityId);
		if (inSet) for (const relId of inSet) toRemove.push(relId);

		if (toRemove.length === 0) return;

		batch(() => {
			for (const relId of toRemove) _removeRelationInternal(relId);
			_bumpRelVersion();
		});
	}

	function _getRelationsForDirection(
		entityId: string,
		direction: "out" | "in" | "both",
		type?: string,
	): Relation[] {
		const result: Relation[] = [];
		if (direction === "out" || direction === "both") {
			const outSet = _outEdges.get(entityId);
			if (outSet) {
				for (const relId of outSet) {
					const rel = _relations.get(relId)!;
					if (!type || rel.type === type) result.push(rel);
				}
			}
		}
		if (direction === "in" || direction === "both") {
			const inSet = _inEdges.get(entityId);
			if (inSet) {
				for (const relId of inSet) {
					const rel = _relations.get(relId)!;
					if (!type || rel.type === type) result.push(rel);
				}
			}
		}
		return result;
	}

	function _getNeighborIds(
		entityId: string,
		direction: "out" | "in" | "both",
		type?: string,
	): Set<string> {
		const ids = new Set<string>();
		const rels = _getRelationsForDirection(entityId, direction, type);
		for (const rel of rels) {
			const neighborId = rel.sourceId === entityId ? rel.targetId : rel.sourceId;
			// Self-loops are valid relations (visible via outgoing/incoming) but excluded
			// from neighbor sets to prevent infinite BFS loops in traverse/shortestPath.
			if (neighborId !== entityId) ids.add(neighborId);
		}
		return ids;
	}

	// --- Cascade deletion ---
	// Subscribe to collection.nodes to detect entity removal (by eviction, gc, or explicit remove).
	// Uses subscribe (§1.19: single dep, no diamond risk).
	let _prevEntityIds = new Set<string>();
	// Initialize with current entity IDs
	for (const node of col.nodes.get()) _prevEntityIds.add(node.id);

	function _evictCacheForEntity(entityId: string): void {
		for (const dir of ["out", "in", "both"] as const) {
			const key = _cacheKey(entityId, dir);
			const relStore = _relationsOfCache.get(key);
			if (relStore) {
				teardown(relStore);
				_relationsOfCache.delete(key);
			}
			const nbrStore = _neighborsOfCache.get(key);
			if (nbrStore) {
				teardown(nbrStore);
				_neighborsOfCache.delete(key);
			}
		}
	}

	const _cascadeSub = subscribe(col.nodes, (nodes) => {
		const currentIds = new Set<string>();
		for (const n of nodes) currentIds.add(n.id);

		// Find removed entities
		for (const prevId of _prevEntityIds) {
			if (!currentIds.has(prevId)) {
				_removeAllRelationsForEntity(prevId);
				_evictCacheForEntity(prevId);
			}
		}
		_prevEntityIds = currentIds;
	});

	// --- Reactive query cache helpers ---

	function _cacheKey(entityId: string, direction: "out" | "in" | "both"): string {
		return `${entityId}:${direction}`;
	}

	const kg: KnowledgeGraphInterface<T> = {
		// --- Entity ops ---

		addEntity(content: T, nodeOpts?: MemoryNodeOptions): MemoryNode<T> | undefined {
			if (destroyed) throw new Error("KnowledgeGraph is destroyed");
			return col.add(content, nodeOpts);
		},

		removeEntity(entityId: string): boolean {
			if (destroyed) throw new Error("KnowledgeGraph is destroyed");
			// Cascade deletion happens via subscribe on col.nodes
			return col.remove(entityId);
		},

		getEntity(entityId: string): MemoryNode<T> | undefined {
			return col.get(entityId);
		},

		hasEntity(entityId: string): boolean {
			return col.has(entityId);
		},

		entities: col.nodes,
		entityCount: col.size,

		// --- Relation CRUD ---

		addRelation(
			sourceId: string,
			targetId: string,
			type: string,
			relOpts?: AddRelationOptions,
		): Relation {
			if (destroyed) throw new Error("KnowledgeGraph is destroyed");
			if (!col.has(sourceId)) throw new Error(`Source entity "${sourceId}" not found`);
			if (!col.has(targetId)) throw new Error(`Target entity "${targetId}" not found`);

			const relId = relOpts?.id ?? generateRelationId();
			if (_relations.has(relId)) throw new Error(`Relation ID "${relId}" already exists`);

			const now = Date.now();
			const rawWeight = relOpts?.weight ?? 1;
			const rel: Relation = {
				id: relId,
				sourceId,
				targetId,
				type,
				weight: Math.max(0, Math.min(1, rawWeight)),
				metadata: relOpts?.metadata,
				createdAt: now,
				updatedAt: now,
			};

			batch(() => {
				_relations.set(relId, rel);
				_getOutSet(sourceId).add(relId);
				_getInSet(targetId).add(relId);
				_typeIndex.add(relId, [type]);
				_bumpRelVersion();
			});

			return rel;
		},

		removeRelation(relationId: string): boolean {
			if (destroyed) throw new Error("KnowledgeGraph is destroyed");
			let removed = false;
			batch(() => {
				removed = _removeRelationInternal(relationId);
				if (removed) _bumpRelVersion();
			});
			return removed;
		},

		removeRelationsBetween(sourceId: string, targetId: string, type?: string): number {
			if (destroyed) throw new Error("KnowledgeGraph is destroyed");
			const outSet = _outEdges.get(sourceId);
			if (!outSet) return 0;

			const toRemove: string[] = [];
			for (const relId of outSet) {
				const rel = _relations.get(relId)!;
				if (rel.targetId === targetId && (!type || rel.type === type)) {
					toRemove.push(relId);
				}
			}

			if (toRemove.length === 0) return 0;

			batch(() => {
				for (const relId of toRemove) _removeRelationInternal(relId);
				_bumpRelVersion();
			});

			return toRemove.length;
		},

		getRelation(relationId: string): Relation | undefined {
			return _relations.get(relationId);
		},

		hasRelation(relationId: string): boolean {
			return _relations.has(relationId);
		},

		updateRelation(
			relationId: string,
			updates: { weight?: number; metadata?: Record<string, unknown> },
		): boolean {
			if (destroyed) throw new Error("KnowledgeGraph is destroyed");
			const rel = _relations.get(relationId);
			if (!rel) return false;

			// Clone to preserve immutability for external reference holders
			const updated: Relation = {
				...rel,
				weight:
					updates.weight !== undefined ? Math.max(0, Math.min(1, updates.weight)) : rel.weight,
				metadata: updates.metadata !== undefined ? updates.metadata : rel.metadata,
				updatedAt: Date.now(),
			};
			_relations.set(relationId, updated);
			_bumpRelVersion();
			return true;
		},

		relationCount: _relationCount,

		// --- Graph queries ---

		outgoing(entityId: string, type?: string): Relation[] {
			return _getRelationsForDirection(entityId, "out", type);
		},

		incoming(entityId: string, type?: string): Relation[] {
			return _getRelationsForDirection(entityId, "in", type);
		},

		neighbors(
			entityId: string,
			opts?: { direction?: "out" | "in" | "both"; type?: string },
		): MemoryNode<T>[] {
			const direction = opts?.direction ?? "out";
			const neighborIds = _getNeighborIds(entityId, direction, opts?.type);
			const result: MemoryNode<T>[] = [];
			for (const nid of neighborIds) {
				const node = col.get(nid);
				if (node) result.push(node);
			}
			return result;
		},

		traverse(startId: string, opts?: TraverseOptions): MemoryNode<T>[] {
			const direction = opts?.direction ?? "out";
			const type = opts?.type;
			const maxDepth = opts?.maxDepth ?? Infinity;
			const maxNodes = opts?.maxNodes ?? Infinity;

			if (!col.has(startId)) return [];

			// BFS
			const visited = new Set<string>([startId]);
			const result: MemoryNode<T>[] = [];
			let frontier: string[] = [startId];
			let depth = 0;

			while (frontier.length > 0 && depth < maxDepth && result.length < maxNodes) {
				depth++;
				const nextFrontier: string[] = [];

				for (const entityId of frontier) {
					const neighborIds = _getNeighborIds(entityId, direction, type);
					for (const nid of neighborIds) {
						if (visited.has(nid)) continue;
						visited.add(nid);

						const node = col.get(nid);
						if (node) {
							result.push(node);
							if (result.length >= maxNodes) break;
						}
						nextFrontier.push(nid);
					}
					if (result.length >= maxNodes) break;
				}

				frontier = nextFrontier;
			}

			return result;
		},

		shortestPath(
			fromId: string,
			toId: string,
			opts?: { type?: string; direction?: "out" | "in" | "both" },
		): string[] | undefined {
			if (fromId === toId) return [fromId];
			if (!col.has(fromId) || !col.has(toId)) return undefined;

			const direction = opts?.direction ?? "both";
			const type = opts?.type;

			// BFS with parent tracking
			const visited = new Set<string>([fromId]);
			const parent = new Map<string, string>();
			let frontier: string[] = [fromId];

			while (frontier.length > 0) {
				const nextFrontier: string[] = [];

				for (const entityId of frontier) {
					const neighborIds = _getNeighborIds(entityId, direction, type);
					for (const nid of neighborIds) {
						if (visited.has(nid)) continue;
						visited.add(nid);
						parent.set(nid, entityId);

						if (nid === toId) {
							// Reconstruct path
							const path: string[] = [toId];
							let current = toId;
							while (current !== fromId) {
								current = parent.get(current)!;
								path.unshift(current);
							}
							return path;
						}

						nextFrontier.push(nid);
					}
				}

				frontier = nextFrontier;
			}

			return undefined;
		},

		subgraph(entityIds: string[]): { entities: MemoryNode<T>[]; relations: Relation[] } {
			const idSet = new Set(entityIds);
			const entities: MemoryNode<T>[] = [];
			for (const eid of idSet) {
				const node = col.get(eid);
				if (node) entities.push(node);
			}

			const relations: Relation[] = [];
			const seenRels = new Set<string>();
			for (const eid of idSet) {
				const outSet = _outEdges.get(eid);
				if (outSet) {
					for (const relId of outSet) {
						if (seenRels.has(relId)) continue;
						const rel = _relations.get(relId)!;
						if (idSet.has(rel.targetId)) {
							relations.push(rel);
							seenRels.add(relId);
						}
					}
				}
			}

			return { entities, relations };
		},

		// --- Reactive queries ---

		relationsOf(entityId: string, direction: "out" | "in" | "both" = "both"): Store<Relation[]> {
			const key = _cacheKey(entityId, direction);
			let cached = _relationsOfCache.get(key);
			if (cached) return cached;

			cached = derived([_relVersion], () => _getRelationsForDirection(entityId, direction), {
				name: `kg-${id}:relsOf:${key}`,
			});
			_relationsOfCache.set(key, cached);
			return cached;
		},

		neighborsOf(
			entityId: string,
			direction: "out" | "in" | "both" = "both",
		): Store<MemoryNode<T>[]> {
			const key = _cacheKey(entityId, direction);
			let cached = _neighborsOfCache.get(key);
			if (cached) return cached;

			cached = derived(
				[_relVersion],
				() => {
					const neighborIds = _getNeighborIds(entityId, direction);
					const result: MemoryNode<T>[] = [];
					for (const nid of neighborIds) {
						const node = col.get(nid);
						if (node) result.push(node);
					}
					return result;
				},
				{ name: `kg-${id}:neighborsOf:${key}` },
			);
			_neighborsOfCache.set(key, cached);
			return cached;
		},

		// --- Temporal ---

		relationsInRange(from: number, to: number): Relation[] {
			const result: Relation[] = [];
			for (const rel of _relations.values()) {
				if (
					(rel.createdAt >= from && rel.createdAt <= to) ||
					(rel.updatedAt >= from && rel.updatedAt <= to)
				) {
					result.push(rel);
				}
			}
			return result;
		},

		// --- Indexes ---

		typeIndex: _typeIndex,

		// --- Collection access ---

		collection: col,

		// --- Lifecycle ---

		destroy(): void {
			if (destroyed) return;
			destroyed = true;

			_cascadeSub.unsubscribe();

			// Tear down reactive query caches
			for (const s of _relationsOfCache.values()) teardown(s);
			_relationsOfCache.clear();
			for (const s of _neighborsOfCache.values()) teardown(s);
			_neighborsOfCache.clear();

			// Clear relation storage
			_relations.clear();
			_outEdges.clear();
			_inEdges.clear();

			_typeIndex.destroy();
			// Tear down derived before its dependency (leaves before roots)
			teardown(_relationCount);
			teardown(_relVersion);

			// Destroy the underlying collection (cascades to all entities)
			col.destroy();
		},
	};

	return kg;
}
