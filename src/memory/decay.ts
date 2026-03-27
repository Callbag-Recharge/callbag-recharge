// ---------------------------------------------------------------------------
// Phase 1: Decay Scoring
// ---------------------------------------------------------------------------
// OpenViking-inspired decay scoring for memory nodes.
// Frequency and recency are composed multiplicatively:
//
// score = α * (sigmoid(log1p(accessCount)) * exp_decay(age, halfLife))
//       + β * importance
//       + γ * sigmoid(log1p(accessCount))
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
		const frequencySignal = 1 / (1 + Math.exp(-Math.log1p(meta.accessCount)));
		return α * (frequencySignal * recencyDecay) + β * meta.importance + γ * frequencySignal;
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
	const frequencySignal = 1 / (1 + Math.exp(-Math.log1p(meta.accessCount)));
	return α * (frequencySignal * recencyDecay) + β * meta.importance + γ * frequencySignal;
}
