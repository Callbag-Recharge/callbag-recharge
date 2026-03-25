// ---------------------------------------------------------------------------
// agentMemory dedup — cosine similarity check via vectorIndex
// ---------------------------------------------------------------------------

import type { VectorIndex } from "../../memory/types";

export interface DedupResult {
	/** Whether a similar memory already exists above the threshold. */
	isDuplicate: boolean;
	/** ID of the existing similar memory (if duplicate). */
	existingId?: string;
	/** Cosine similarity to the nearest match (0–1, higher = more similar). */
	similarity: number;
}

/**
 * Check if a vector is a duplicate of an existing entry in the index.
 *
 * For cosine distance: distance ∈ [0, 2], where 0 = identical.
 * Similarity = 1 - distance (for cosine).
 *
 * @param vi - The vector index to search.
 * @param embedding - The embedding to check.
 * @param threshold - Similarity threshold (0–1). Above this = duplicate.
 */
export function checkDedup(
	vi: VectorIndex,
	embedding: Float32Array | number[],
	threshold: number,
): DedupResult {
	if (vi.size.get() === 0) {
		return { isDuplicate: false, similarity: 0 };
	}

	const results = vi.search(embedding, 1);
	if (results.length === 0) {
		return { isDuplicate: false, similarity: 0 };
	}

	const nearest = results[0];
	// Cosine distance: 0 = identical, 2 = opposite. Convert to similarity.
	const similarity = 1 - nearest.distance;

	if (similarity >= threshold) {
		return { isDuplicate: true, existingId: nearest.id, similarity };
	}

	return { isDuplicate: false, similarity };
}
