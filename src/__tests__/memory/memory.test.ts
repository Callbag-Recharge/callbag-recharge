import { describe, expect, it, vi } from "vitest";
import { effect } from "../../core/effect";
import { subscribe } from "../../core/subscribe";
import { collection } from "../../memory/collection";
import { computeScore, decay } from "../../memory/decay";
import { memoryNode } from "../../memory/node";
import type { AdmissionDecision, MemoryMeta, MemoryNode } from "../../memory/types";

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

	// -------------------------------------------------------------------------
	// lifecycle signals (5f-5)
	// -------------------------------------------------------------------------

	it("destroy cascades END to derived stores (nodes, size)", () => {
		const col = collection<string>();
		col.add("a");
		col.add("b");

		let nodesEnded = false;
		let sizeEnded = false;
		subscribe(col.nodes, () => {}, {
			onEnd: () => {
				nodesEnded = true;
			},
		});
		subscribe(col.size, () => {}, {
			onEnd: () => {
				sizeEnded = true;
			},
		});

		col.destroy();

		expect(nodesEnded).toBe(true);
		expect(sizeEnded).toBe(true);
	});

	it("tag-tracking effects auto-dispose on collection destroy", () => {
		const col = collection<string>();
		const n1 = col.add("hello", { tags: ["x"] });

		// Effect should be alive — tag changes tracked
		n1.tag("y");
		expect(col.tagIndex.get("y").has(n1.id)).toBe(true);

		col.destroy();

		// After destroy, collection is cleaned up
		expect(col.tagIndex.get("x").size).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Phase 6d: Admission Control + Consolidation
// ---------------------------------------------------------------------------
describe("collection — Phase 6d: Admission Policy", () => {
	it("admissionPolicy 'admit' adds normally", () => {
		const col = collection<string>({
			admissionPolicy: () => ({ action: "admit" }),
		});
		const node = col.add("hello");
		expect(node).toBeDefined();
		expect(node!.content.get()).toBe("hello");
		expect(col.size.get()).toBe(1);
		col.destroy();
	});

	it("admissionPolicy 'reject' returns undefined and does not add", () => {
		const col = collection<string>({
			admissionPolicy: () => ({ action: "reject" }),
		});
		const result = col.add("hello");
		expect(result).toBeUndefined();
		expect(col.size.get()).toBe(0);
		col.destroy();
	});

	it("admissionPolicy 'update' replaces content of existing node", () => {
		const col = collection<string>({
			admissionPolicy: (incoming, nodes) => {
				// Dedup: if any node has same content prefix, update it
				const existing = nodes.find((n) => n.content.get().startsWith("fact:"));
				if (existing) {
					return { action: "update", targetId: existing.id, content: incoming };
				}
				return { action: "admit" };
			},
		});

		const n1 = col.add("fact: the sky is blue", { id: "n1" });
		expect(n1).toBeDefined();
		expect(col.size.get()).toBe(1);

		// Second add with same prefix should update, not add
		const n2 = col.add("fact: the sky is actually many colors");
		expect(n2).toBeDefined();
		expect(n2!.id).toBe("n1"); // returned the existing node
		expect(col.size.get()).toBe(1); // still one node
		expect(n2!.content.get()).toBe("fact: the sky is actually many colors");
		col.destroy();
	});

	it("admissionPolicy 'merge' combines content via reducer", () => {
		const col = collection<string[]>({
			admissionPolicy: (incoming, nodes) => {
				const target = nodes.find((n) => n.meta.get().tags.has("facts"));
				if (target) {
					return {
						action: "merge",
						targetId: target.id,
						reducer: (existing, inc) => [...existing, ...inc],
					};
				}
				return { action: "admit" };
			},
		});

		const n1 = col.add(["sky is blue"], { id: "n1", tags: ["facts"] });
		expect(n1).toBeDefined();

		const n2 = col.add(["grass is green"]);
		expect(n2).toBeDefined();
		expect(n2!.id).toBe("n1");
		expect(n2!.content.get()).toEqual(["sky is blue", "grass is green"]);
		expect(col.size.get()).toBe(1);
		col.destroy();
	});

	it("admissionPolicy 'update' throws for missing targetId", () => {
		const col = collection<string>({
			admissionPolicy: () => ({ action: "update", targetId: "nonexistent", content: "x" }),
		});
		expect(() => col.add("test")).toThrow('Admission update target "nonexistent" not found');
		col.destroy();
	});

	it("admissionPolicy 'merge' throws for missing targetId", () => {
		const col = collection<string>({
			admissionPolicy: () => ({
				action: "merge",
				targetId: "nonexistent",
				reducer: (a, b) => a + b,
			}),
		});
		expect(() => col.add("test")).toThrow('Admission merge target "nonexistent" not found');
		col.destroy();
	});

	it("no admissionPolicy = always admit (backward compat)", () => {
		const col = collection<string>();
		const n = col.add("hello");
		expect(n).toBeDefined();
		expect(col.size.get()).toBe(1);
		col.destroy();
	});
});

describe("collection — Phase 6d: Forget Policy", () => {
	it("forgetPolicy removes stale nodes after add()", () => {
		const col = collection<string>({
			forgetPolicy: (node) => node.meta.get().importance < 0.2,
		});

		col.add("important", { importance: 0.9, id: "keep" });
		const stale = col.add("initially-ok", { importance: 0.5, id: "stale" });
		expect(col.has("stale")).toBe(true);
		expect(col.size.get()).toBe(2);

		// Drop importance below threshold
		stale!.setImportance(0.1);

		// Next add triggers forget pass — stale gets removed
		col.add("another", { importance: 0.5, id: "another" });
		expect(col.has("stale")).toBe(false);
		expect(col.has("keep")).toBe(true);
		expect(col.has("another")).toBe(true);
		expect(col.size.get()).toBe(2);
		col.destroy();
	});

	it("gc() runs forget policy on demand", () => {
		const col = collection<string>({
			forgetPolicy: (node) => node.meta.get().importance < 0.3,
		});

		// All start above threshold
		col.add("a", { importance: 0.5, id: "a" });
		col.add("b", { importance: 0.5, id: "b" });
		col.add("c", { importance: 0.5, id: "c" });
		expect(col.size.get()).toBe(3);

		// Drop importance below threshold after adding
		col.get("a")!.setImportance(0.1);
		col.get("c")!.setImportance(0.2);

		// Manual gc() removes stale nodes
		const removed = col.gc();
		expect(removed).toBe(2);
		expect(col.has("b")).toBe(true);
		expect(col.has("a")).toBe(false);
		expect(col.has("c")).toBe(false);
		expect(col.size.get()).toBe(1);
		col.destroy();
	});

	it("gc() returns 0 when no forgetPolicy", () => {
		const col = collection<string>();
		col.add("a");
		expect(col.gc()).toBe(0);
		col.destroy();
	});

	it("gc() throws on destroyed collection", () => {
		const col = collection<string>();
		col.destroy();
		expect(() => col.gc()).toThrow("Collection is destroyed");
	});

	it("forgetPolicy + maxSize: forget runs before eviction", () => {
		const col = collection<string>({
			maxSize: 3,
			weights: { recency: 0, frequency: 0, importance: 1 },
			forgetPolicy: (node) => node.meta.get().importance === 0,
		});

		col.add("a", { importance: 0.5, id: "a" });
		col.add("b", { importance: 0, id: "b" }); // will be forgotten
		col.add("c", { importance: 0.8, id: "c" });

		// Adding 4th triggers forget (removes "b") then eviction not needed (3→2 < maxSize 3)
		col.add("d", { importance: 0.6, id: "d" });
		expect(col.has("b")).toBe(false); // forgotten
		expect(col.has("a")).toBe(true);
		expect(col.has("c")).toBe(true);
		expect(col.has("d")).toBe(true);
		expect(col.size.get()).toBe(3);
		col.destroy();
	});
});

describe("collection — Phase 6d: Summarize", () => {
	it("summarize() consolidates multiple nodes into one", () => {
		const col = collection<string>();
		col.add("fact 1", { id: "n1", tags: ["facts"] });
		col.add("fact 2", { id: "n2", tags: ["facts"] });
		col.add("unrelated", { id: "n3" });

		const summary = col.summarize(
			["n1", "n2"],
			(nodes) => nodes.map((n) => n.content.get()).join("; "),
			{ id: "summary", tags: ["facts", "summary"] },
		);

		expect(summary.content.get()).toBe("fact 1; fact 2");
		expect(summary.id).toBe("summary");
		expect(col.has("n1")).toBe(false); // removed
		expect(col.has("n2")).toBe(false); // removed
		expect(col.has("n3")).toBe(true); // untouched
		expect(col.has("summary")).toBe(true);
		expect(col.size.get()).toBe(2); // n3 + summary
		col.destroy();
	});

	it("summarize() throws for empty/invalid node list", () => {
		const col = collection<string>();
		expect(() => col.summarize([], (nodes) => "")).toThrow("No valid nodes to summarize");
		expect(() => col.summarize(["nonexistent"], (nodes) => "")).toThrow(
			"No valid nodes to summarize",
		);
		col.destroy();
	});

	it("summarize() throws on destroyed collection", () => {
		const col = collection<string>();
		col.destroy();
		expect(() => col.summarize(["a"], (n) => "")).toThrow("Collection is destroyed");
	});

	it("summarize() updates tag index correctly", () => {
		const col = collection<string>();
		col.add("a", { id: "n1", tags: ["x"] });
		col.add("b", { id: "n2", tags: ["x", "y"] });

		col.summarize(["n1", "n2"], (nodes) => "combined", { id: "s1", tags: ["x", "z"] });

		// Old nodes' tags should be cleaned up
		expect(col.byTag("y")).toHaveLength(0);
		// New summary should be in "x" and "z"
		expect(col.byTag("x")).toHaveLength(1);
		expect(col.byTag("x")[0].id).toBe("s1");
		expect(col.byTag("z")).toHaveLength(1);
		col.destroy();
	});

	it("summarize() skips invalid IDs gracefully", () => {
		const col = collection<string>();
		col.add("a", { id: "n1" });

		// "n2" doesn't exist — only "n1" gets summarized
		const s = col.summarize(["n1", "n2"], (nodes) => {
			expect(nodes).toHaveLength(1);
			return nodes[0].content.get() + " (summarized)";
		});

		expect(s.content.get()).toBe("a (summarized)");
		expect(col.has("n1")).toBe(false);
		expect(col.size.get()).toBe(1);
		col.destroy();
	});
});
