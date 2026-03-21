import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../../utils/checkpoint";
import { fifo, lru } from "../../utils/eviction";
import { tieredStorage } from "../../utils/tieredStorage";

describe("tieredStorage", () => {
	// --- Basic read/write ---

	it("writes to hot, reads from hot", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const adapter = tieredStorage(hot, cold);

		adapter.save("key", 42);
		expect(adapter.load("key")).toBe(42);
	});

	it("falls back to cold on hot miss", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		cold.save("key", "from-cold");

		const adapter = tieredStorage(hot, cold);
		expect(adapter.load("key")).toBe("from-cold");
	});

	it("returns undefined when both miss", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const adapter = tieredStorage(hot, cold);

		expect(adapter.load("missing")).toBeUndefined();
	});

	// --- Auto-promote on cold hit ---

	it("auto-promotes cold hit to hot", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		cold.save("key", "value");

		const adapter = tieredStorage(hot, cold);
		adapter.load("key"); // triggers auto-promote

		expect(hot.load("key")).toBe("value");
	});

	// --- Clear ---

	it("clear removes from both tiers", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const adapter = tieredStorage(hot, cold);

		adapter.save("key", "value");
		cold.save("key", "cold-value"); // also in cold

		adapter.clear("key");
		expect(hot.load("key")).toBeUndefined();
		expect(cold.load("key")).toBeUndefined();
	});

	// --- Eviction with maxHotSize ---

	it("evicts from hot when maxHotSize exceeded (LRU default)", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const adapter = tieredStorage(hot, cold, { maxHotSize: 2 });

		adapter.save("a", 1);
		adapter.save("b", 2);
		adapter.save("c", 3); // should evict "a" (LRU)

		// "a" demoted to cold
		expect(cold.load("a")).toBe(1);
		// "b" and "c" still in hot
		expect(hot.load("b")).toBe(2);
		expect(hot.load("c")).toBe(3);
	});

	it("LRU eviction respects access order", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const adapter = tieredStorage(hot, cold, { maxHotSize: 2, eviction: lru() });

		adapter.save("a", 1);
		adapter.save("b", 2);
		adapter.load("a"); // touch "a", making "b" the LRU
		adapter.save("c", 3); // should evict "b" (least recently used)

		expect(cold.load("b")).toBe(2);
		expect(hot.load("a")).toBe(1);
		expect(hot.load("c")).toBe(3);
	});

	it("uses custom eviction policy (FIFO)", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const adapter = tieredStorage(hot, cold, { maxHotSize: 2, eviction: fifo() });

		adapter.save("a", 1);
		adapter.save("b", 2);
		adapter.load("a"); // touch doesn't matter for FIFO
		adapter.save("c", 3); // should evict "a" (first in)

		expect(cold.load("a")).toBe(1);
		expect(hot.load("b")).toBe(2);
		expect(hot.load("c")).toBe(3);
	});

	it("auto-promote triggers eviction if hot full", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const adapter = tieredStorage(hot, cold, { maxHotSize: 2 });

		adapter.save("a", 1);
		adapter.save("b", 2);
		// Now load from cold — should promote and evict "a"
		cold.save("c", 3);
		adapter.load("c"); // promote "c", evict "a"

		expect(hot.load("c")).toBe(3);
		// "a" should have been demoted back to cold
		expect(cold.load("a")).toBe(1);
	});

	// --- Manual promote/demote ---

	it("promote copies cold to hot", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const adapter = tieredStorage(hot, cold);

		cold.save("key", "value");
		adapter.promote("key");
		expect(hot.load("key")).toBe("value");
	});

	it("promote is no-op when key not in cold", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const adapter = tieredStorage(hot, cold);

		adapter.promote("missing"); // should not throw
		expect(hot.load("missing")).toBeUndefined();
	});

	it("demote copies hot to cold and clears hot", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const adapter = tieredStorage(hot, cold);

		adapter.save("key", "value");
		adapter.demote("key");

		expect(hot.load("key")).toBeUndefined();
		expect(cold.load("key")).toBe("value");
	});

	it("demote is safe when key not in hot", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const adapter = tieredStorage(hot, cold);

		adapter.demote("missing"); // should not throw
	});

	// --- No maxHotSize (unlimited) ---

	it("no eviction without maxHotSize", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const adapter = tieredStorage(hot, cold);

		for (let i = 0; i < 100; i++) {
			adapter.save(`key-${i}`, i);
		}

		// All should be in hot, nothing demoted
		for (let i = 0; i < 100; i++) {
			expect(hot.load(`key-${i}`)).toBe(i);
			expect(cold.load(`key-${i}`)).toBeUndefined();
		}
	});

	// --- Edge: clear updates eviction policy ---

	it("clear removes from eviction tracking", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const adapter = tieredStorage(hot, cold, { maxHotSize: 2 });

		adapter.save("a", 1);
		adapter.save("b", 2);
		adapter.clear("a"); // removes "a" from tracking

		adapter.save("c", 3); // should NOT evict "b" since "a" was cleared
		expect(hot.load("b")).toBe(2);
		expect(hot.load("c")).toBe(3);
	});
});
