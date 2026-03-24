// ---------------------------------------------------------------------------
// Memory module
// ---------------------------------------------------------------------------

export { collection } from "./collection";
export { computeScore, decay } from "./decay";
export { memoryNode } from "./node";
// Types
export type {
	Collection,
	CollectionOptions,
	DecayFn,
	DecayOptions,
	DistanceMetric,
	MemoryMeta,
	MemoryNode,
	MemoryNodeOptions,
	ScoreWeights,
	VectorIndex,
	VectorIndexOptions,
	VectorSearchResult,
} from "./types";
export { vectorIndex } from "./vectorIndex";
