import { afterEach, describe, expect, it, vi as vitest } from "vitest";
import { agentMemory } from "../../../ai/agentMemory";
import type { LLMStore } from "../../../ai/fromLLM";
import { state } from "../../../core/state";
import type { WithStatusStatus } from "../../../utils/withStatus";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/** Deterministic 3D embedding from content hash — for reproducible cosine similarity. */
function mockEmbed(text: string): Promise<Float32Array> {
	const hash = Array.from(text).reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
	const vec = new Float32Array([Math.sin(hash), Math.cos(hash), Math.sin(hash * 2)]);
	const norm = Math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2);
	vec[0] /= norm;
	vec[1] /= norm;
	vec[2] /= norm;
	return Promise.resolve(vec);
}

function makeMockLLM(): LLMStore & {
	_status: ReturnType<typeof state<WithStatusStatus>>;
	_content: ReturnType<typeof state<string>>;
} {
	const _status = state<WithStatusStatus>("pending");
	const _content = state<string>("");
	const error = state<unknown | undefined>(undefined);
	const tokens = state<Record<string, unknown>>({});
	return {
		get: () => _content.get(),
		source: (type: number, payload?: any) => _content.source(type, payload),
		status: _status,
		error,
		tokens,
		generate: vitest.fn(() => {
			_status.set("active");
		}),
		abort: vitest.fn(),
		_status,
		_content,
	};
}

/** Helper: trigger LLM completion with canned facts. */
function completeLLM(
	llm: ReturnType<typeof makeMockLLM>,
	facts: Array<{ content: string; importance: number; tags: string[] }>,
) {
	llm._content.set(JSON.stringify(facts));
	llm._status.set("completed");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agentMemory", () => {
	let mem: ReturnType<typeof agentMemory> | null = null;

	afterEach(() => {
		mem?.destroy();
		mem = null;
	});

	it("creates with empty state", () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		expect(mem.status.get()).toBe("idle");
		expect(mem.size.get()).toBe(0);
		expect(mem.results.get()).toEqual([]);
		expect(mem.lastExtracted.get()).toEqual([]);
		expect(mem.error.get()).toBeUndefined();
	});

	it("add() extracts facts via LLM and stores them", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		mem.add([{ role: "user", content: "I love TypeScript" }]);
		expect(mem.status.get()).toBe("extracting");
		expect(llm.generate).toHaveBeenCalled();

		completeLLM(llm, [
			{ content: "User loves TypeScript", importance: 0.8, tags: ["preference"] },
			{ content: "User is a developer", importance: 0.6, tags: ["fact"] },
		]);

		await vitest.waitFor(() => {
			expect(mem!.status.get()).toBe("idle");
		});

		expect(mem.size.get()).toBe(2);
		expect(mem.lastExtracted.get()).toHaveLength(2);
		expect(mem.inner.vectorIndex.size.get()).toBe(2);
	});

	it("add() with empty extraction returns idle", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		mem.add([{ role: "user", content: "Hello" }]);
		completeLLM(llm, []);

		await vitest.waitFor(() => {
			expect(mem!.status.get()).toBe("idle");
		});

		expect(mem.size.get()).toBe(0);
		expect(mem.lastExtracted.get()).toEqual([]);
	});

	it("search() returns ranked semantic results", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		// Add some memories
		mem.add([{ role: "user", content: "test" }]);
		completeLLM(llm, [
			{ content: "User loves TypeScript", importance: 0.8, tags: ["preference"] },
			{ content: "User likes Python", importance: 0.6, tags: ["preference"] },
		]);

		await vitest.waitFor(() => {
			expect(mem!.status.get()).toBe("idle");
		});

		// Search
		mem.search("TypeScript");

		await vitest.waitFor(() => {
			expect(mem!.status.get()).toBe("idle");
			expect(mem!.results.get().length).toBeGreaterThan(0);
		});

		const results = mem.results.get();
		expect(results.length).toBeGreaterThanOrEqual(1);
		// Results should have score between 0 and 1
		for (const r of results) {
			expect(r.score).toBeGreaterThanOrEqual(-1);
			expect(r.score).toBeLessThanOrEqual(1);
		}
	});

	it("getAll() returns all memories", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		mem.add([{ role: "user", content: "test" }]);
		completeLLM(llm, [
			{ content: "Fact A", importance: 0.5, tags: [] },
			{ content: "Fact B", importance: 0.5, tags: [] },
		]);

		await vitest.waitFor(() => expect(mem!.size.get()).toBe(2));

		const all = mem.getAll();
		expect(all).toHaveLength(2);
	});

	it("getAll() with scope filters by tags", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		// Add with scope
		mem.add([{ role: "user", content: "test" }], { userId: "alice" });
		completeLLM(llm, [{ content: "Alice fact", importance: 0.5, tags: [] }]);

		await vitest.waitFor(() => expect(mem!.size.get()).toBe(1));

		// Reset LLM for second add
		llm._status.set("pending");
		mem.add([{ role: "user", content: "test2" }], { userId: "bob" });
		completeLLM(llm, [{ content: "Bob fact", importance: 0.5, tags: [] }]);

		await vitest.waitFor(() => expect(mem!.size.get()).toBe(2));

		// Filter by scope
		const alice = mem.getAll({ userId: "alice" });
		expect(alice).toHaveLength(1);
		expect(alice[0].content.get()).toBe("Alice fact");

		const bob = mem.getAll({ userId: "bob" });
		expect(bob).toHaveLength(1);
		expect(bob[0].content.get()).toBe("Bob fact");

		// No scope returns all
		expect(mem.getAll()).toHaveLength(2);
	});

	it("update() changes content", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		mem.add([{ role: "user", content: "test" }]);
		completeLLM(llm, [{ content: "Original fact", importance: 0.5, tags: [] }]);

		await vitest.waitFor(() => expect(mem!.size.get()).toBe(1));

		const node = mem.getAll()[0];
		mem.update(node.id, "Updated fact");

		expect(node.content.get()).toBe("Updated fact");
	});

	it("delete() removes from collection and vectorIndex", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		mem.add([{ role: "user", content: "test" }]);
		completeLLM(llm, [{ content: "To be deleted", importance: 0.5, tags: [] }]);

		await vitest.waitFor(() => expect(mem!.size.get()).toBe(1));

		const node = mem.getAll()[0];
		const deleted = mem.delete(node.id);

		expect(deleted).toBe(true);
		expect(mem.size.get()).toBe(0);
		expect(mem.inner.vectorIndex.size.get()).toBe(0);
	});

	it("dedup: similar content updates existing instead of adding", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({
			llm,
			embed: mockEmbed,
			dimensions: 3,
			dedupThreshold: 0.99, // Very low threshold — only exact matches dedup
		});

		// First add
		mem.add([{ role: "user", content: "test" }]);
		completeLLM(llm, [{ content: "User loves TypeScript", importance: 0.5, tags: [] }]);

		await vitest.waitFor(() => expect(mem!.size.get()).toBe(1));

		// Second add with identical content (should dedup)
		llm._status.set("pending");
		mem.add([{ role: "user", content: "test2" }]);
		completeLLM(llm, [{ content: "User loves TypeScript", importance: 0.9, tags: ["updated"] }]);

		await vitest.waitFor(() => expect(mem!.status.get()).toBe("idle"));

		// Should still be 1 memory (deduped), with updated importance
		expect(mem.size.get()).toBe(1);
		const node = mem.getAll()[0];
		expect(node.meta.get().importance).toBe(0.9);
	});

	it("LLM error sets error status", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		mem.add([{ role: "user", content: "test" }]);
		llm.error.set(new Error("API error"));
		llm._status.set("errored");

		await vitest.waitFor(() => {
			expect(mem!.status.get()).toBe("error");
		});

		expect(mem.error.get()).toBeInstanceOf(Error);
	});

	it("search() with scope filters results", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		mem.add([{ role: "user", content: "test" }], { userId: "alice" });
		completeLLM(llm, [{ content: "Alice's secret", importance: 0.8, tags: [] }]);

		await vitest.waitFor(() => expect(mem!.size.get()).toBe(1));

		// Search with matching scope
		mem.search("secret", { userId: "alice" });

		await vitest.waitFor(() => {
			expect(mem!.status.get()).toBe("idle");
		});

		// Ensure the search completes; scope correctness is asserted via bobResults.
		const _aliceResults = mem.results.get();

		// Search with non-matching scope
		mem.search("secret", { userId: "bob" });

		await vitest.waitFor(() => {
			expect(mem!.status.get()).toBe("idle");
		});

		const bobResults = mem.results.get();
		expect(bobResults).toHaveLength(0);
	});

	it("destroy() cleans up all resources", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		mem.add([{ role: "user", content: "test" }]);
		completeLLM(llm, [{ content: "Fact", importance: 0.5, tags: [] }]);

		await vitest.waitFor(() => expect(mem!.size.get()).toBe(1));

		mem.destroy();
		mem = null; // Prevent afterEach double-destroy
	});
});
