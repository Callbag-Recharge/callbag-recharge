import { describe, expect, it, vi } from "vitest";
import { effect } from "../../core/effect";
import { subscribe } from "../../core/subscribe";
import { collection } from "../../memory/collection";
import { computeScore, decay } from "../../memory/decay";
import { knowledgeGraph } from "../../memory/knowledgeGraph";
import { lightCollection } from "../../memory/lightCollection";
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

	it("frequency signal starts at sigmoid(0) and rises with access count", () => {
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

		const s0 = scorer(baseMeta, 0); // accessCount=0 → sigmoid(0)=0.5
		const s100 = scorer({ ...baseMeta, accessCount: 100 }, 0); // -> near 1

		expect(s0).toBeCloseTo(0.5, 5);
		expect(s100).toBeGreaterThan(0.95);
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
			admissionPolicy: (_incoming, nodes) => {
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
		expect(() => col.summarize([], (_nodes) => "")).toThrow("No valid nodes to summarize");
		expect(() => col.summarize(["nonexistent"], (_nodes) => "")).toThrow(
			"No valid nodes to summarize",
		);
		col.destroy();
	});

	it("summarize() throws on destroyed collection", () => {
		const col = collection<string>();
		col.destroy();
		expect(() => col.summarize(["a"], (_n) => "")).toThrow("Collection is destroyed");
	});

	it("summarize() updates tag index correctly", () => {
		const col = collection<string>();
		col.add("a", { id: "n1", tags: ["x"] });
		col.add("b", { id: "n2", tags: ["x", "y"] });

		col.summarize(["n1", "n2"], (_nodes) => "combined", { id: "s1", tags: ["x", "z"] });

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
			return `${nodes[0].content.get()} (summarized)`;
		});

		expect(s.content.get()).toBe("a (summarized)");
		expect(col.has("n1")).toBe(false);
		expect(col.size.get()).toBe(1);
		col.destroy();
	});
});

// ---------------------------------------------------------------------------
// Phase 6c: Knowledge Graph
// ---------------------------------------------------------------------------
describe("knowledgeGraph — Phase 6c: Entity & Relation CRUD", () => {
	it("addEntity/removeEntity/getEntity/hasEntity", () => {
		const kg = knowledgeGraph<string>();
		const alice = kg.addEntity("Alice", { id: "alice" });
		expect(alice).toBeDefined();
		expect(kg.hasEntity("alice")).toBe(true);
		expect(kg.getEntity("alice")).toBe(alice);
		expect(kg.entityCount.get()).toBe(1);

		expect(kg.removeEntity("alice")).toBe(true);
		expect(kg.hasEntity("alice")).toBe(false);
		expect(kg.entityCount.get()).toBe(0);

		expect(kg.removeEntity("nonexistent")).toBe(false);
		kg.destroy();
	});

	it("entities store is reactive", () => {
		const kg = knowledgeGraph<string>();
		const log: number[] = [];
		const dispose = effect([kg.entityCount], () => {
			log.push(kg.entityCount.get());
		});

		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });

		expect(log).toEqual([0, 1, 2]);
		dispose();
		kg.destroy();
	});

	it("addRelation creates a directed relation", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("Alice", { id: "alice" });
		kg.addEntity("Bob", { id: "bob" });

		const rel = kg.addRelation("alice", "bob", "knows", {
			id: "r1",
			weight: 0.8,
			metadata: { since: 2020 },
		});

		expect(rel.id).toBe("r1");
		expect(rel.sourceId).toBe("alice");
		expect(rel.targetId).toBe("bob");
		expect(rel.type).toBe("knows");
		expect(rel.weight).toBe(0.8);
		expect(rel.metadata).toEqual({ since: 2020 });
		expect(rel.createdAt).toBeGreaterThan(0);

		expect(kg.hasRelation("r1")).toBe(true);
		expect(kg.getRelation("r1")).toBe(rel);
		expect(kg.relationCount.get()).toBe(1);
		kg.destroy();
	});

	it("addRelation throws for missing entities", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("Alice", { id: "alice" });

		expect(() => kg.addRelation("alice", "bob", "knows")).toThrow('Target entity "bob" not found');
		expect(() => kg.addRelation("nobody", "alice", "knows")).toThrow(
			'Source entity "nobody" not found',
		);
		kg.destroy();
	});

	it("addRelation throws for duplicate relation ID", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addRelation("a", "b", "x", { id: "r1" });

		expect(() => kg.addRelation("a", "b", "y", { id: "r1" })).toThrow(
			'Relation ID "r1" already exists',
		);
		kg.destroy();
	});

	it("addRelation defaults weight to 1", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		const rel = kg.addRelation("a", "b", "knows");
		expect(rel.weight).toBe(1);
		kg.destroy();
	});

	it("addRelation clamps initial weight to 0-1", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addEntity("C", { id: "c" });

		const r1 = kg.addRelation("a", "b", "x", { weight: 5 });
		expect(r1.weight).toBe(1);

		const r2 = kg.addRelation("a", "c", "x", { weight: -2 });
		expect(r2.weight).toBe(0);
		kg.destroy();
	});

	it("removeRelation by ID", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addRelation("a", "b", "knows", { id: "r1" });

		expect(kg.removeRelation("r1")).toBe(true);
		expect(kg.hasRelation("r1")).toBe(false);
		expect(kg.relationCount.get()).toBe(0);

		expect(kg.removeRelation("nonexistent")).toBe(false);
		kg.destroy();
	});

	it("removeRelationsBetween removes matching relations", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addRelation("a", "b", "knows", { id: "r1" });
		kg.addRelation("a", "b", "works-with", { id: "r2" });
		kg.addRelation("a", "b", "knows", { id: "r3" });

		// Remove only "knows" relations
		const removed = kg.removeRelationsBetween("a", "b", "knows");
		expect(removed).toBe(2);
		expect(kg.hasRelation("r1")).toBe(false);
		expect(kg.hasRelation("r3")).toBe(false);
		expect(kg.hasRelation("r2")).toBe(true); // works-with preserved
		kg.destroy();
	});

	it("removeRelationsBetween without type removes all", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addRelation("a", "b", "knows");
		kg.addRelation("a", "b", "works-with");

		expect(kg.removeRelationsBetween("a", "b")).toBe(2);
		expect(kg.relationCount.get()).toBe(0);
		kg.destroy();
	});

	it("updateRelation modifies weight, metadata, and updatedAt (cloned)", () => {
		vi.useFakeTimers();
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		const rel = kg.addRelation("a", "b", "knows", { id: "r1", weight: 0.5 });
		const t0 = rel.updatedAt;

		vi.advanceTimersByTime(100);
		expect(kg.updateRelation("r1", { weight: 0.9, metadata: { note: "close" } })).toBe(true);

		const updated = kg.getRelation("r1")!;
		expect(updated.weight).toBe(0.9);
		expect(updated.metadata).toEqual({ note: "close" });
		expect(updated.updatedAt).toBeGreaterThan(t0);

		// Original reference is not mutated (clone on update)
		expect(rel.weight).toBe(0.5);
		expect(rel).not.toBe(updated);

		expect(kg.updateRelation("nonexistent", { weight: 0.5 })).toBe(false);
		vi.useRealTimers();
		kg.destroy();
	});

	it("updateRelation clamps weight to 0-1", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addRelation("a", "b", "x", { id: "r1" });

		kg.updateRelation("r1", { weight: 1.5 });
		expect(kg.getRelation("r1")!.weight).toBe(1);

		kg.updateRelation("r1", { weight: -0.5 });
		expect(kg.getRelation("r1")!.weight).toBe(0);
		kg.destroy();
	});
});

describe("knowledgeGraph — Phase 6c: Graph Queries", () => {
	function buildTriangle() {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addEntity("C", { id: "c" });
		kg.addRelation("a", "b", "knows");
		kg.addRelation("b", "c", "knows");
		kg.addRelation("a", "c", "works-with");
		return kg;
	}

	it("outgoing/incoming return correct relations", () => {
		const kg = buildTriangle();
		expect(kg.outgoing("a")).toHaveLength(2);
		expect(kg.outgoing("a", "knows")).toHaveLength(1);
		expect(kg.incoming("c")).toHaveLength(2);
		expect(kg.incoming("c", "works-with")).toHaveLength(1);
		expect(kg.incoming("a")).toHaveLength(0);
		kg.destroy();
	});

	it("neighbors returns correct entities", () => {
		const kg = buildTriangle();

		const outNeighbors = kg.neighbors("a", { direction: "out" });
		expect(outNeighbors.map((n) => n.id).sort()).toEqual(["b", "c"]);

		const inNeighbors = kg.neighbors("c", { direction: "in" });
		expect(inNeighbors.map((n) => n.id).sort()).toEqual(["a", "b"]);

		const knowsNeighbors = kg.neighbors("a", { direction: "out", type: "knows" });
		expect(knowsNeighbors).toHaveLength(1);
		expect(knowsNeighbors[0].id).toBe("b");
		kg.destroy();
	});

	it("traverse performs BFS", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addEntity("C", { id: "c" });
		kg.addEntity("D", { id: "d" });
		kg.addRelation("a", "b", "x");
		kg.addRelation("b", "c", "x");
		kg.addRelation("c", "d", "x");

		// Full traversal
		const all = kg.traverse("a");
		expect(all.map((n) => n.id)).toEqual(["b", "c", "d"]);

		// With maxDepth
		const depth1 = kg.traverse("a", { maxDepth: 1 });
		expect(depth1.map((n) => n.id)).toEqual(["b"]);

		// With maxNodes
		const limited = kg.traverse("a", { maxNodes: 2 });
		expect(limited).toHaveLength(2);
		expect(limited.map((n) => n.id)).toEqual(["b", "c"]);

		// From nonexistent node
		expect(kg.traverse("nonexistent")).toEqual([]);
		kg.destroy();
	});

	it("traverse respects direction", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addEntity("C", { id: "c" });
		kg.addRelation("a", "b", "x");
		kg.addRelation("b", "c", "x");

		// Traversing backwards from "c"
		const backward = kg.traverse("c", { direction: "in" });
		expect(backward.map((n) => n.id)).toEqual(["b", "a"]);

		// Both directions from "b"
		const both = kg.traverse("b", { direction: "both" });
		expect(both.map((n) => n.id).sort()).toEqual(["a", "c"]);
		kg.destroy();
	});

	it("traverse filters by relation type", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addEntity("C", { id: "c" });
		kg.addRelation("a", "b", "knows");
		kg.addRelation("a", "c", "works-with");

		const knowsOnly = kg.traverse("a", { type: "knows" });
		expect(knowsOnly.map((n) => n.id)).toEqual(["b"]);
		kg.destroy();
	});

	it("shortestPath finds path via BFS", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addEntity("C", { id: "c" });
		kg.addEntity("D", { id: "d" });
		kg.addRelation("a", "b", "x");
		kg.addRelation("b", "c", "x");
		kg.addRelation("a", "d", "x");
		kg.addRelation("d", "c", "x");

		// Should find a→b→c or a→d→c (both length 3)
		const path = kg.shortestPath("a", "c");
		expect(path).toBeDefined();
		expect(path![0]).toBe("a");
		expect(path![path!.length - 1]).toBe("c");
		expect(path!).toHaveLength(3);

		// Same node
		expect(kg.shortestPath("a", "a")).toEqual(["a"]);

		// No path (directed — c has no outgoing)
		expect(kg.shortestPath("c", "a", { direction: "out" })).toBeUndefined();

		// No path for nonexistent node
		expect(kg.shortestPath("a", "nonexistent")).toBeUndefined();
		kg.destroy();
	});

	it("subgraph extracts entities and internal relations", () => {
		const kg = buildTriangle();
		kg.addEntity("D", { id: "d" });
		kg.addRelation("c", "d", "knows");

		const sg = kg.subgraph(["a", "b", "c"]);
		expect(sg.entities).toHaveLength(3);
		// Only a→b, b→c, a→c (not c→d since "d" is outside subgraph)
		expect(sg.relations).toHaveLength(3);
		expect(sg.relations.every((r) => r.sourceId !== "d" && r.targetId !== "d")).toBe(true);
		kg.destroy();
	});
});

describe("knowledgeGraph — Phase 6c: Cascade Deletion", () => {
	it("removeEntity cascades to remove all relations", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addEntity("C", { id: "c" });
		kg.addRelation("a", "b", "knows", { id: "r1" });
		kg.addRelation("b", "c", "knows", { id: "r2" });
		kg.addRelation("c", "a", "knows", { id: "r3" });

		expect(kg.relationCount.get()).toBe(3);

		kg.removeEntity("b");
		// r1 (a→b) and r2 (b→c) should be removed
		expect(kg.hasRelation("r1")).toBe(false);
		expect(kg.hasRelation("r2")).toBe(false);
		expect(kg.hasRelation("r3")).toBe(true); // c→a still exists
		expect(kg.relationCount.get()).toBe(1);
		kg.destroy();
	});

	it("eviction cascades to remove relations", () => {
		const kg = knowledgeGraph<string>({
			maxSize: 2,
			weights: { recency: 0, frequency: 0, importance: 1 },
		});

		kg.addEntity("Low", { id: "low", importance: 0.1 });
		kg.addEntity("High", { id: "high", importance: 0.9 });
		kg.addRelation("low", "high", "knows", { id: "r1" });
		expect(kg.relationCount.get()).toBe(1);

		// Adding a 3rd entity evicts "low"
		kg.addEntity("Mid", { id: "mid", importance: 0.5 });
		expect(kg.hasEntity("low")).toBe(false);
		// Relation involving "low" should be gone
		expect(kg.hasRelation("r1")).toBe(false);
		expect(kg.relationCount.get()).toBe(0);
		kg.destroy();
	});
});

describe("knowledgeGraph — Phase 6c: Reactive Queries", () => {
	it("relationsOf returns reactive store", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });

		const relsOf = kg.relationsOf("a", "out");
		expect(relsOf.get()).toEqual([]);

		kg.addRelation("a", "b", "knows");
		expect(relsOf.get()).toHaveLength(1);
		expect(relsOf.get()[0].type).toBe("knows");
		kg.destroy();
	});

	it("relationsOf is cached per entityId+direction", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });

		const s1 = kg.relationsOf("a", "out");
		const s2 = kg.relationsOf("a", "out");
		expect(s1).toBe(s2); // same store instance
		kg.destroy();
	});

	it("neighborsOf returns reactive store", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });

		const n = kg.neighborsOf("a", "out");
		expect(n.get()).toEqual([]);

		kg.addRelation("a", "b", "knows");
		expect(n.get()).toHaveLength(1);
		expect(n.get()[0].id).toBe("b");
		kg.destroy();
	});

	it("relationCount is reactive", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });

		const log: number[] = [];
		const dispose = effect([kg.relationCount], () => {
			log.push(kg.relationCount.get());
		});

		kg.addRelation("a", "b", "knows", { id: "r1" });
		kg.addRelation("a", "b", "works-with", { id: "r2" });
		kg.removeRelation("r1");

		expect(log).toEqual([0, 1, 2, 1]);
		dispose();
		kg.destroy();
	});
});

describe("knowledgeGraph — Phase 6c: Type Index", () => {
	it("typeIndex tracks relation types reactively", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addEntity("C", { id: "c" });

		kg.addRelation("a", "b", "knows", { id: "r1" });
		kg.addRelation("a", "c", "knows", { id: "r2" });
		kg.addRelation("b", "c", "works-with", { id: "r3" });

		const knowsSet = kg.typeIndex.get("knows");
		expect(knowsSet.has("r1")).toBe(true);
		expect(knowsSet.has("r2")).toBe(true);
		expect(knowsSet.size).toBe(2);

		const worksWithSet = kg.typeIndex.get("works-with");
		expect(worksWithSet.has("r3")).toBe(true);
		expect(worksWithSet.size).toBe(1);

		kg.removeRelation("r1");
		expect(kg.typeIndex.get("knows").has("r1")).toBe(false);
		expect(kg.typeIndex.get("knows").size).toBe(1);
		kg.destroy();
	});
});

describe("knowledgeGraph — Phase 6c: Temporal Queries", () => {
	it("relationsInRange finds relations by time", () => {
		vi.useFakeTimers({ now: 1000 });
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addEntity("C", { id: "c" });

		kg.addRelation("a", "b", "knows", { id: "r1" }); // t=1000

		vi.advanceTimersByTime(500);
		kg.addRelation("b", "c", "knows", { id: "r2" }); // t=1500

		vi.advanceTimersByTime(500);
		kg.addRelation("a", "c", "knows", { id: "r3" }); // t=2000

		// Range covering only r2
		const range = kg.relationsInRange(1200, 1800);
		expect(range).toHaveLength(1);
		expect(range[0].id).toBe("r2");

		// Range covering all
		const all = kg.relationsInRange(0, 3000);
		expect(all).toHaveLength(3);

		vi.useRealTimers();
		kg.destroy();
	});
});

describe("knowledgeGraph — Phase 6c: Collection Access", () => {
	it("exposes underlying collection for topK, byTag, etc.", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a", importance: 0.9, tags: ["person"] });
		kg.addEntity("B", { id: "b", importance: 0.1, tags: ["place"] });

		const topNodes = kg.collection.topK(1, { recency: 0, frequency: 0, importance: 1 });
		expect(topNodes[0].id).toBe("a");

		const people = kg.collection.byTag("person");
		expect(people).toHaveLength(1);
		expect(people[0].id).toBe("a");
		kg.destroy();
	});
});

describe("knowledgeGraph — Phase 6c: Lifecycle", () => {
	it("destroy tears down everything", () => {
		const kg = knowledgeGraph<string>();
		kg.addEntity("A", { id: "a" });
		kg.addEntity("B", { id: "b" });
		kg.addRelation("a", "b", "knows");

		let ended = false;
		subscribe(kg.relationCount, () => {}, {
			onEnd: () => {
				ended = true;
			},
		});

		kg.destroy();
		expect(ended).toBe(true);
		expect(() => kg.addEntity("C")).toThrow("KnowledgeGraph is destroyed");
		expect(() => kg.addRelation("a", "b", "x")).toThrow("KnowledgeGraph is destroyed");
	});

	it("throws on operations after destroy", () => {
		const kg = knowledgeGraph<string>();
		kg.destroy();

		expect(() => kg.addEntity("X")).toThrow("KnowledgeGraph is destroyed");
		expect(() => kg.removeEntity("x")).toThrow("KnowledgeGraph is destroyed");
		expect(() => kg.addRelation("a", "b", "x")).toThrow("KnowledgeGraph is destroyed");
		expect(() => kg.removeRelation("r1")).toThrow("KnowledgeGraph is destroyed");
		expect(() => kg.removeRelationsBetween("a", "b")).toThrow("KnowledgeGraph is destroyed");
		expect(() => kg.updateRelation("r1", { weight: 0.5 })).toThrow("KnowledgeGraph is destroyed");
	});

	it("double destroy is safe", () => {
		const kg = knowledgeGraph<string>();
		kg.destroy();
		kg.destroy(); // should not throw
	});
});

// ---------------------------------------------------------------------------
// Phase 6e: Light Collection — FIFO/LRU eviction
// ---------------------------------------------------------------------------
describe("lightCollection — Phase 6e: FIFO/LRU eviction", () => {
	// --- Basic CRUD (same interface as collection) ---

	it("add/remove/get/has", () => {
		const col = lightCollection<string>();

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
		const col = lightCollection<number>();
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
		const col = lightCollection<number>();
		col.add(1, { tags: ["odd"] });
		col.add(2, { tags: ["even"] });
		col.add(3, { tags: ["odd"] });

		const odds = col.query((n) => n.meta.get().tags.has("odd"));
		expect(odds).toHaveLength(2);
		expect(odds.map((n) => n.content.get())).toEqual([1, 3]);
		col.destroy();
	});

	it("byTag returns nodes with specific tag", () => {
		const col = lightCollection<string>();
		col.add("a", { tags: ["x"] });
		col.add("b", { tags: ["y"] });
		col.add("c", { tags: ["x", "y"] });

		const xNodes = col.byTag("x");
		expect(xNodes).toHaveLength(2);
		expect(xNodes.map((n) => n.content.get()).sort()).toEqual(["a", "c"]);
		col.destroy();
	});

	it("topK returns highest-scored nodes", () => {
		const col = lightCollection<string>();
		col.add("low", { importance: 0.1 });
		col.add("mid", { importance: 0.5 });
		col.add("high", { importance: 0.9 });

		const top = col.topK(2, { recency: 0, frequency: 0, importance: 1 });
		expect(top).toHaveLength(2);
		expect(top[0].content.get()).toBe("high");
		expect(top[1].content.get()).toBe("mid");
		col.destroy();
	});

	// --- FIFO eviction ---

	it("FIFO evicts oldest-inserted node on overflow", () => {
		const col = lightCollection<string>({
			maxSize: 2,
			eviction: "fifo",
		});

		col.add("first", { id: "a" });
		col.add("second", { id: "b" });
		expect(col.size.get()).toBe(2);

		col.add("third", { id: "c" });
		expect(col.size.get()).toBe(2);
		expect(col.has("a")).toBe(false); // oldest evicted
		expect(col.has("b")).toBe(true);
		expect(col.has("c")).toBe(true);
		col.destroy();
	});

	it("FIFO ignores access — evicts by insertion order", () => {
		const col = lightCollection<string>({
			maxSize: 2,
			eviction: "fifo",
		});

		col.add("first", { id: "a" });
		col.add("second", { id: "b" });

		// Access "a" — should NOT prevent its eviction under FIFO
		col.get("a");

		col.add("third", { id: "c" });
		expect(col.has("a")).toBe(false); // still evicted despite access
		expect(col.has("b")).toBe(true);
		expect(col.has("c")).toBe(true);
		col.destroy();
	});

	it("FIFO defaults when no eviction option specified", () => {
		const col = lightCollection<string>({ maxSize: 2 });

		col.add("first", { id: "a" });
		col.add("second", { id: "b" });
		col.add("third", { id: "c" });

		// Default is FIFO — oldest evicted
		expect(col.has("a")).toBe(false);
		expect(col.has("c")).toBe(true);
		col.destroy();
	});

	// --- LRU eviction ---

	it("LRU evicts least-recently-accessed node on overflow", () => {
		const col = lightCollection<string>({
			maxSize: 2,
			eviction: "lru",
		});

		col.add("first", { id: "a" });
		col.add("second", { id: "b" });

		// Access "a" — makes "b" the LRU
		col.get("a");

		col.add("third", { id: "c" });
		expect(col.has("a")).toBe(true); // accessed recently
		expect(col.has("b")).toBe(false); // LRU — evicted
		expect(col.has("c")).toBe(true);
		col.destroy();
	});

	it("LRU evicts by insertion order when no access", () => {
		const col = lightCollection<string>({
			maxSize: 2,
			eviction: "lru",
		});

		col.add("first", { id: "a" });
		col.add("second", { id: "b" });

		// No access — LRU falls back to insertion order
		col.add("third", { id: "c" });
		expect(col.has("a")).toBe(false);
		expect(col.has("b")).toBe(true);
		expect(col.has("c")).toBe(true);
		col.destroy();
	});

	it("LRU touches on admission update/merge", () => {
		const col = lightCollection<string>({
			maxSize: 2,
			eviction: "lru",
			admissionPolicy: (incoming, nodes) => {
				const dup = nodes.find((n) => n.content.get() === incoming);
				if (dup) return { action: "update", targetId: dup.id, content: `${incoming}!` };
				return { action: "admit" };
			},
		});

		col.add("a", { id: "x" });
		col.add("b", { id: "y" });

		// Update "x" via admission policy — touches it in LRU
		col.add("a");

		// Now "y" is LRU, "x" was just touched
		col.add("c", { id: "z" });
		expect(col.has("x")).toBe(true);
		expect(col.has("y")).toBe(false); // LRU evicted
		expect(col.has("z")).toBe(true);
		col.destroy();
	});

	// --- Shared features (admission, forget, summarize, gc, destroy) ---

	it("admissionPolicy works", () => {
		const col = lightCollection<string>({
			admissionPolicy: () => ({ action: "reject" }),
		});

		const result = col.add("nope");
		expect(result).toBeUndefined();
		expect(col.size.get()).toBe(0);
		col.destroy();
	});

	it("forgetPolicy runs before add", () => {
		const col = lightCollection<string>({
			maxSize: 10,
			forgetPolicy: (node) => node.meta.get().importance < 0.2,
		});

		col.add("will-be-forgotten", { importance: 0.1, id: "low" });
		col.add("keeper", { importance: 0.9, id: "high" });

		// Adding a third triggers forget policy — low-importance node pruned
		col.add("trigger", { id: "trigger" });
		expect(col.has("low")).toBe(false);
		expect(col.has("high")).toBe(true);
		expect(col.has("trigger")).toBe(true);
		col.destroy();
	});

	it("gc() runs forgetPolicy on demand", () => {
		const col = lightCollection<string>({
			forgetPolicy: (node) => node.meta.get().importance < 0.2,
		});

		col.add("high", { importance: 0.9, id: "high" });
		// Demote importance after add — forgetPolicy didn't see it as low yet
		col.get("high")!.setImportance(0.1);

		const removed = col.gc();
		expect(removed).toBe(1);
		expect(col.has("high")).toBe(false);
		col.destroy();
	});

	it("summarize consolidates nodes", () => {
		const col = lightCollection<string>();
		col.add("hello", { id: "a" });
		col.add("world", { id: "b" });

		const summary = col.summarize(["a", "b"], (nodes) =>
			nodes.map((n) => n.content.get()).join(" "),
		);

		expect(summary.content.get()).toBe("hello world");
		expect(col.has("a")).toBe(false);
		expect(col.has("b")).toBe(false);
		expect(col.size.get()).toBe(1);
		col.destroy();
	});

	it("destroy tears down all nodes and cascades END", () => {
		const col = lightCollection<string>();
		col.add("a");
		col.add("b");

		let sizeEnded = false;
		subscribe(col.size, () => {}, {
			onEnd: () => {
				sizeEnded = true;
			},
		});

		col.destroy();
		expect(sizeEnded).toBe(true);
		expect(() => col.add("c")).toThrow("Collection is destroyed");
	});

	it("double destroy is safe", () => {
		const col = lightCollection<string>();
		col.destroy();
		col.destroy(); // should not throw
	});

	it("tagIndex updates on node tag changes", () => {
		const col = lightCollection<string>();
		const n = col.add("data", { id: "n1", tags: ["a"] });

		expect(col.byTag("a")).toHaveLength(1);
		n.tag("b");
		expect(col.byTag("b")).toHaveLength(1);
		n.untag("a");
		expect(col.byTag("a")).toHaveLength(0);
		col.destroy();
	});

	it("tagIndex cleans up when node is removed", () => {
		const col = lightCollection<string>();
		col.add("data", { id: "n1", tags: ["x"] });

		expect(col.tagIndex.get("x").has("n1")).toBe(true);
		col.remove("n1");
		expect(col.tagIndex.get("x").size).toBe(0);
		col.destroy();
	});

	it("no maxSize means no eviction", () => {
		const col = lightCollection<string>();
		for (let i = 0; i < 100; i++) col.add(`item-${i}`);
		expect(col.size.get()).toBe(100);
		col.destroy();
	});

	it("remove by node reference", () => {
		const col = lightCollection<string>();
		const n = col.add("test");
		expect(col.remove(n)).toBe(true);
		expect(col.size.get()).toBe(0);
		col.destroy();
	});

	it("FIFO eviction + forgetPolicy: forget prunes before eviction", () => {
		const col = lightCollection<string>({
			maxSize: 3,
			eviction: "fifo",
			forgetPolicy: (node) => node.meta.get().importance < 0.2,
		});

		col.add("a", { id: "a", importance: 0.9 });
		col.add("b", { id: "b", importance: 0.9 });
		col.add("c", { id: "c", importance: 0.9 });
		expect(col.size.get()).toBe(3);

		// Demote "a" so forgetPolicy will remove it
		col.get("a")!.setImportance(0.1);

		// Adding "d" triggers forgetPolicy first (removes "a"), then insert.
		// No eviction needed — size stays at 3.
		col.add("d", { id: "d", importance: 0.9 });
		expect(col.size.get()).toBe(3);
		expect(col.has("a")).toBe(false); // pruned by forgetPolicy
		expect(col.has("b")).toBe(true); // NOT evicted — forgetPolicy freed space
		expect(col.has("c")).toBe(true);
		expect(col.has("d")).toBe(true);
		col.destroy();
	});

	it("LRU eviction + forgetPolicy: eviction respects access after forget", () => {
		const col = lightCollection<string>({
			maxSize: 2,
			eviction: "lru",
			forgetPolicy: (node) => node.meta.get().importance < 0.2,
		});

		col.add("a", { id: "a", importance: 0.9 });
		col.add("b", { id: "b", importance: 0.9 });

		// Access "a" to make "b" the LRU
		col.get("a");

		// Add "c" — no forget candidates, so eviction kicks in. "b" is LRU.
		col.add("c", { id: "c", importance: 0.9 });
		expect(col.has("a")).toBe(true);
		expect(col.has("b")).toBe(false); // LRU evicted
		expect(col.has("c")).toBe(true);
		col.destroy();
	});
});
