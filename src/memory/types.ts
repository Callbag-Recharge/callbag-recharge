// ---------------------------------------------------------------------------
// Memory module types — Phase 1 (Memory Primitives)
// ---------------------------------------------------------------------------

import type { Store, WritableStore } from "../core/types";
import type { ReactiveIndex } from "../data/types";

// ---------------------------------------------------------------------------
// Phase 1: Memory Primitives
// ---------------------------------------------------------------------------

export interface MemoryMeta {
	id: string;
	createdAt: number;
	updatedAt: number;
	accessedAt: number;
	accessCount: number;
	importance: number; // 0–1
	tags: Set<string>;
}

export interface MemoryNode<T> {
	/** The memory's unique ID. */
	readonly id: string;
	/** Reactive content store. */
	content: WritableStore<T>;
	/** Reactive metadata store. */
	meta: Store<MemoryMeta>;

	/** Update accessedAt + increment accessCount. */
	touch(): void;
	/** Add tags. */
	tag(...tags: string[]): void;
	/** Remove tags. */
	untag(...tags: string[]): void;
	/** Set importance (0–1). */
	setImportance(value: number): void;
	/** Update content and bump updatedAt. */
	update(value: T): void;

	/** Compute relevance score with given weights (synchronous). */
	score(weights?: ScoreWeights): number;
	/** Reactive score store (recomputes when meta changes). */
	scoreStore: Store<number>;

	/** Tear down all internal stores. */
	destroy(): void;
}

export interface ScoreWeights {
	/** Weight for recency (time since last access). Default: 1 */
	recency?: number;
	/** Weight for importance. Default: 1 */
	importance?: number;
	/** Weight for access frequency. Default: 0.5 */
	frequency?: number;
	/** Half-life for recency decay in ms. Default: 86400000 (24h) */
	halfLife?: number;
}

export interface MemoryNodeOptions {
	/** Custom ID. Auto-generated if omitted. */
	id?: string;
	/** Initial importance (0–1). Default: 0.5 */
	importance?: number;
	/** Initial tags. */
	tags?: string[];
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

export interface Collection<T> {
	/** Add a new memory node to the collection. */
	add(content: T, opts?: MemoryNodeOptions): MemoryNode<T>;
	/** Remove a node by reference or ID. Returns true if found. */
	remove(nodeOrId: MemoryNode<T> | string): boolean;
	/** Get a node by ID. */
	get(id: string): MemoryNode<T> | undefined;
	/** Check if a node exists by ID. */
	has(id: string): boolean;

	/** Reactive store of all nodes. */
	nodes: Store<MemoryNode<T>[]>;
	/** Reactive size store. */
	size: Store<number>;

	/** Query nodes with a filter function (snapshot). */
	query(filter: (node: MemoryNode<T>) => boolean): MemoryNode<T>[];
	/** Get nodes by tag (snapshot). O(1) via reactiveIndex. */
	byTag(tag: string): MemoryNode<T>[];
	/** Get top-K nodes by score (snapshot). */
	topK(k: number, weights?: ScoreWeights): MemoryNode<T>[];

	/** Reactive tag index — select(tag) returns reactive Set<nodeId>. */
	readonly tagIndex: ReactiveIndex;

	/** Tear down all nodes and internal stores. */
	destroy(): void;
}

export interface CollectionOptions {
	/** Maximum number of nodes. Oldest (by score) are evicted on overflow. */
	maxSize?: number;
	/** Default score weights for topK and eviction. */
	weights?: ScoreWeights;
}

// ---------------------------------------------------------------------------
// Decay
// ---------------------------------------------------------------------------

export interface DecayOptions {
	/** Half-life in ms. Default: 86400000 (24h) */
	halfLife?: number;
	/** Recency weight (α). Default: 1 */
	recency?: number;
	/** Importance weight (β). Default: 1 */
	importance?: number;
	/** Frequency weight (γ). Default: 0.5 */
	frequency?: number;
}

export type DecayFn = (meta: MemoryMeta, now?: number) => number;

// ---------------------------------------------------------------------------
// Vector Index (Phase 6b)
// ---------------------------------------------------------------------------

/** Distance metric for vector comparison. */
export type DistanceMetric = "cosine" | "euclidean" | "dotProduct";

export interface VectorIndexOptions {
	/** Vector dimensionality (required). */
	dimensions: number;
	/** HNSW connections per layer. Default: 16 */
	m?: number;
	/** Build-time beam width. Default: 200 */
	efConstruction?: number;
	/** Query-time beam width. Default: 50 */
	efSearch?: number;
	/** Distance metric. Default: 'cosine' */
	distance?: DistanceMetric;
}

export interface VectorSearchResult {
	/** ID of the matched vector. */
	id: string;
	/** Distance to query (lower = more similar for cosine/euclidean; higher = more similar for dotProduct). */
	distance: number;
}

export interface VectorIndex {
	/** Add a vector with the given ID. Replaces if ID already exists. */
	add(id: string, vector: Float32Array | number[]): void;
	/** Remove a vector by ID. Returns true if found. */
	remove(id: string): boolean;
	/** Search for the k nearest neighbors. Returns results sorted by distance (ascending). */
	search(query: Float32Array | number[], k?: number): VectorSearchResult[];
	/** Check if a vector exists by ID. */
	has(id: string): boolean;
	/** Reactive size store. */
	readonly size: Store<number>;
	/** Tear down internal stores. */
	destroy(): void;
}
