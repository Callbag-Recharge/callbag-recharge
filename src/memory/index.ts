// ---------------------------------------------------------------------------
// Memory module
// ---------------------------------------------------------------------------

export { collection } from "./collection";
export { computeScore, decay } from "./decay";
export { memoryNode } from "./node";
// Types
export type {
	AdmissionDecision,
	AdmissionPolicyFn,
	Collection,
	CollectionOptions,
	DecayFn,
	DecayOptions,
	DistanceMetric,
	ForgetPolicyFn,
	MemoryMeta,
	MemoryNode,
	MemoryNodeOptions,
	ScoreWeights,
	VectorIndex,
	VectorIndexOptions,
	VectorSearchResult,
} from "./types";
export { vectorIndex } from "./vectorIndex";
