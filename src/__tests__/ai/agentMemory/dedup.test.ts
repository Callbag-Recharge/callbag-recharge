import { describe, expect, it } from "vitest";
import { checkDedup } from "../../../ai/agentMemory/dedup";
import { vectorIndex } from "../../../memory/vectorIndex";

describe("checkDedup", () => {
	it("returns not duplicate when vectorIndex is empty", () => {
		const vi = vectorIndex({ dimensions: 3 });
		const result = checkDedup(vi, [1, 0, 0], 0.85);
		expect(result.isDuplicate).toBe(false);
		expect(result.similarity).toBe(0);
		vi.destroy();
	});

	it("detects identical vectors as duplicates", () => {
		const vi = vectorIndex({ dimensions: 3 });
		vi.add("existing", new Float32Array([1, 0, 0]));

		const result = checkDedup(vi, [1, 0, 0], 0.85);
		expect(result.isDuplicate).toBe(true);
		expect(result.existingId).toBe("existing");
		expect(result.similarity).toBeCloseTo(1, 1);
		vi.destroy();
	});

	it("detects similar vectors above threshold as duplicates", () => {
		const vi = vectorIndex({ dimensions: 3 });
		// Normalized vector [1, 0, 0]
		vi.add("existing", new Float32Array([1, 0, 0]));

		// Slightly different — still very similar
		const similar = new Float32Array([0.99, 0.1, 0]);
		const result = checkDedup(vi, similar, 0.85);
		expect(result.isDuplicate).toBe(true);
		expect(result.existingId).toBe("existing");
		expect(result.similarity).toBeGreaterThan(0.85);
		vi.destroy();
	});

	it("does not flag dissimilar vectors as duplicates", () => {
		const vi = vectorIndex({ dimensions: 3 });
		vi.add("existing", new Float32Array([1, 0, 0]));

		// Orthogonal vector — similarity ≈ 0
		const result = checkDedup(vi, [0, 1, 0], 0.85);
		expect(result.isDuplicate).toBe(false);
		expect(result.similarity).toBeLessThan(0.85);
		vi.destroy();
	});

	it("returns closest match ID when duplicate", () => {
		const vi = vectorIndex({ dimensions: 3 });
		vi.add("a", new Float32Array([1, 0, 0]));
		vi.add("b", new Float32Array([0, 1, 0]));

		const result = checkDedup(vi, [0.98, 0.1, 0], 0.85);
		expect(result.isDuplicate).toBe(true);
		expect(result.existingId).toBe("a");
		vi.destroy();
	});
});
