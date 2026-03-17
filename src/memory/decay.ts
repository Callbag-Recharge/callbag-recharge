// ---------------------------------------------------------------------------
// Phase 1: Decay Scoring
// ---------------------------------------------------------------------------
// FadeMem-inspired exponential decay scoring for memory nodes.
// Combines recency, importance, and access frequency into a single score.
//
// score = α × recencyDecay + β × importance + γ × frequencyFactor
//
// recencyDecay = 2^(-timeSinceAccess / halfLife)   [exponential decay]
// frequencyFactor = 1 - 1/(1 + accessCount)        [saturating curve]
// ---------------------------------------------------------------------------

import type { DecayFn, DecayOptions, MemoryMeta, ScoreWeights } from "./types";

const DEFAULT_HALF_LIFE = 86_400_000; // 24 hours

/**
 * Create a decay scoring function with fixed weights.
 * Returns a pure function: (meta, now?) => score
 */
export function decay(opts?: DecayOptions): DecayFn {
	const halfLife = opts?.halfLife ?? DEFAULT_HALF_LIFE;
	const α = opts?.recency ?? 1;
	const β = opts?.importance ?? 1;
	const γ = opts?.frequency ?? 0.5;
	const ln2OverHalfLife = Math.LN2 / halfLife;

	return (meta: MemoryMeta, now?: number): number => {
		const t = (now ?? Date.now()) - meta.accessedAt;
		const recencyDecay = Math.exp(-ln2OverHalfLife * t);
		const frequencyFactor = 1 - 1 / (1 + meta.accessCount);
		return α * recencyDecay + β * meta.importance + γ * frequencyFactor;
	};
}

/**
 * One-shot score computation with inline weights.
 * Avoids closure allocation when you just need a single score.
 */
export function computeScore(meta: MemoryMeta, weights?: ScoreWeights, now?: number): number {
	const halfLife = weights?.halfLife ?? DEFAULT_HALF_LIFE;
	const α = weights?.recency ?? 1;
	const β = weights?.importance ?? 1;
	const γ = weights?.frequency ?? 0.5;

	const t = (now ?? Date.now()) - meta.accessedAt;
	const recencyDecay = Math.exp((-Math.LN2 / halfLife) * t);
	const frequencyFactor = 1 - 1 / (1 + meta.accessCount);
	return α * recencyDecay + β * meta.importance + γ * frequencyFactor;
}
