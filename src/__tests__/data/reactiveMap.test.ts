import { describe, expect, it, vi } from "vitest";
import { effect } from "../../core/effect";
import { reactiveMap } from "../../data/reactiveMap";
import { lru, scored } from "../../utils/eviction";

describe("reactiveMap — Level 3: Reactive Data Structures", () => {
	// -----------------------------------------------------------------------
	// Basic CRUD
	// -----------------------------------------------------------------------
	describe("basic CRUD", () => {
		it("get/set/has/delete", () => {
			const m = reactiveMap<number>();
			expect(m.get("a")).toBe(undefined);
			expect(m.has("a")).toBe(false);

			m.set("a", 1);
			expect(m.get("a")).toBe(1);
			expect(m.has("a")).toBe(true);

			expect(m.delete("a")).toBe(true);
			expect(m.get("a")).toBe(undefined);
			expect(m.has("a")).toBe(false);
			expect(m.delete("a")).toBe(false);
			m.destroy();
		});

		it("keys/values/size/entries", () => {
			const m = reactiveMap<string>();
			m.set("x", "hello");
			m.set("y", "world");

			expect(m.size()).toBe(2);
			expect(m.keys()).toEqual(["x", "y"]);
			expect(m.values()).toEqual(["hello", "world"]);
			expect(m.entries()).toEqual([
				["x", "hello"],
				["y", "world"],
			]);
			m.destroy();
		});

		it("clear removes all keys", () => {
			const m = reactiveMap<number>();
			m.set("a", 1);
			m.set("b", 2);
			m.clear();
			expect(m.size()).toBe(0);
			expect(m.keys()).toEqual([]);
			m.destroy();
		});

		it("overwrite existing key", () => {
			const m = reactiveMap<number>();
			m.set("a", 1);
			m.set("a", 2);
			expect(m.get("a")).toBe(2);
			expect(m.size()).toBe(1);
			m.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Atomic operations
	// -----------------------------------------------------------------------
	describe("atomic operations", () => {
		it("update() performs atomic read-modify-write", () => {
			const m = reactiveMap<number>();
			m.set("count", 10);
			m.update("count", (v) => (v ?? 0) + 5);
			expect(m.get("count")).toBe(15);
			m.destroy();
		});

		it("update() works on missing key", () => {
			const m = reactiveMap<number>();
			m.update("new", (v) => (v ?? 0) + 1);
			expect(m.get("new")).toBe(1);
			m.destroy();
		});

		it("getOrSet() returns existing value without calling factory", () => {
			const m = reactiveMap<number>();
			m.set("a", 42);
			const factory = vi.fn(() => 99);
			const val = m.getOrSet("a", factory);
			expect(val).toBe(42);
			expect(factory).not.toHaveBeenCalled();
			m.destroy();
		});

		it("getOrSet() calls factory for missing key and stores result", () => {
			const m = reactiveMap<number>();
			const val = m.getOrSet("a", () => 99);
			expect(val).toBe(99);
			expect(m.get("a")).toBe(99);
			m.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Reactive API
	// -----------------------------------------------------------------------
	describe("reactive API", () => {
		it("select() returns a read-only reactive view of a key", () => {
			const m = reactiveMap<number>();
			const s = m.select("a");
			expect(s.get()).toBe(undefined);

			m.set("a", 10);
			expect(s.get()).toBe(10);

			m.delete("a");
			expect(s.get()).toBe(undefined);
			m.destroy();
		});

		it("select() returns cached store for same key", () => {
			const m = reactiveMap<number>();
			const s1 = m.select("a");
			const s2 = m.select("a");
			expect(s1).toBe(s2);
			m.destroy();
		});

		it("select() is read-only — no set() method exposed", () => {
			const m = reactiveMap<number>();
			const s = m.select("a");
			expect("set" in s).toBe(false);
			m.destroy();
		});

		it("keysStore reactively tracks key changes", () => {
			const m = reactiveMap<number>();
			const log: string[][] = [];
			const dispose = effect([m.keysStore], () => {
				log.push([...m.keysStore.get()]);
			});

			m.set("a", 1);
			m.set("b", 2);
			m.delete("a");

			expect(log).toEqual([[], ["a"], ["a", "b"], ["b"]]);
			dispose();
			m.destroy();
		});

		it("sizeStore reactively tracks size", () => {
			const m = reactiveMap<number>();
			const log: number[] = [];
			const dispose = effect([m.sizeStore], () => {
				log.push(m.sizeStore.get());
			});

			m.set("a", 1);
			m.set("b", 2);
			m.delete("a");

			expect(log).toEqual([0, 1, 2, 1]);
			dispose();
			m.destroy();
		});

		it("where() returns reactive filtered view", () => {
			const m = reactiveMap<number>();
			const big = m.where((v) => v > 5);

			m.set("a", 3);
			m.set("b", 10);
			m.set("c", 7);

			expect(big.get()).toEqual([
				["b", 10],
				["c", 7],
			]);
			m.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Events
	// -----------------------------------------------------------------------
	describe("events", () => {
		it("emits set events", () => {
			const m = reactiveMap<number>();
			const log: Array<{ type: string; key?: string }> = [];
			const dispose = effect([m.events], () => {
				const e = m.events.get();
				if (e) log.push({ type: e.type, key: e.key });
			});

			m.set("a", 1);
			m.set("b", 2);
			m.delete("a");

			expect(log).toEqual([
				{ type: "set", key: "a" },
				{ type: "set", key: "b" },
				{ type: "delete", key: "a" },
			]);
			dispose();
			m.destroy();
		});

		it("emits clear event", () => {
			const m = reactiveMap<number>();
			const log: string[] = [];
			const dispose = effect([m.events], () => {
				const e = m.events.get();
				if (e) log.push(e.type);
			});

			m.set("a", 1);
			m.clear();

			expect(log).toContain("clear");
			dispose();
			m.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Batch
	// -----------------------------------------------------------------------
	describe("batch", () => {
		it("setMany sets multiple keys atomically", () => {
			const m = reactiveMap<number>();
			const log: number[] = [];
			const dispose = effect([m.sizeStore], () => {
				log.push(m.sizeStore.get());
			});

			m.setMany({ a: 1, b: 2, c: 3 });
			expect(m.size()).toBe(3);
			expect(m.get("a")).toBe(1);
			expect(m.get("b")).toBe(2);
			expect(m.get("c")).toBe(3);

			// Should have initial (0) then one batched update (3)
			expect(log).toEqual([0, 3]);
			dispose();
			m.destroy();
		});

		it("setMany accepts array of tuples", () => {
			const m = reactiveMap<string>();
			m.setMany([
				["x", "hello"],
				["y", "world"],
			]);
			expect(m.get("x")).toBe("hello");
			expect(m.get("y")).toBe("world");
			m.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// TTL
	// -----------------------------------------------------------------------
	describe("TTL", () => {
		it("setWithTTL expires key after timeout", () => {
			vi.useFakeTimers();
			const m = reactiveMap<number>();

			m.setWithTTL("temp", 42, 100);
			expect(m.get("temp")).toBe(42);

			vi.advanceTimersByTime(50);
			expect(m.has("temp")).toBe(true);

			vi.advanceTimersByTime(51);
			expect(m.has("temp")).toBe(false);
			expect(m.get("temp")).toBe(undefined);

			m.destroy();
			vi.useRealTimers();
		});

		it("defaultTTL applies to all keys", () => {
			vi.useFakeTimers();
			const m = reactiveMap<number>({ defaultTTL: 200 });

			m.set("a", 1);
			m.set("b", 2);

			vi.advanceTimersByTime(201);
			expect(m.has("a")).toBe(false);
			expect(m.has("b")).toBe(false);

			m.destroy();
			vi.useRealTimers();
		});

		it("setWithTTL overrides defaultTTL", () => {
			vi.useFakeTimers();
			const m = reactiveMap<number>({ defaultTTL: 100 });

			m.setWithTTL("a", 1, 500);

			vi.advanceTimersByTime(101);
			expect(m.has("a")).toBe(true);

			vi.advanceTimersByTime(400);
			expect(m.has("a")).toBe(false);

			m.destroy();
			vi.useRealTimers();
		});

		it("delete clears TTL timer", () => {
			vi.useFakeTimers();
			const m = reactiveMap<number>();

			m.setWithTTL("a", 1, 100);
			m.delete("a");

			// Re-add without TTL
			m.set("a", 2);
			vi.advanceTimersByTime(200);

			expect(m.has("a")).toBe(true);
			m.destroy();
			vi.useRealTimers();
		});

		it("ttl() returns remaining time", () => {
			vi.useFakeTimers();
			const m = reactiveMap<number>();

			m.setWithTTL("a", 1, 1000);
			vi.advanceTimersByTime(300);

			const remaining = m.ttl("a");
			expect(remaining).toBeGreaterThan(600);
			expect(remaining).toBeLessThanOrEqual(700);

			expect(m.ttl("nonexistent")).toBe(undefined);

			m.destroy();
			vi.useRealTimers();
		});

		it("persist() removes TTL", () => {
			vi.useFakeTimers();
			const m = reactiveMap<number>();

			m.setWithTTL("a", 1, 100);
			m.persist("a");

			vi.advanceTimersByTime(200);
			expect(m.has("a")).toBe(true);
			expect(m.ttl("a")).toBe(undefined);

			m.destroy();
			vi.useRealTimers();
		});
	});

	// -----------------------------------------------------------------------
	// Namespace
	// -----------------------------------------------------------------------
	describe("namespace", () => {
		it("scopes get/set/has/delete with prefix", () => {
			const m = reactiveMap<number>();
			const ns = m.namespace("user:");

			ns.set("alice", 1);
			ns.set("bob", 2);

			expect(ns.get("alice")).toBe(1);
			expect(ns.has("alice")).toBe(true);
			expect(m.get("user:alice")).toBe(1);

			expect(ns.keys()).toEqual(["alice", "bob"]);
			expect(ns.size()).toBe(2);
			expect(ns.entries()).toEqual([
				["alice", 1],
				["bob", 2],
			]);

			ns.delete("alice");
			expect(ns.has("alice")).toBe(false);
			expect(m.has("user:alice")).toBe(false);
			m.destroy();
		});

		it("namespace clear only removes scoped keys", () => {
			const m = reactiveMap<number>();
			m.set("global", 0);
			const ns = m.namespace("ns:");
			ns.set("a", 1);
			ns.set("b", 2);

			ns.clear();
			expect(ns.size()).toBe(0);
			expect(m.has("global")).toBe(true);
			expect(m.size()).toBe(1);
			m.destroy();
		});

		it("nested namespaces", () => {
			const m = reactiveMap<number>();
			const ns1 = m.namespace("a:");
			const ns2 = ns1.namespace("b:");

			ns2.set("c", 42);
			expect(m.get("a:b:c")).toBe(42);
			expect(ns1.get("b:c")).toBe(42);
			expect(ns2.get("c")).toBe(42);
			m.destroy();
		});

		it("namespace select() is reactive", () => {
			const m = reactiveMap<number>();
			const ns = m.namespace("ns:");
			const s = ns.select("x");

			expect(s.get()).toBe(undefined);
			ns.set("x", 42);
			expect(s.get()).toBe(42);
			m.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Eviction
	// -----------------------------------------------------------------------
	describe("maxSize eviction", () => {
		it("evicts oldest keys when maxSize exceeded (FIFO)", () => {
			const m = reactiveMap<number>({ maxSize: 3 });

			m.set("a", 1);
			m.set("b", 2);
			m.set("c", 3);
			expect(m.size()).toBe(3);

			m.set("d", 4);
			expect(m.size()).toBe(3);
			expect(m.has("a")).toBe(false); // Oldest evicted
			expect(m.has("b")).toBe(true);
			expect(m.has("d")).toBe(true);
			m.destroy();
		});

		it("overwrite does not trigger eviction", () => {
			const m = reactiveMap<number>({ maxSize: 2 });

			m.set("a", 1);
			m.set("b", 2);
			m.set("a", 10); // Overwrite — not a new key

			expect(m.size()).toBe(2);
			expect(m.get("a")).toBe(10);
			expect(m.has("b")).toBe(true);
			m.destroy();
		});

		it("LRU eviction respects get() access pattern", () => {
			const m = reactiveMap<number>({ maxSize: 3, eviction: lru() });

			m.set("a", 1);
			m.set("b", 2);
			m.set("c", 3);
			// Access "a" — moves it to front
			m.get("a");
			// Insert "d" — should evict "b" (LRU), not "a"
			m.set("d", 4);
			expect(m.has("a")).toBe(true); // touched via get()
			expect(m.has("b")).toBe(false); // LRU victim
			expect(m.has("c")).toBe(true);
			expect(m.has("d")).toBe(true);
			m.destroy();
		});

		it("LRU eviction respects set() overwrite access", () => {
			const m = reactiveMap<number>({ maxSize: 3, eviction: lru() });

			m.set("a", 1);
			m.set("b", 2);
			m.set("c", 3);
			// Overwrite "a" — touches it in LRU
			m.set("a", 10);
			// Insert "d" — should evict "b" (LRU), not "a"
			m.set("d", 4);
			expect(m.has("a")).toBe(true);
			expect(m.has("b")).toBe(false);
			m.destroy();
		});

		it("new key cannot be evicted by its own insertion", () => {
			// Score function: "new" always scores lowest
			const m = reactiveMap<number>({
				maxSize: 2,
				eviction: scored((k: string) => (k === "new" ? -1 : 100)),
			});

			m.set("a", 1);
			m.set("b", 2);
			// "new" has lowest score but should NOT self-evict
			m.set("new", 3);
			expect(m.has("new")).toBe(true);
			expect(m.size()).toBe(2);
			m.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------
	describe("lifecycle", () => {
		it("destroy prevents further writes", () => {
			const m = reactiveMap<number>();
			m.set("a", 1);
			m.destroy();
			m.set("b", 2);
			expect(m.has("b")).toBe(false);
		});

		it("destroy clears TTL timers", () => {
			vi.useFakeTimers();
			const m = reactiveMap<number>();
			m.setWithTTL("a", 1, 100);
			m.destroy();
			vi.advanceTimersByTime(200);
			// No errors — timer was cleaned up
			vi.useRealTimers();
		});
	});

	// -----------------------------------------------------------------------
	// Custom equals
	// -----------------------------------------------------------------------
	it("custom equals prevents duplicate emissions", () => {
		const m = reactiveMap<{ x: number }>({
			equals: (a, b) => a.x === b.x,
		});

		const s = m.select("a");
		const log: Array<{ x: number } | undefined> = [];
		const dispose = effect([s], () => {
			log.push(s.get());
		});

		m.set("a", { x: 1 });
		m.set("a", { x: 1 }); // Same by custom equals — should be deduped
		m.set("a", { x: 2 });

		expect(log).toEqual([undefined, { x: 1 }, { x: 2 }]);
		dispose();
		m.destroy();
	});
});
