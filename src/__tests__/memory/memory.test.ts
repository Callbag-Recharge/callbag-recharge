import { describe, expect, it, vi } from "vitest";
import { effect } from "../../core/effect";
import { collection } from "../../memory/collection";
import { computeScore, decay } from "../../memory/decay";
import { memoryNode } from "../../memory/node";
import type { MemoryMeta } from "../../memory/types";

// ---------------------------------------------------------------------------
// MemoryNode
// ---------------------------------------------------------------------------
describe("memoryNode — Phase 1: Memory Primitives", () => {
	it("creates with content and default metadata", () => {
		const node = memoryNode("hello world");
		expect(node.content.get()).toBe("hello world");

		const meta = node.meta.get();
		expect(meta.importance).toBe(0.5);
		expect(meta.accessCount).toBe(0);
		expect(meta.tags.size).toBe(0);
		expect(typeof meta.id).toBe("string");
		expect(meta.createdAt).toBeGreaterThan(0);
		node.destroy();
	});

	it("accepts custom options", () => {
		const node = memoryNode("data", {
			id: "custom-id",
			importance: 0.9,
			tags: ["important", "user"],
		});
		expect(node.id).toBe("custom-id");
		expect(node.meta.get().importance).toBe(0.9);
		expect(node.meta.get().tags.has("important")).toBe(true);
		expect(node.meta.get().tags.has("user")).toBe(true);
		node.destroy();
	});

	it("touch() updates accessedAt and accessCount", () => {
		vi.useFakeTimers();
		const node = memoryNode("data");
		const initialMeta = node.meta.get();

		vi.advanceTimersByTime(1000);
		node.touch();

		const updatedMeta = node.meta.get();
		expect(updatedMeta.accessCount).toBe(1);
		expect(updatedMeta.accessedAt).toBeGreaterThan(initialMeta.accessedAt);
		node.destroy();
		vi.useRealTimers();
	});

	it("tag/untag modify tags reactively", () => {
		const node = memoryNode("data");
		node.tag("a", "b");
		expect(node.meta.get().tags.has("a")).toBe(true);
		expect(node.meta.get().tags.has("b")).toBe(true);

		node.untag("a");
		expect(node.meta.get().tags.has("a")).toBe(false);
		expect(node.meta.get().tags.has("b")).toBe(true);
		node.destroy();
	});

	it("setImportance clamps to 0-1", () => {
		const node = memoryNode("data");
		node.setImportance(1.5);
		expect(node.meta.get().importance).toBe(1);

		node.setImportance(-0.5);
		expect(node.meta.get().importance).toBe(0);

		node.setImportance(0.7);
		expect(node.meta.get().importance).toBe(0.7);
		node.destroy();
	});

	it("update() changes content and bumps updatedAt", () => {
		vi.useFakeTimers();
		const node = memoryNode("v1");
		const t0 = node.meta.get().updatedAt;

		vi.advanceTimersByTime(100);
		node.update("v2");

		expect(node.content.get()).toBe("v2");
		expect(node.meta.get().updatedAt).toBeGreaterThan(t0);
		node.destroy();
		vi.useRealTimers();
	});

	it("scoreStore is reactive — recomputes when meta changes", () => {
		const node = memoryNode("data", { importance: 0 });
		const s1 = node.scoreStore.get();

		node.setImportance(1);
		const s2 = node.scoreStore.get();

		expect(s2).toBeGreaterThan(s1);
		node.destroy();
	});

	it("score() accepts custom weights", () => {
		const node = memoryNode("data", { importance: 0.5 });
		const s1 = node.score({ importance: 0, recency: 1, frequency: 0 });
		const s2 = node.score({ importance: 10, recency: 0, frequency: 0 });

		expect(s2).toBeGreaterThan(s1);
		node.destroy();
	});

	it("meta changes trigger effect", () => {
		const node = memoryNode("data");
		const log: number[] = [];
		const dispose = effect([node.meta], () => {
			log.push(node.meta.get().accessCount);
		});

		node.touch();
		node.touch();

		expect(log).toEqual([0, 1, 2]);
		dispose();
		node.destroy();
	});
});

// ---------------------------------------------------------------------------
// Decay scoring
// ---------------------------------------------------------------------------
describe("decay — scoring functions", () => {
	it("decay() creates a scoring function", () => {
		const scorer = decay({ halfLife: 1000 });
		const meta: MemoryMeta = {
			id: "test",
			createdAt: 1000,
			updatedAt: 1000,
			accessedAt: 1000,
			accessCount: 5,
			importance: 0.8,
			tags: new Set(),
		};

		const scoreNow = scorer(meta, 1000); // t=0
		const scoreLater = scorer(meta, 2000); // t=1000ms (one half-life)

		expect(scoreNow).toBeGreaterThan(scoreLater);
	});

	it("score is ~half after one half-life (recency component)", () => {
		const scorer = decay({ halfLife: 1000, importance: 0, frequency: 0 });
		const meta: MemoryMeta = {
			id: "test",
			createdAt: 0,
			updatedAt: 0,
			accessedAt: 0,
			accessCount: 0,
			importance: 0,
			tags: new Set(),
		};

		const s0 = scorer(meta, 0);
		const s1 = scorer(meta, 1000);

		expect(s1).toBeCloseTo(s0 / 2, 5);
	});

	it("importance weight scales linearly", () => {
		const scorer = decay({ recency: 0, frequency: 0, importance: 2 });
		const meta: MemoryMeta = {
			id: "test",
			createdAt: 0,
			updatedAt: 0,
			accessedAt: 0,
			accessCount: 0,
			importance: 0.5,
			tags: new Set(),
		};

		expect(scorer(meta, 0)).toBeCloseTo(1.0, 5); // 2 * 0.5
	});

	it("frequency factor saturates with high access count", () => {
		const scorer = decay({ recency: 0, importance: 0, frequency: 1 });
		const baseMeta: MemoryMeta = {
			id: "test",
			createdAt: 0,
			updatedAt: 0,
			accessedAt: 0,
			accessCount: 0,
			importance: 0,
			tags: new Set(),
		};

		const s0 = scorer(baseMeta, 0); // accessCount=0 → factor=0
		const s100 = scorer({ ...baseMeta, accessCount: 100 }, 0); // factor ≈ 0.99

		expect(s0).toBeCloseTo(0, 5);
		expect(s100).toBeGreaterThan(0.98);
		expect(s100).toBeLessThanOrEqual(1);
	});

	it("computeScore matches decay() output", () => {
		const opts = { halfLife: 5000, recency: 1, importance: 0.5, frequency: 0.3 };
		const scorer = decay(opts);
		const meta: MemoryMeta = {
			id: "test",
			createdAt: 0,
			updatedAt: 0,
			accessedAt: 1000,
			accessCount: 10,
			importance: 0.7,
			tags: new Set(),
		};

		expect(computeScore(meta, opts, 3000)).toBeCloseTo(scorer(meta, 3000), 10);
	});
});

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------
describe("collection — Phase 1: Collection", () => {
	it("add/remove/get/has", () => {
		const col = collection<string>();

		const n1 = col.add("hello", { id: "n1" });
		col.add("world", { id: "n2" });

		expect(col.has("n1")).toBe(true);
		expect(col.get("n1")).toBe(n1);
		expect(col.size.get()).toBe(2);

		expect(col.remove("n1")).toBe(true);
		expect(col.has("n1")).toBe(false);
		expect(col.size.get()).toBe(1);

		expect(col.remove("nonexistent")).toBe(false);
		col.destroy();
	});

	it("nodes store is reactive", () => {
		const col = collection<number>();
		const log: number[] = [];
		const dispose = effect([col.size], () => {
			log.push(col.size.get());
		});

		col.add(1);
		col.add(2);
		col.add(3);

		expect(log).toEqual([0, 1, 2, 3]);
		dispose();
		col.destroy();
	});

	it("query filters nodes", () => {
		const col = collection<number>();
		col.add(1, { tags: ["odd"] });
		col.add(2, { tags: ["even"] });
		col.add(3, { tags: ["odd"] });

		const odds = col.query((n) => n.meta.get().tags.has("odd"));
		expect(odds).toHaveLength(2);
		expect(odds.map((n) => n.content.get())).toEqual([1, 3]);
		col.destroy();
	});

	it("byTag returns nodes with specific tag", () => {
		const col = collection<string>();
		col.add("a", { tags: ["x"] });
		col.add("b", { tags: ["y"] });
		col.add("c", { tags: ["x", "y"] });

		const xNodes = col.byTag("x");
		expect(xNodes).toHaveLength(2);
		expect(xNodes.map((n) => n.content.get()).sort()).toEqual(["a", "c"]);
		col.destroy();
	});

	it("topK returns highest-scored nodes", () => {
		const col = collection<string>();
		col.add("low", { importance: 0.1 });
		col.add("mid", { importance: 0.5 });
		col.add("high", { importance: 0.9 });

		const top = col.topK(2, { recency: 0, frequency: 0, importance: 1 });
		expect(top).toHaveLength(2);
		expect(top[0].content.get()).toBe("high");
		expect(top[1].content.get()).toBe("mid");
		col.destroy();
	});

	it("maxSize evicts lowest-scored nodes", () => {
		const col = collection<string>({
			maxSize: 2,
			weights: { recency: 0, frequency: 0, importance: 1 },
		});

		col.add("low", { importance: 0.1, id: "low" });
		col.add("mid", { importance: 0.5, id: "mid" });
		expect(col.size.get()).toBe(2);

		// Adding a 3rd should evict the lowest
		col.add("high", { importance: 0.9, id: "high" });
		expect(col.size.get()).toBe(2);
		expect(col.has("low")).toBe(false); // Evicted
		expect(col.has("mid")).toBe(true);
		expect(col.has("high")).toBe(true);
		col.destroy();
	});

	it("remove by node reference", () => {
		const col = collection<string>();
		const n = col.add("test");
		expect(col.remove(n)).toBe(true);
		expect(col.size.get()).toBe(0);
		col.destroy();
	});

	it("destroy tears down all nodes", () => {
		const col = collection<string>();
		col.add("a");
		col.add("b");
		col.destroy();

		expect(() => col.add("c")).toThrow("Collection is destroyed");
	});

	// --- Tag index integration (reactiveIndex) ---

	it("tagIndex provides reactive tag lookups", () => {
		const col = collection<string>();
		col.add("a", { id: "n1", tags: ["x"] });
		col.add("b", { id: "n2", tags: ["y"] });
		col.add("c", { id: "n3", tags: ["x", "y"] });

		// Reactive select on tag
		const xSet = col.tagIndex.select("x").get();
		expect(xSet.has("n1")).toBe(true);
		expect(xSet.has("n3")).toBe(true);
		expect(xSet.size).toBe(2);
		col.destroy();
	});

	it("tagIndex updates when node tags change", () => {
		const col = collection<string>();
		const n = col.add("data", { id: "n1", tags: ["a"] });

		expect(col.byTag("a")).toHaveLength(1);
		expect(col.byTag("b")).toHaveLength(0);

		// Tag the node with "b"
		n.tag("b");
		expect(col.byTag("b")).toHaveLength(1);

		// Untag "a"
		n.untag("a");
		expect(col.byTag("a")).toHaveLength(0);
		expect(col.byTag("b")).toHaveLength(1);

		col.destroy();
	});

	it("tagIndex cleans up when node is removed", () => {
		const col = collection<string>();
		col.add("data", { id: "n1", tags: ["x"] });

		expect(col.tagIndex.get("x").has("n1")).toBe(true);

		col.remove("n1");
		expect(col.tagIndex.get("x").size).toBe(0);

		col.destroy();
	});

	it("byTag uses index for O(1) lookup", () => {
		const col = collection<string>();
		col.add("a", { tags: ["common"] });
		col.add("b", { tags: ["unique"] });
		col.add("c", { tags: ["common"] });

		const common = col.byTag("common");
		expect(common).toHaveLength(2);
		expect(common.map((n) => n.content.get()).sort()).toEqual(["a", "c"]);

		const none = col.byTag("nonexistent");
		expect(none).toHaveLength(0);

		col.destroy();
	});
});
