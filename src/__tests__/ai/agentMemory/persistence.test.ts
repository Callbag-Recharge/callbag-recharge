import { afterEach, describe, expect, it, vi as vitest } from "vitest";
import { agentMemory } from "../../../ai/agentMemory";
import type { LLMStore } from "../../../ai/fromLLM";
import { state } from "../../../core/state";
import type { WithStatusStatus } from "../../../utils/withStatus";

// Simple mock embed: deterministic 3D vector from content hash
function mockEmbed(text: string): Promise<Float32Array> {
	const hash = Array.from(text).reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
	const vec = new Float32Array([Math.sin(hash), Math.cos(hash), Math.sin(hash * 2)]);
	// Normalize
	const norm = Math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2);
	vec[0] /= norm;
	vec[1] /= norm;
	vec[2] /= norm;
	return Promise.resolve(vec);
}

function makeMockAdapter() {
	const store = new Map<string, unknown>();
	return {
		save: vitest.fn((id: string, value: unknown) => {
			store.set(id, JSON.parse(JSON.stringify(value)));
			return undefined;
		}),
		load: vitest.fn((id: string) => {
			return store.get(id);
		}),
		clear: vitest.fn((id: string) => {
			store.delete(id);
			return undefined;
		}),
		_store: store,
	};
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

describe("agentMemory persistence", () => {
	let mem: ReturnType<typeof agentMemory> | null = null;

	afterEach(() => {
		mem?.destroy();
		mem = null;
	});

	it("saves to adapter after adding memories", async () => {
		const adapter = makeMockAdapter();
		const llm = makeMockLLM();

		mem = agentMemory({
			llm,
			embed: mockEmbed,
			dimensions: 3,
			adapter,
			name: "test-persist",
		});

		// Simulate LLM extraction
		const op = mem.add([{ role: "user", content: "I love TypeScript" }]);

		// Complete LLM with extracted facts
		llm._content.set(
			JSON.stringify([{ content: "User loves TypeScript", importance: 0.8, tags: ["preference"] }]),
		);
		llm._status.set("completed");

		await vitest.waitFor(() => {
			expect(op.status.get()).toBe("completed");
		});

		// Adapter should have been called
		expect(adapter.save).toHaveBeenCalled();
		const savedState = adapter._store.get("test-persist") as any;
		expect(savedState.nodes).toHaveLength(1);
		expect(savedState.nodes[0].content).toBe("User loves TypeScript");
		expect(savedState.embeddings).toBeDefined();
	});

	it("restores from adapter on creation", async () => {
		const adapter = makeMockAdapter();
		const llm = makeMockLLM();

		// Pre-populate adapter with saved state
		adapter._store.set("test-restore", {
			nodes: [
				{
					id: "mem-1",
					content: "User prefers dark mode",
					meta: {
						id: "mem-1",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						accessedAt: Date.now(),
						accessCount: 2,
						importance: 0.7,
						tags: ["preference"],
					},
				},
			],
			embeddings: {
				"mem-1": [0.5, 0.5, Math.SQRT1_2],
			},
		});

		mem = agentMemory({
			llm,
			embed: mockEmbed,
			dimensions: 3,
			adapter,
			name: "test-restore",
		});

		// Should have restored the memory
		expect(mem.size.get()).toBe(1);
		const all = mem.getAll();
		expect(all).toHaveLength(1);
		expect(all[0].content.get()).toBe("User prefers dark mode");

		// Vector index should also be restored
		expect(mem.inner.vectorIndex.size.get()).toBe(1);
	});
});
