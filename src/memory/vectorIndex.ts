// ---------------------------------------------------------------------------
// vectorIndex — Phase 6b: In-process HNSW vector index
// ---------------------------------------------------------------------------
//
// Pure TypeScript HNSW (Hierarchical Navigable Small World) implementation.
// ~1-10 μs search for <10K vectors, zero external dependencies.
//
// Reference: Malkov & Yashunin, "Efficient and robust approximate nearest
// neighbor search using Hierarchical Navigable Small World graphs" (2016).
// ---------------------------------------------------------------------------

import { teardown } from "../core/protocol";
import { state } from "../core/state";
import type { VectorIndex, VectorIndexOptions, VectorSearchResult } from "./types";

// ---------------------------------------------------------------------------
// Distance functions
// ---------------------------------------------------------------------------

function cosineDistance(a: Float32Array, b: Float32Array): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	// cosine distance = 1 - cosine_similarity; 0 = identical
	return denom === 0 ? 1 : 1 - dot / denom;
}

function euclideanDistance(a: Float32Array, b: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		const d = a[i] - b[i];
		sum += d * d;
	}
	return Math.sqrt(sum);
}

function dotProductDistance(a: Float32Array, b: Float32Array): number {
	let dot = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
	}
	// Negate so that higher dot product = lower distance (ascending sort works)
	return -dot;
}

type DistanceFn = (a: Float32Array, b: Float32Array) => number;

const DISTANCE_FNS: Record<string, DistanceFn> = {
	cosine: cosineDistance,
	euclidean: euclideanDistance,
	dotProduct: dotProductDistance,
};

// ---------------------------------------------------------------------------
// HNSW internal types
// ---------------------------------------------------------------------------

interface HnswNode {
	id: string;
	vector: Float32Array;
	layer: number; // max layer this node belongs to
	neighbors: Set<number>[]; // neighbors[level] = set of internal indices
	deleted: boolean;
}

// ---------------------------------------------------------------------------
// Min-heap for beam search (candidates sorted by distance)
// ---------------------------------------------------------------------------

interface HeapEntry {
	idx: number;
	dist: number;
}

function heapPush(heap: HeapEntry[], entry: HeapEntry): void {
	heap.push(entry);
	let i = heap.length - 1;
	while (i > 0) {
		const parent = (i - 1) >> 1;
		if (heap[parent].dist <= heap[i].dist) break;
		const tmp = heap[parent];
		heap[parent] = heap[i];
		heap[i] = tmp;
		i = parent;
	}
}

function heapPop(heap: HeapEntry[]): HeapEntry {
	const top = heap[0];
	const last = heap.pop()!;
	if (heap.length > 0) {
		heap[0] = last;
		let i = 0;
		while (true) {
			let smallest = i;
			const l = 2 * i + 1;
			const r = 2 * i + 2;
			if (l < heap.length && heap[l].dist < heap[smallest].dist) smallest = l;
			if (r < heap.length && heap[r].dist < heap[smallest].dist) smallest = r;
			if (smallest === i) break;
			const tmp = heap[smallest];
			heap[smallest] = heap[i];
			heap[i] = tmp;
			i = smallest;
		}
	}
	return top;
}

// ---------------------------------------------------------------------------
// HNSW implementation
// ---------------------------------------------------------------------------

function toFloat32(v: Float32Array | number[], dims: number): Float32Array {
	if (v.length !== dims) throw new Error(`Expected ${dims} dimensions, got ${v.length}`);
	// Always copy — prevents external mutation from corrupting the index
	return new Float32Array(v);
}

function validateFinite(v: Float32Array): void {
	for (let i = 0; i < v.length; i++) {
		if (!Number.isFinite(v[i])) throw new Error("Vector contains non-finite values");
	}
}

/** Create an in-process HNSW vector index. */
export function vectorIndex(opts: VectorIndexOptions): VectorIndex {
	const dims = opts.dimensions;
	if (!dims || dims <= 0) throw new Error("dimensions must be a positive integer");

	const M = opts.m ?? 16;
	const M_MAX0 = M * 2; // max connections at layer 0
	const efConstruction = opts.efConstruction ?? 200;
	const efSearch = opts.efSearch ?? 50;
	const distFn = DISTANCE_FNS[opts.distance ?? "cosine"];
	if (!distFn) throw new Error(`Unknown distance metric: ${opts.distance}`);

	// mL = 1/ln(M) — controls layer probability
	const mL = 1 / Math.log(M);

	// Internal storage
	const nodes: HnswNode[] = [];
	const idToIdx = new Map<string, number>();
	let entryPoint = -1; // index of entry point node
	let maxLayer = -1;
	let activeCount = 0;

	// Reactive size
	const sizeStore = state(0);

	// --- Random layer assignment ---
	function randomLayer(): number {
		let r = Math.random();
		if (r === 0) r = Number.EPSILON; // avoid -log(0) = Infinity
		return Math.floor(-Math.log(r) * mL);
	}

	// --- Search layer: greedy closest from entry, returning ef nearest ---
	function searchLayer(
		query: Float32Array,
		entryIdx: number,
		ef: number,
		level: number,
	): HeapEntry[] {
		const visited = new Set<number>();
		visited.add(entryIdx);

		const entryDist = distFn(query, nodes[entryIdx].vector);

		// candidates: min-heap (closest first)
		const candidates: HeapEntry[] = [];
		heapPush(candidates, { idx: entryIdx, dist: entryDist });

		// results: collected nearest, we'll sort at end
		const results: HeapEntry[] = [{ idx: entryIdx, dist: entryDist }];

		while (candidates.length > 0) {
			const current = heapPop(candidates);

			// If current is farther than the farthest in results (when results is full), stop
			if (results.length >= ef) {
				let worstDist = -Infinity;
				for (let i = 0; i < results.length; i++) {
					if (results[i].dist > worstDist) worstDist = results[i].dist;
				}
				if (current.dist > worstDist) break;
			}

			const node = nodes[current.idx];
			const neighbors = node.neighbors[level];
			if (!neighbors) continue;

			for (const nIdx of neighbors) {
				if (visited.has(nIdx)) continue;
				visited.add(nIdx);

				const nNode = nodes[nIdx];
				if (nNode.deleted) continue;

				const d = distFn(query, nNode.vector);

				if (results.length < ef) {
					heapPush(candidates, { idx: nIdx, dist: d });
					results.push({ idx: nIdx, dist: d });
				} else {
					// Find worst in results
					let worstIdx = 0;
					let worstDist = results[0].dist;
					for (let i = 1; i < results.length; i++) {
						if (results[i].dist > worstDist) {
							worstDist = results[i].dist;
							worstIdx = i;
						}
					}
					if (d < worstDist) {
						heapPush(candidates, { idx: nIdx, dist: d });
						results[worstIdx] = { idx: nIdx, dist: d };
					}
				}
			}
		}

		return results;
	}

	// --- Greedy search: single closest at a layer (for upper layers) ---
	function searchLayerGreedy(query: Float32Array, entryIdx: number, level: number): number {
		let current = entryIdx;
		let currentDist = distFn(query, nodes[current].vector);

		let changed = true;
		while (changed) {
			changed = false;
			const neighbors = nodes[current].neighbors[level];
			if (!neighbors) break;

			for (const nIdx of neighbors) {
				const nNode = nodes[nIdx];
				if (nNode.deleted) continue;
				const d = distFn(query, nNode.vector);
				if (d < currentDist) {
					current = nIdx;
					currentDist = d;
					changed = true;
				}
			}
		}

		return current;
	}

	// --- Select neighbors (simple heuristic) ---
	function selectNeighbors(candidates: HeapEntry[], maxConn: number): number[] {
		// Sort by distance ascending, take top maxConn
		candidates.sort((a, b) => a.dist - b.dist);
		const result: number[] = [];
		for (let i = 0; i < Math.min(candidates.length, maxConn); i++) {
			result.push(candidates[i].idx);
		}
		return result;
	}

	// --- Connect bidirectionally ---
	function connect(aIdx: number, bIdx: number, level: number): void {
		const maxConn = level === 0 ? M_MAX0 : M;

		nodes[aIdx].neighbors[level].add(bIdx);
		nodes[bIdx].neighbors[level].add(aIdx);

		// Prune a's neighbors if over limit
		if (nodes[aIdx].neighbors[level].size > maxConn) {
			pruneNeighbors(aIdx, level, maxConn);
		}
		// Prune b's neighbors if over limit
		if (nodes[bIdx].neighbors[level].size > maxConn) {
			pruneNeighbors(bIdx, level, maxConn);
		}
	}

	function pruneNeighbors(idx: number, level: number, maxConn: number): void {
		const node = nodes[idx];
		const candidates: HeapEntry[] = [];
		for (const nIdx of node.neighbors[level]) {
			// Skip deleted nodes — don't let them win slots over live neighbors
			if (nodes[nIdx].deleted) continue;
			candidates.push({ idx: nIdx, dist: distFn(node.vector, nodes[nIdx].vector) });
		}
		const kept = selectNeighbors(candidates, maxConn);
		node.neighbors[level] = new Set(kept);
	}

	// --- Public API ---

	function add(id: string, vector: Float32Array | number[]): void {
		const vec = toFloat32(vector, dims);
		validateFinite(vec);

		// If ID exists, update in place
		if (idToIdx.has(id)) {
			const existingIdx = idToIdx.get(id)!;
			const existingNode = nodes[existingIdx];
			if (existingNode.deleted) {
				// Reactivate
				existingNode.deleted = false;
				existingNode.vector = vec;
				activeCount++;
				// If this is the only active node, make it the entry point
				if (entryPoint === -1) {
					entryPoint = existingIdx;
					maxLayer = existingNode.layer;
				} else {
					// Reconnect at all layers
					for (let level = existingNode.layer; level >= 0; level--) {
						existingNode.neighbors[level] = new Set();
						reconnectAtLayer(existingIdx, level);
					}
					if (existingNode.layer > maxLayer) {
						entryPoint = existingIdx;
						maxLayer = existingNode.layer;
					}
				}
				sizeStore.set(activeCount);
			} else {
				// Replace vector, re-link
				existingNode.vector = vec;
				for (let level = existingNode.layer; level >= 0; level--) {
					// Remove from old neighbors
					for (const nIdx of existingNode.neighbors[level]) {
						nodes[nIdx].neighbors[level].delete(existingIdx);
					}
					existingNode.neighbors[level] = new Set();
					reconnectAtLayer(existingIdx, level);
				}
			}
			return;
		}

		const nodeLayer = randomLayer();
		const idx = nodes.length;
		const neighborSets: Set<number>[] = [];
		for (let i = 0; i <= nodeLayer; i++) {
			neighborSets.push(new Set());
		}

		const node: HnswNode = {
			id,
			vector: vec,
			layer: nodeLayer,
			neighbors: neighborSets,
			deleted: false,
		};
		nodes.push(node);
		idToIdx.set(id, idx);
		activeCount++;

		if (entryPoint === -1) {
			// First node
			entryPoint = idx;
			maxLayer = nodeLayer;
			sizeStore.set(activeCount);
			return;
		}

		// Find entry point by greedy search from top layer down to nodeLayer+1
		let ep = entryPoint;
		for (let level = maxLayer; level > nodeLayer; level--) {
			ep = searchLayerGreedy(vec, ep, level);
		}

		// Insert at each layer from nodeLayer down to 0
		for (let level = Math.min(nodeLayer, maxLayer); level >= 0; level--) {
			const candidates = searchLayer(vec, ep, efConstruction, level);
			const maxConn = level === 0 ? M_MAX0 : M;
			const neighbors = selectNeighbors(candidates, maxConn);

			for (const nIdx of neighbors) {
				if (nIdx !== idx) connect(idx, nIdx, level);
			}

			// Use closest as entry for next layer
			if (candidates.length > 0) {
				candidates.sort((a, b) => a.dist - b.dist);
				ep = candidates[0].idx;
			}
		}

		// Update entry point if new node has higher layer
		if (nodeLayer > maxLayer) {
			entryPoint = idx;
			maxLayer = nodeLayer;
		}

		sizeStore.set(activeCount);
	}

	function reconnectAtLayer(idx: number, level: number): void {
		// Find a starting point that isn't the node being reconnected
		let ep = entryPoint;
		if (ep === idx) {
			// Find any other active node to start from
			let altEp = -1;
			for (let i = 0; i < nodes.length; i++) {
				if (i !== idx && !nodes[i].deleted && nodes[i].layer >= level) {
					altEp = i;
					break;
				}
			}
			if (altEp === -1) return; // no other nodes at this level
			ep = altEp;
		}
		// Descend from top to target level
		for (let l = Math.min(maxLayer, nodes[ep].layer); l > level; l--) {
			ep = searchLayerGreedy(nodes[idx].vector, ep, l);
		}
		const candidates = searchLayer(nodes[idx].vector, ep, efConstruction, level);
		const maxConn = level === 0 ? M_MAX0 : M;
		const neighbors = selectNeighbors(candidates, maxConn);
		for (const nIdx of neighbors) {
			if (nIdx !== idx) connect(idx, nIdx, level);
		}
	}

	function remove(id: string): boolean {
		const idx = idToIdx.get(id);
		if (idx === undefined) return false;
		const node = nodes[idx];
		if (node.deleted) return false;

		node.deleted = true;
		activeCount--;
		sizeStore.set(activeCount);

		// If we deleted the entry point, find a new one
		if (idx === entryPoint) {
			let newEntry = -1;
			for (let i = 0; i < nodes.length; i++) {
				if (!nodes[i].deleted) {
					if (newEntry === -1 || nodes[i].layer > nodes[newEntry].layer) {
						newEntry = i;
					}
				}
			}
			entryPoint = newEntry;
			maxLayer = newEntry === -1 ? -1 : nodes[newEntry].layer;
		}

		return true;
	}

	function search(query: Float32Array | number[], k = 10): VectorSearchResult[] {
		if (activeCount === 0) return [];

		const q = toFloat32(query, dims);
		const effectiveK = Math.min(k, activeCount);
		const ef = Math.max(efSearch, effectiveK);

		// Greedy search from top layer down to layer 1
		let ep = entryPoint;
		for (let level = maxLayer; level > 0; level--) {
			ep = searchLayerGreedy(q, ep, level);
		}

		// Search at layer 0 with ef candidates
		const candidates = searchLayer(q, ep, ef, 0);

		// Sort by distance, take top k
		candidates.sort((a, b) => a.dist - b.dist);
		const results: VectorSearchResult[] = [];
		for (let i = 0; i < candidates.length && results.length < effectiveK; i++) {
			const node = nodes[candidates[i].idx];
			if (!node.deleted) {
				results.push({ id: node.id, distance: candidates[i].dist });
			}
		}

		return results;
	}

	function has(id: string): boolean {
		const idx = idToIdx.get(id);
		if (idx === undefined) return false;
		return !nodes[idx].deleted;
	}

	function destroy(): void {
		nodes.length = 0;
		idToIdx.clear();
		entryPoint = -1;
		maxLayer = -1;
		activeCount = 0;
		sizeStore.set(0);
		teardown(sizeStore);
	}

	return {
		add,
		remove,
		search,
		has,
		size: sizeStore,
		destroy,
	};
}
