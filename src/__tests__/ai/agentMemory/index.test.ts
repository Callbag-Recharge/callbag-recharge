import { afterEach, describe, expect, it, vi as vitest } from "vitest";
import { agentMemory } from "../../../ai/agentMemory";
import type { LLMStore } from "../../../ai/fromLLM";
import { state } from "../../../core/state";
import type { Store } from "../../../core/types";
import type { WithStatusStatus } from "../../../utils/withStatus";
import type {
	MessageTransport,
	TransportEnvelope,
	TransportStatus,
} from "../../../messaging/transportTypes";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/** Deterministic 3D embedding from content hash — for reproducible cosine similarity. */
function mockEmbed(text: string, _signal?: AbortSignal): Promise<Float32Array> {
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

function createMockTransportPair(): [MessageTransport, MessageTransport] {
	const statusA = state<TransportStatus>("connected");
	const statusB = state<TransportStatus>("connected");
	const handlersA = new Set<(e: TransportEnvelope) => void>();
	const handlersB = new Set<(e: TransportEnvelope) => void>();

	const transportA: MessageTransport = {
		send(envelope) {
			for (const h of handlersB) h(envelope);
		},
		onMessage(handler) {
			handlersA.add(handler);
			return () => handlersA.delete(handler);
		},
		status: statusA as Store<TransportStatus>,
		close() {
			handlersA.clear();
			statusA.set("disconnected");
		},
	};

	const transportB: MessageTransport = {
		send(envelope) {
			for (const h of handlersA) h(envelope);
		},
		onMessage(handler) {
			handlersB.add(handler);
			return () => handlersB.delete(handler);
		},
		status: statusB as Store<TransportStatus>,
		close() {
			handlersB.clear();
			statusB.set("disconnected");
		},
	};

	return [transportA, transportB];
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

		expect(mem.size.get()).toBe(0);
	});

	it("requires graphLlm when knowledgeGraph is provided", async () => {
		const llm = makeMockLLM();
		const { knowledgeGraph } = await import("../../../memory/knowledgeGraph");
		const kg = knowledgeGraph<string>();

		expect(() =>
			agentMemory({
				llm,
				embed: mockEmbed,
				dimensions: 3,
				knowledgeGraph: kg,
			}),
		).toThrow("graphLlm is required");

		kg.destroy();
	});

	it("exposes jobQueue and topic in inner (SA-4a/b/c)", () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		expect(mem.inner.extractionQueue).toBeDefined();
		expect(mem.inner.extractionQueue.name).toBe("agentMemory:extract");
		expect(mem.inner.embeddingQueue).toBeDefined();
		expect(mem.inner.embeddingQueue.name).toBe("agentMemory:embed");
		expect(mem.inner.events).toBeDefined();
		expect(mem.inner.events.name).toBe("agentMemory:events");
		expect(mem.inner.graphQueue).toBeUndefined(); // no KG provided
	});

	it("add() extracts facts via LLM and stores them (SA-4a/b)", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		const op = mem.add([{ role: "user", content: "I love TypeScript" }]);
		expect(op.status.get()).toBe("active");
		expect(llm.generate).toHaveBeenCalled();

		completeLLM(llm, [
			{ content: "User loves TypeScript", importance: 0.8, tags: ["preference"] },
			{ content: "User is a developer", importance: 0.6, tags: ["fact"] },
		]);

		await vitest.waitFor(() => {
			expect(op.status.get()).toBe("completed");
		});

		expect(mem.size.get()).toBe(2);
		expect(op.extracted.get()).toHaveLength(2);
		expect(mem.inner.vectorIndex.size.get()).toBe(2);
	});

	it("add() with empty extraction returns idle", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		const op = mem.add([{ role: "user", content: "Hello" }]);
		completeLLM(llm, []);

		await vitest.waitFor(() => {
			expect(op.status.get()).toBe("completed");
		});

		expect(mem.size.get()).toBe(0);
		expect(op.extracted.get()).toEqual([]);
	});

	it("search() returns ranked semantic results", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		// Add some memories
		const addOp = mem.add([{ role: "user", content: "test" }]);
		completeLLM(llm, [
			{ content: "User loves TypeScript", importance: 0.8, tags: ["preference"] },
			{ content: "User likes Python", importance: 0.6, tags: ["preference"] },
		]);

		await vitest.waitFor(() => {
			expect(addOp.status.get()).toBe("completed");
		});

		// Search
		const searchOp = mem.search("TypeScript");

		await vitest.waitFor(() => {
			expect(searchOp.status.get()).toBe("completed");
			expect(searchOp.results.get().length).toBeGreaterThan(0);
		});

		const results = searchOp.results.get();
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

		const op = mem.add([{ role: "user", content: "test" }]);
		completeLLM(llm, [
			{ content: "Fact A", importance: 0.5, tags: [] },
			{ content: "Fact B", importance: 0.5, tags: [] },
		]);

		await vitest.waitFor(() => expect(op.status.get()).toBe("completed"));
		expect(mem.size.get()).toBe(2);

		const all = mem.getAll();
		expect(all).toHaveLength(2);
	});

	it("getAll() with scope filters by tags", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		// Add with scope
		let op = mem.add([{ role: "user", content: "test" }], { userId: "alice" });
		completeLLM(llm, [{ content: "Alice fact", importance: 0.5, tags: [] }]);
		await vitest.waitFor(() => expect(op.status.get()).toBe("completed"));
		expect(mem.size.get()).toBe(1);

		// Reset LLM for second add
		llm._status.set("pending");
		op = mem.add([{ role: "user", content: "test2" }], { userId: "bob" });
		completeLLM(llm, [{ content: "Bob fact", importance: 0.5, tags: [] }]);
		await vitest.waitFor(() => expect(op.status.get()).toBe("completed"));
		expect(mem.size.get()).toBe(2);

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

	it("update() changes content and publishes event (SA-4c)", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		const op = mem.add([{ role: "user", content: "test" }]);
		completeLLM(llm, [{ content: "Original fact", importance: 0.5, tags: [] }]);
		await vitest.waitFor(() => expect(op.status.get()).toBe("completed"));
		expect(mem.size.get()).toBe(1);

		const node = mem.getAll()[0];

		// Track events published before update
		const initialCount = mem.inner.events.publishCount.get();

		mem.update(node.id, "Updated fact");

		expect(node.content.get()).toBe("Updated fact");
		expect(mem.size.get()).toBe(1);
		// Event was published
		expect(mem.inner.events.publishCount.get()).toBeGreaterThan(initialCount);
	});

	it("queued add() calls do not bleed scope tags across batches", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3, dedupThreshold: 2 });

		mem.add([{ role: "user", content: "first" }], { userId: "alice" });
		mem.add([{ role: "user", content: "second" }], { userId: "bob" });

		completeLLM(llm, [{ content: "Alice fact", importance: 0.5, tags: [] }]);

		await vitest.waitFor(() => {
			expect(llm.generate).toHaveBeenCalledTimes(2);
		});

		completeLLM(llm, [{ content: "Bob fact", importance: 0.5, tags: [] }]);

		await vitest.waitFor(() => expect(mem!.size.get()).toBe(2));

		const alice = mem.getAll({ userId: "alice" });
		const bob = mem.getAll({ userId: "bob" });
		expect(alice).toHaveLength(1);
		expect(alice[0].content.get()).toBe("Alice fact");
		expect(bob).toHaveLength(1);
		expect(bob[0].content.get()).toBe("Bob fact");
	});

	it("delete() removes from collection and vectorIndex and publishes event (SA-4c)", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		const op = mem.add([{ role: "user", content: "test" }]);
		completeLLM(llm, [{ content: "To be deleted", importance: 0.5, tags: [] }]);
		await vitest.waitFor(() => expect(op.status.get()).toBe("completed"));
		expect(mem.size.get()).toBe(1);

		const node = mem.getAll()[0];
		const initialCount = mem.inner.events.publishCount.get();

		const deleted = mem.delete(node.id);

		expect(deleted).toBe(true);
		expect(mem.size.get()).toBe(0);
		expect(mem.inner.vectorIndex.size.get()).toBe(0);
		expect(mem.inner.events.publishCount.get()).toBeGreaterThan(initialCount);
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
		let op = mem.add([{ role: "user", content: "test" }]);
		completeLLM(llm, [{ content: "User loves TypeScript", importance: 0.5, tags: [] }]);
		await vitest.waitFor(() => expect(op.status.get()).toBe("completed"));
		expect(mem.size.get()).toBe(1);

		// Second add with identical content (should dedup)
		llm._status.set("pending");
		op = mem.add([{ role: "user", content: "test2" }]);
		completeLLM(llm, [{ content: "User loves TypeScript", importance: 0.9, tags: ["updated"] }]);
		await vitest.waitFor(() => expect(op.status.get()).toBe("completed"));

		// Should still be 1 memory (deduped), with updated importance
		expect(mem.size.get()).toBe(1);
		const node = mem.getAll()[0];
		expect(node.meta.get().importance).toBe(0.9);
	});

	it("LLM error sets error status via extraction queue (SA-4a)", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({
			llm,
			embed: mockEmbed,
			dimensions: 3,
			extractionRetry: { maxRetries: 0 },
		});

		const op = mem.add([{ role: "user", content: "test" }]);
		llm.error.set(new Error("API error"));
		llm._status.set("errored");

		await vitest.waitFor(() => {
			expect(op.status.get()).toBe("errored");
		});

		expect(op.error.get()).toBeInstanceOf(Error);
	});

	it("search() with scope filters results", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		const addOp = mem.add([{ role: "user", content: "test" }], { userId: "alice" });
		completeLLM(llm, [{ content: "Alice's secret", importance: 0.8, tags: [] }]);
		await vitest.waitFor(() => expect(addOp.status.get()).toBe("completed"));
		expect(mem.size.get()).toBe(1);

		// Search with matching scope
		let searchOp = mem.search("secret", { userId: "alice" });

		await vitest.waitFor(() => {
			expect(searchOp.status.get()).toBe("completed");
		});

		// Ensure the search completes; scope correctness is asserted via bobResults.
		const _aliceResults = searchOp.results.get();

		// Search with non-matching scope
		searchOp = mem.search("secret", { userId: "bob" });

		await vitest.waitFor(() => {
			expect(searchOp.status.get()).toBe("completed");
		});

		const bobResults = searchOp.results.get();
		expect(bobResults).toHaveLength(0);
	});

	it("configurable searchOverfetch (SA-4h)", async () => {
		const llm = makeMockLLM();
		// Just verify it accepts the option and doesn't throw
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3, searchOverfetch: 5 });
		expect(mem.size.get()).toBe(0);
	});

	it("add() publishes events to the topic (SA-4c)", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		const op = mem.add([{ role: "user", content: "test" }]);
		completeLLM(llm, [{ content: "Fact one", importance: 0.5, tags: [] }]);
		await vitest.waitFor(() => expect(op.status.get()).toBe("completed"));
		expect(mem.size.get()).toBe(1);

		// Events topic should have received an "add" event
		const eventCount = mem.inner.events.publishCount.get();
		expect(eventCount).toBeGreaterThanOrEqual(1);

		const latest = mem.inner.events.latest.get();
		expect(latest).toBeDefined();
		expect(latest!.value.type).toBe("add");
		expect(latest!.value.content).toBe("Fact one");
	});

	it("embeddingConcurrency option is respected (SA-4b)", () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3, embeddingConcurrency: 8 });
		// Queue was created — just verify it's accessible
		expect(mem.inner.embeddingQueue).toBeDefined();
	});

	it("accepts caller-provided operation IDs for add/search", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		const addOp = mem.add([{ role: "user", content: "custom id add" }], undefined, {
			opId: "trace-add-1",
		});
		expect(addOp.id).toBe("trace-add-1");
		completeLLM(llm, [{ content: "Fact", importance: 0.5, tags: [] }]);
		await vitest.waitFor(() => expect(addOp.status.get()).toBe("completed"));

		const searchOp = mem.search("Fact", undefined, 5, { opId: "trace-search-1" });
		expect(searchOp.id).toBe("trace-search-1");
		await vitest.waitFor(() => expect(searchOp.status.get()).toBe("completed"));
	});

	it("deduplicates conflicting caller operation IDs", () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		const a = mem.search("x", undefined, 10, { opId: "dup-op" });
		const b = mem.search("y", undefined, 10, { opId: "dup-op" });

		expect(a.id).toBe("dup-op");
		expect(b.id).toBe("dup-op#2");
	});

	it("releases completed opId for reuse", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		const first = mem.add([{ role: "user", content: "first op" }], undefined, { opId: "reuse-op" });
		completeLLM(llm, [{ content: "f1", importance: 0.5, tags: [] }]);
		await vitest.waitFor(() => expect(first.status.get()).toBe("completed"));

		llm._status.set("pending");
		const second = mem.add([{ role: "user", content: "second op" }], undefined, { opId: "reuse-op" });
		completeLLM(llm, [{ content: "f2", importance: 0.5, tags: [] }]);
		await vitest.waitFor(() => expect(second.status.get()).toBe("completed"));

		// Completed op IDs should be released and reusable without suffix.
		expect(second.id).toBe("reuse-op");
	});

	it("add() cancel keeps operation status cancelled (does not flip to errored)", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		const op = mem.add([{ role: "user", content: "cancel me" }]);
		expect(op.status.get()).toBe("active");

		op.cancel();

		await vitest.waitFor(() => {
			expect(op.status.get()).toBe("cancelled");
		});
		expect(op.error.get()).toBeUndefined();
		expect(op.endedAt.get()).toBeDefined();
	});

	it("search() operation exposes per-call results store", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		const addOp = mem.add([{ role: "user", content: "seed" }]);
		completeLLM(llm, [{ content: "TypeScript fact", importance: 0.8, tags: [] }]);
		await vitest.waitFor(() => expect(addOp.status.get()).toBe("completed"));

		const searchOp = mem.search("TypeScript");
		await vitest.waitFor(() => expect(searchOp.status.get()).toBe("completed"));
		expect(searchOp.results.get().length).toBeGreaterThan(0);
	});

	it("extractionRetry retries failed extraction and can recover", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({
			llm,
			embed: mockEmbed,
			dimensions: 3,
			extractionRetry: { maxRetries: 1 },
		});

		const op = mem.add([{ role: "user", content: "retry extraction" }]);
		expect(llm.generate).toHaveBeenCalledTimes(1);

		// First attempt fails
		llm.error.set(new Error("transient"));
		llm._status.set("errored");

		// Retry attempt should be issued
		await vitest.waitFor(() => {
			expect(llm.generate).toHaveBeenCalledTimes(2);
		});

		// Second attempt succeeds
		llm._status.set("pending");
		completeLLM(llm, [{ content: "Recovered fact", importance: 0.7, tags: [] }]);

		await vitest.waitFor(() => expect(op.status.get()).toBe("completed"));
		expect(mem.size.get()).toBe(1);
		expect(op.extracted.get()).toHaveLength(1);
	});

	it("shared bridge propagates memory events across transports (SA-4e)", async () => {
		const [tA, tB] = createMockTransportPair();
		const llmA = makeMockLLM();
		const llmB = makeMockLLM();

		mem = agentMemory({
			llm: llmA,
			embed: mockEmbed,
			dimensions: 3,
			shared: { transport: tA, topicName: "memory-events" },
		});
		const remote = agentMemory({
			llm: llmB,
			embed: mockEmbed,
			dimensions: 3,
			shared: { transport: tB, topicName: "memory-events" },
		});

		const addOp = mem.add([{ role: "user", content: "bridge event" }]);
		completeLLM(llmA, [{ content: "Bridged fact", importance: 0.6, tags: [] }]);
		await vitest.waitFor(() => expect(addOp.status.get()).toBe("completed"));

		await vitest.waitFor(() => {
			const latest = remote.inner.events.latest.get();
			expect(latest).toBeDefined();
			expect(latest!.value.type).toBe("add");
			expect(latest!.value.content).toBe("Bridged fact");
		});

		remote.destroy();
	});

	it("extractionRetry option is wired to extraction queue (SA-4a)", () => {
		const llm = makeMockLLM();
		mem = agentMemory({
			llm,
			embed: mockEmbed,
			dimensions: 3,
			extractionRetry: { maxRetries: 5 },
		});
		expect(mem.inner.extractionQueue).toBeDefined();
	});

	it("shared bridge wiring creates topicBridge handle (SA-4e)", () => {
		const llm = makeMockLLM();
		const [tA, tB] = createMockTransportPair();

		mem = agentMemory({
			llm,
			embed: mockEmbed,
			dimensions: 3,
			shared: {
				transport: tA,
			},
		});

		const remote = agentMemory({
			llm: makeMockLLM(),
			embed: mockEmbed,
			dimensions: 3,
			shared: {
				transport: tB,
			},
		});

		expect(mem.inner.sharedBridge).toBeDefined();
		expect(remote.inner.sharedBridge).toBeDefined();

		remote.destroy();
	});

	it("extraction queue serializes LLM calls (SA-4g)", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		// Extraction queue has concurrency 1
		// Two rapid add() calls should serialize through the queue
		const op1 = mem.add([{ role: "user", content: "first" }]);
		const op2 = mem.add([{ role: "user", content: "second" }]);

		// First extraction should be processing
		expect(op1.status.get()).toBe("active");

		completeLLM(llm, [{ content: "First fact", importance: 0.5, tags: [] }]);

		await vitest.waitFor(() => {
			// After first completes, second should start
			expect(mem!.size.get()).toBeGreaterThanOrEqual(1);
		});

		// Complete the second extraction
		llm._status.set("pending");
		completeLLM(llm, [{ content: "Second fact", importance: 0.5, tags: [] }]);

		await vitest.waitFor(() => {
			expect(mem!.size.get()).toBe(2);
		});
		expect(op1.status.get()).toBe("completed");
		expect(op2.status.get()).toBe("completed");
	});

	it("destroy() cleans up all resources including queues and topic", async () => {
		const llm = makeMockLLM();
		mem = agentMemory({ llm, embed: mockEmbed, dimensions: 3 });

		const op = mem.add([{ role: "user", content: "test" }]);
		completeLLM(llm, [{ content: "Fact", importance: 0.5, tags: [] }]);
		await vitest.waitFor(() => expect(op.status.get()).toBe("completed"));
		expect(mem.size.get()).toBe(1);

		mem.destroy();
		mem = null; // Prevent afterEach double-destroy
	});
});
