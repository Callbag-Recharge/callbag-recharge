// ---------------------------------------------------------------------------
// Memory module — Phase 1 (Memory Primitives)
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
	MemoryMeta,
	MemoryNode,
	MemoryNodeOptions,
	ScoreWeights,
} from "./types";
