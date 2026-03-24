import { describe, expect, it } from "vitest";
import { memoryStore } from "../../../patterns/memoryStore";

// ---------------------------------------------------------------------------
// memoryStore
// ---------------------------------------------------------------------------
describe("memoryStore", () => {
	it("creates with empty tiers", () => {
		const mem = memoryStore<string>();
		expect(mem.session.get()).toEqual([]);
		expect(mem.working.get()).toEqual([]);
		expect(mem.longTerm.get()).toEqual([]);
		expect(mem.totalSize.get()).toBe(0);
		mem.destroy();
	});

	// ---------------------------------------------------------------------------
	// Session memory
	// ---------------------------------------------------------------------------
	it("remember adds to session memory", () => {
		const mem = memoryStore<string>();
		const node = mem.remember("hello");
		expect(node.content.get()).toBe("hello");
		expect(mem.session.get().length).toBe(1);
		expect(mem.totalSize.get()).toBe(1);
		mem.destroy();
	});

	// ---------------------------------------------------------------------------
	// Working memory
	// ---------------------------------------------------------------------------
	it("focus adds to working memory", () => {
		const mem = memoryStore<string>();
		mem.focus("task A", { tags: ["task"] });
		expect(mem.working.get().length).toBe(1);
		expect(mem.working.get()[0].content.get()).toBe("task A");
		mem.destroy();
	});

	it("working memory evicts at capacity", () => {
		const mem = memoryStore<string>({ workingCapacity: 3 });
		mem.focus("a");
		mem.focus("b");
		mem.focus("c");
		expect(mem.working.get().length).toBe(3);

		mem.focus("d"); // should evict one
		expect(mem.working.get().length).toBe(3);
		mem.destroy();
	});

	// ---------------------------------------------------------------------------
	// Long-term memory
	// ---------------------------------------------------------------------------
	it("store adds to long-term memory", () => {
		const mem = memoryStore<string>();
		mem.store("fact", { importance: 0.9, tags: ["knowledge"] });
		expect(mem.longTerm.get().length).toBe(1);
		mem.destroy();
	});

	it("long-term memory evicts at capacity", () => {
		const mem = memoryStore<string>({ longTermCapacity: 2 });
		mem.store("a");
		mem.store("b");
		expect(mem.longTerm.get().length).toBe(2);

		mem.store("c"); // should evict one
		expect(mem.longTerm.get().length).toBe(2);
		mem.destroy();
	});

	// ---------------------------------------------------------------------------
	// Cross-tier operations
	// ---------------------------------------------------------------------------
	it("promote moves from session to long-term", () => {
		const mem = memoryStore<string>();
		const node = mem.remember("important insight", {
			importance: 0.8,
			tags: ["insight"],
		});
		const nodeId = node.id;

		expect(mem.session.get().length).toBe(1);
		expect(mem.longTerm.get().length).toBe(0);

		const result = mem.promote(nodeId);
		expect(result).toBe(true);
		expect(mem.session.get().length).toBe(0);
		expect(mem.longTerm.get().length).toBe(1);
		mem.destroy();
	});

	it("promote moves from working to long-term", () => {
		const mem = memoryStore<string>();
		const node = mem.focus("active task");
		const result = mem.promote(node.id);
		expect(result).toBe(true);
		expect(mem.working.get().length).toBe(0);
		expect(mem.longTerm.get().length).toBe(1);
		mem.destroy();
	});

	it("promote returns false for unknown node", () => {
		const mem = memoryStore<string>();
		expect(mem.promote("nonexistent")).toBe(false);
		mem.destroy();
	});

	it("recall returns top-K across all tiers", () => {
		const mem = memoryStore<string>();
		mem.remember("session item");
		mem.focus("working item");
		mem.store("long-term item", { importance: 0.9 });

		const results = mem.recall(10);
		expect(results.length).toBe(3);
		mem.destroy();
	});

	it("recallByTag finds across tiers", () => {
		const mem = memoryStore<string>();
		mem.remember("s", { tags: ["shared"] });
		mem.focus("w", { tags: ["shared"] });
		mem.store("lt", { tags: ["other"] });

		const results = mem.recallByTag("shared");
		expect(results.length).toBe(2);
		mem.destroy();
	});

	it("search filters across tiers", () => {
		const mem = memoryStore<string>();
		mem.remember("apple");
		mem.focus("banana");
		mem.store("avocado");

		const results = mem.search((n) => n.content.get().startsWith("a"));
		expect(results.length).toBe(2); // apple + avocado
		mem.destroy();
	});

	// ---------------------------------------------------------------------------
	// Lifecycle
	// ---------------------------------------------------------------------------
	it("resetSession clears only session", () => {
		const mem = memoryStore<string>();
		mem.remember("session");
		mem.focus("working");
		mem.store("long-term");

		mem.resetSession();
		// Session is destroyed, but working and long-term persist
		expect(mem.working.get().length).toBe(1);
		expect(mem.longTerm.get().length).toBe(1);
		mem.destroy();
	});

	it("destroy clears everything", () => {
		const mem = memoryStore<string>();
		mem.remember("a");
		mem.focus("b");
		mem.store("c");

		mem.destroy();
		// After destroy, collections are cleaned up
	});

	// ---------------------------------------------------------------------------
	// Reactive stats
	// ---------------------------------------------------------------------------
	it("totalSize tracks across all tiers", () => {
		const mem = memoryStore<string>();
		expect(mem.totalSize.get()).toBe(0);

		mem.remember("a");
		expect(mem.totalSize.get()).toBe(1);

		mem.focus("b");
		expect(mem.totalSize.get()).toBe(2);

		mem.store("c");
		expect(mem.totalSize.get()).toBe(3);
		mem.destroy();
	});
});
