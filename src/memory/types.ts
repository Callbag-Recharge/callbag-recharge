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
// Admission Control (Phase 6d)
// ---------------------------------------------------------------------------

/** Decision returned by an admission policy when a new memory is added. */
export type AdmissionDecision<T> =
	| { action: "admit" }
	| { action: "reject" }
	| { action: "update"; targetId: string; content: T }
	| { action: "merge"; targetId: string; reducer: (existing: T, incoming: T) => T };

/**
 * Admission policy function. Called on every `add()` with the incoming content
 * and a snapshot of existing nodes. Returns a decision controlling whether to
 * admit, reject, update an existing node, or merge into one.
 */
export type AdmissionPolicyFn<T> = (incoming: T, nodes: MemoryNode<T>[]) => AdmissionDecision<T>;

/**
 * Forget policy function. Called before each new `add()` (on existing nodes only,
 * never on the node being admitted) and on explicit `gc()` calls.
 * Return `true` to remove the node from the collection.
 */
export type ForgetPolicyFn<T> = (node: MemoryNode<T>) => boolean;

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

export interface Collection<T> {
	/**
	 * Add a new memory node to the collection.
	 * When an `admissionPolicy` is configured, returns `undefined` if the policy rejects,
	 * or the updated/merged existing node for `update`/`merge` decisions.
	 */
	add(content: T, opts?: MemoryNodeOptions): MemoryNode<T> | undefined;
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

	/**
	 * Consolidate multiple nodes into one. Removes source nodes and creates
	 * a new node with the reducer's output. Synchronous — async summarization
	 * (e.g. via LLM) belongs at a higher layer.
	 */
	summarize(
		nodeIds: string[],
		reducer: (nodes: MemoryNode<T>[]) => T,
		opts?: MemoryNodeOptions,
	): MemoryNode<T>;

	/**
	 * Run the forget policy on all nodes. Returns the number of nodes removed.
	 * No-op if no `forgetPolicy` is configured.
	 */
	gc(): number;

	/** Reactive tag index — select(tag) returns reactive Set<nodeId>. */
	readonly tagIndex: ReactiveIndex;

	/** Tear down all nodes and internal stores. */
	destroy(): void;
}

export interface CollectionOptions<T = unknown> {
	/** Maximum number of nodes. Oldest (by score) are evicted on overflow. */
	maxSize?: number;
	/** Default score weights for topK and eviction. */
	weights?: ScoreWeights;
	/**
	 * Admission policy — controls whether new memories are admitted, rejected,
	 * merged with an existing node, or used to update one. Called on every `add()`.
	 */
	admissionPolicy?: AdmissionPolicyFn<T>;
	/**
	 * Forget policy — predicate called on existing nodes before each `add()` and during `gc()`.
	 * The newly-admitted node is never evaluated. Return `true` to remove a node.
	 */
	forgetPolicy?: ForgetPolicyFn<T>;
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

// ---------------------------------------------------------------------------
// Session Transport (Phase 6a)
// ---------------------------------------------------------------------------

/** JSON-safe representation of a MemoryNode's metadata. */
export interface SerializedMeta {
	id: string;
	createdAt: number;
	updatedAt: number;
	accessedAt: number;
	accessCount: number;
	importance: number;
	tags: string[];
}

/** JSON-safe representation of a MemoryNode. */
export interface SerializedNode<T = unknown> {
	id: string;
	content: T;
	meta: SerializedMeta;
}

/** Structured change events emitted by `sessionSync`. */
export type SessionEvent<T = unknown> =
	| { type: "snapshot"; nodes: SerializedNode<T>[] }
	| { type: "add"; nodes: SerializedNode<T>[] }
	| { type: "remove"; nodeIds: string[] }
	| { type: "update"; nodes: SerializedNode<T>[] };

/** Pluggable transport backend — "same graph, different edge." */
export interface SessionTransport<T = unknown> {
	/** Send a session event to the remote. */
	send(event: SessionEvent<T>): void;
	/** Close the transport and release resources. */
	close(): void;
}

export interface SessionSyncOptions {
	/** Debug name for Inspector. */
	name?: string;
	/** Send an initial snapshot on connect. Default: true. */
	initialSnapshot?: boolean;
}

export interface WsTransportOptions<T = unknown> {
	/** Custom serializer for a single event. Default: JSON.stringify. */
	serialize?: (event: SessionEvent<T>) => string;
}

export interface HttpTransportOptions<T = unknown> {
	/** HTTP method. Default: "POST". */
	method?: string;
	/** Extra headers. */
	headers?: Record<string, string>;
	/** Batch window in ms. Events are collected and sent together. 0 = send immediately. Default: 0. */
	batchMs?: number;
	/**
	 * Custom serializer for a batch of events. Default: JSON.stringify.
	 * Note: takes an array (not a single event) because HTTP batches multiple
	 * events per request. Even in immediate mode (batchMs=0), the single event
	 * is wrapped in a one-element array for a uniform wire format.
	 */
	serialize?: (events: SessionEvent<T>[]) => string;
}
