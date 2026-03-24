import { describe, expect, it } from "vitest";
import { subscribe } from "../../core/subscribe";
import { vectorIndex } from "../../memory/vectorIndex";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a normalized random vector. */
function randomVector(dims: number): Float32Array {
	const v = new Float32Array(dims);
	let norm = 0;
	for (let i = 0; i < dims; i++) {
		v[i] = Math.random() * 2 - 1;
		norm += v[i] * v[i];
	}
	norm = Math.sqrt(norm);
	for (let i = 0; i < dims; i++) v[i] /= norm;
	return v;
}

/** One-hot vector: 1.0 at index `idx`, 0 elsewhere. */
function oneHot(dims: number, idx: number): Float32Array {
	const v = new Float32Array(dims);
	v[idx] = 1;
	return v;
}

// ---------------------------------------------------------------------------
// vectorIndex — Phase 6b
// ---------------------------------------------------------------------------
describe("vectorIndex — Phase 6b: In-process HNSW", () => {
	// --- Construction ---

	it("creates with required dimensions", () => {
		const idx = vectorIndex({ dimensions: 128 });
		expect(idx.size.get()).toBe(0);
		idx.destroy();
	});

	it("throws on invalid dimensions", () => {
		expect(() => vectorIndex({ dimensions: 0 })).toThrow("positive integer");
		expect(() => vectorIndex({ dimensions: -5 })).toThrow("positive integer");
	});

	it("throws on unknown distance metric", () => {
		expect(() => vectorIndex({ dimensions: 4, distance: "manhattan" as any })).toThrow(
			"Unknown distance",
		);
	});

	// --- Add & has ---

	it("add() stores vectors and has() finds them", () => {
		const idx = vectorIndex({ dimensions: 4 });
		idx.add("a", new Float32Array([1, 0, 0, 0]));
		idx.add("b", new Float32Array([0, 1, 0, 0]));

		expect(idx.has("a")).toBe(true);
		expect(idx.has("b")).toBe(true);
		expect(idx.has("c")).toBe(false);
		expect(idx.size.get()).toBe(2);
		idx.destroy();
	});

	it("add() accepts number[] as convenience", () => {
		const idx = vectorIndex({ dimensions: 3 });
		idx.add("a", [1, 0, 0]);
		expect(idx.has("a")).toBe(true);
		expect(idx.size.get()).toBe(1);
		idx.destroy();
	});

	it("add() throws on dimension mismatch", () => {
		const idx = vectorIndex({ dimensions: 4 });
		expect(() => idx.add("a", new Float32Array([1, 0, 0]))).toThrow("Expected 4 dimensions");
		idx.destroy();
	});

	it("add() throws on NaN/Infinity vector values", () => {
		const idx = vectorIndex({ dimensions: 3 });
		expect(() => idx.add("a", [NaN, 0, 0])).toThrow("non-finite");
		expect(() => idx.add("b", [0, Infinity, 0])).toThrow("non-finite");
		expect(() => idx.add("c", [0, 0, -Infinity])).toThrow("non-finite");
		idx.destroy();
	});

	it("add() copies input Float32Array (external mutation safe)", () => {
		const idx = vectorIndex({ dimensions: 3, distance: "euclidean" });
		const vec = new Float32Array([1, 0, 0]);
		idx.add("a", vec);

		// Mutate the original — should not affect the index
		vec[0] = 0;
		vec[1] = 1;

		const results = idx.search([1, 0, 0], 1);
		expect(results[0].id).toBe("a");
		expect(results[0].distance).toBeCloseTo(0, 5);
		idx.destroy();
	});

	it("add() replaces vector if ID already exists", () => {
		const idx = vectorIndex({ dimensions: 4 });
		idx.add("a", oneHot(4, 0));
		idx.add("b", oneHot(4, 1));
		idx.add("c", oneHot(4, 2));

		// Replace a's vector with same as c
		idx.add("a", oneHot(4, 2));

		// Search for the exact replaced vector — both a and c should be top results
		const results = idx.search(oneHot(4, 2), 3);
		const ids = results.map((r) => r.id);
		expect(ids).toContain("a");
		expect(ids).toContain("c");
		// a should have distance ≈ 0 (identical vector)
		const aResult = results.find((r) => r.id === "a")!;
		expect(aResult.distance).toBeCloseTo(0, 5);
		expect(idx.size.get()).toBe(3); // size unchanged
		idx.destroy();
	});

	// --- Remove ---

	it("remove() soft-deletes and returns true", () => {
		const idx = vectorIndex({ dimensions: 4 });
		idx.add("a", oneHot(4, 0));
		idx.add("b", oneHot(4, 1));

		expect(idx.remove("a")).toBe(true);
		expect(idx.has("a")).toBe(false);
		expect(idx.size.get()).toBe(1);

		// Search should not return deleted
		const results = idx.search(oneHot(4, 0), 5);
		expect(results.map((r) => r.id)).not.toContain("a");
		idx.destroy();
	});

	it("remove() returns false for unknown ID", () => {
		const idx = vectorIndex({ dimensions: 4 });
		expect(idx.remove("nope")).toBe(false);
		idx.destroy();
	});

	it("remove() returns false for already-deleted ID", () => {
		const idx = vectorIndex({ dimensions: 4 });
		idx.add("a", oneHot(4, 0));
		idx.remove("a");
		expect(idx.remove("a")).toBe(false);
		idx.destroy();
	});

	it("re-add after remove reactivates the node", () => {
		const idx = vectorIndex({ dimensions: 4 });
		idx.add("a", oneHot(4, 0));
		idx.remove("a");
		expect(idx.has("a")).toBe(false);

		idx.add("a", oneHot(4, 0));
		expect(idx.has("a")).toBe(true);
		expect(idx.size.get()).toBe(1);

		const results = idx.search(oneHot(4, 0), 1);
		expect(results[0].id).toBe("a");
		idx.destroy();
	});

	// --- Search: cosine (default) ---

	it("search() returns nearest neighbors by cosine distance", () => {
		const idx = vectorIndex({ dimensions: 4 });
		idx.add("x-axis", oneHot(4, 0));
		idx.add("y-axis", oneHot(4, 1));
		idx.add("z-axis", oneHot(4, 2));
		idx.add("w-axis", oneHot(4, 3));

		// Query along x-axis — x-axis should be closest (distance ≈ 0)
		const results = idx.search(oneHot(4, 0), 2);
		expect(results[0].id).toBe("x-axis");
		expect(results[0].distance).toBeCloseTo(0, 5);

		// Other axes should have distance ≈ 1 (orthogonal)
		expect(results[1].distance).toBeCloseTo(1, 5);
		idx.destroy();
	});

	it("search() returns empty for empty index", () => {
		const idx = vectorIndex({ dimensions: 4 });
		expect(idx.search(oneHot(4, 0))).toEqual([]);
		idx.destroy();
	});

	it("search() k > size returns all vectors", () => {
		const idx = vectorIndex({ dimensions: 4 });
		idx.add("a", oneHot(4, 0));
		idx.add("b", oneHot(4, 1));

		const results = idx.search(oneHot(4, 0), 100);
		expect(results.length).toBe(2);
		idx.destroy();
	});

	it("search() default k is 10", () => {
		const dims = 16;
		const idx = vectorIndex({ dimensions: dims });
		for (let i = 0; i < 20; i++) {
			idx.add(`v${i}`, randomVector(dims));
		}

		const results = idx.search(randomVector(dims));
		expect(results.length).toBe(10);
		idx.destroy();
	});

	// --- Search: euclidean ---

	it("search() with euclidean distance", () => {
		const idx = vectorIndex({ dimensions: 3, distance: "euclidean" });
		idx.add("origin", new Float32Array([0, 0, 0]));
		idx.add("near", new Float32Array([1, 0, 0]));
		idx.add("far", new Float32Array([10, 0, 0]));

		const results = idx.search(new Float32Array([0, 0, 0]), 3);
		expect(results[0].id).toBe("origin");
		expect(results[0].distance).toBeCloseTo(0, 5);
		expect(results[1].id).toBe("near");
		expect(results[1].distance).toBeCloseTo(1, 5);
		expect(results[2].id).toBe("far");
		expect(results[2].distance).toBeCloseTo(10, 5);
		idx.destroy();
	});

	// --- Search: dot product ---

	it("search() with dotProduct distance", () => {
		const idx = vectorIndex({ dimensions: 3, distance: "dotProduct" });
		idx.add("high", new Float32Array([1, 1, 1]));
		idx.add("medium", new Float32Array([0.5, 0.5, 0.5]));
		idx.add("low", new Float32Array([0, 0, 0]));

		// Query [1,1,1]: dot products are 3, 1.5, 0
		// dotProduct distance = -dot, so "high" has lowest distance (-3)
		const results = idx.search(new Float32Array([1, 1, 1]), 3);
		expect(results[0].id).toBe("high");
		expect(results[0].distance).toBeCloseTo(-3, 5);
		expect(results[1].id).toBe("medium");
		expect(results[2].id).toBe("low");
		idx.destroy();
	});

	// --- Search: query accepts number[] ---

	it("search() accepts number[] query", () => {
		const idx = vectorIndex({ dimensions: 3, distance: "euclidean" });
		idx.add("a", [1, 0, 0]);
		const results = idx.search([1, 0, 0], 1);
		expect(results[0].id).toBe("a");
		idx.destroy();
	});

	// --- Reactive size ---

	it("size store is reactive", () => {
		const idx = vectorIndex({ dimensions: 4 });
		const sizes: number[] = [];
		const sub = subscribe(idx.size, (v) => sizes.push(v));

		idx.add("a", oneHot(4, 0));
		idx.add("b", oneHot(4, 1));
		idx.remove("a");

		sub.unsubscribe();
		// subscribe delivers on changes only (no initial)
		expect(sizes).toEqual([1, 2, 1]);
		idx.destroy();
	});

	// --- Destroy ---

	it("destroy() clears all state", () => {
		const idx = vectorIndex({ dimensions: 4 });
		idx.add("a", oneHot(4, 0));
		idx.add("b", oneHot(4, 1));

		idx.destroy();
		// After destroy, search returns empty
		expect(idx.search(oneHot(4, 0))).toEqual([]);
	});

	// --- HNSW-specific: multi-layer navigation ---

	it("correctly indexes and retrieves with many vectors", () => {
		const dims = 32;
		const idx = vectorIndex({ dimensions: dims, m: 8, efConstruction: 100, efSearch: 30 });

		// Insert 200 random vectors
		const vectors = new Map<string, Float32Array>();
		for (let i = 0; i < 200; i++) {
			const v = randomVector(dims);
			vectors.set(`v${i}`, v);
			idx.add(`v${i}`, v);
		}
		expect(idx.size.get()).toBe(200);

		// Pick a known vector and verify it's its own nearest neighbor
		const target = vectors.get("v42")!;
		const results = idx.search(target, 1);
		expect(results[0].id).toBe("v42");
		expect(results[0].distance).toBeCloseTo(0, 4);
		idx.destroy();
	});

	it("search quality: nearest brute-force neighbor is in top-k results", () => {
		const dims = 16;
		const n = 100;
		const idx = vectorIndex({ dimensions: dims, m: 16, efConstruction: 200, efSearch: 50 });

		const vectors: Float32Array[] = [];
		for (let i = 0; i < n; i++) {
			const v = randomVector(dims);
			vectors.push(v);
			idx.add(`v${i}`, v);
		}

		// Random query
		const query = randomVector(dims);

		// Brute-force nearest
		let bestIdx = 0;
		let bestDist = Infinity;
		for (let i = 0; i < n; i++) {
			let dot = 0;
			let normA = 0;
			let normB = 0;
			for (let d = 0; d < dims; d++) {
				dot += query[d] * vectors[i][d];
				normA += query[d] * query[d];
				normB += vectors[i][d] * vectors[i][d];
			}
			const dist = 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
			if (dist < bestDist) {
				bestDist = dist;
				bestIdx = i;
			}
		}

		// HNSW should find the true nearest in top-5
		const results = idx.search(query, 5);
		const topIds = results.map((r) => r.id);
		expect(topIds).toContain(`v${bestIdx}`);
		idx.destroy();
	});

	// --- Edge cases ---

	it("single vector: search returns it", () => {
		const idx = vectorIndex({ dimensions: 2 });
		idx.add("only", new Float32Array([1, 0]));

		const results = idx.search(new Float32Array([0, 1]), 5);
		expect(results.length).toBe(1);
		expect(results[0].id).toBe("only");
		idx.destroy();
	});

	it("remove entry point: search still works", () => {
		const idx = vectorIndex({ dimensions: 4, m: 4 });
		// Add several vectors — first one is likely the initial entry point
		idx.add("first", oneHot(4, 0));
		idx.add("second", oneHot(4, 1));
		idx.add("third", oneHot(4, 2));
		idx.add("fourth", oneHot(4, 3));

		// Remove the first (original entry point)
		idx.remove("first");
		expect(idx.size.get()).toBe(3);

		// Search should still work
		const results = idx.search(oneHot(4, 1), 1);
		expect(results[0].id).toBe("second");
		idx.destroy();
	});

	it("remove all vectors: search returns empty", () => {
		const idx = vectorIndex({ dimensions: 4 });
		idx.add("a", oneHot(4, 0));
		idx.add("b", oneHot(4, 1));
		idx.remove("a");
		idx.remove("b");

		expect(idx.size.get()).toBe(0);
		expect(idx.search(oneHot(4, 0))).toEqual([]);
		idx.destroy();
	});

	// --- Results are sorted ---

	it("results are sorted by distance ascending", () => {
		const idx = vectorIndex({ dimensions: 3, distance: "euclidean" });
		idx.add("a", new Float32Array([0, 0, 0]));
		idx.add("b", new Float32Array([5, 0, 0]));
		idx.add("c", new Float32Array([2, 0, 0]));
		idx.add("d", new Float32Array([8, 0, 0]));

		const results = idx.search(new Float32Array([0, 0, 0]), 4);
		for (let i = 1; i < results.length; i++) {
			expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
		}
		idx.destroy();
	});
});
