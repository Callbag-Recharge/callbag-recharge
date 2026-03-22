import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../../utils/checkpoint";
import { fifo, lru } from "../../utils/eviction";
import { tieredStorage } from "../../utils/tieredStorage";

describe("tieredStorage", () => {
	// --- Basic read/write ---

	it("writes to hot, reads from hot", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const storage = tieredStorage([hot, cold]);

		storage.save("key", 42);
		expect(storage.load("key").get()).toBe(42);
	});

	it("falls back to cold on hot miss", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		cold.save("key", "from-cold");

		const storage = tieredStorage([hot, cold]);
		expect(storage.load("key").get()).toBe("from-cold");
	});

	it("returns undefined when both miss", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const storage = tieredStorage([hot, cold]);

		expect(storage.load("missing").get()).toBeUndefined();
	});

	// --- Auto-promote on cold hit ---

	it("auto-promotes cold hit to hot", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		cold.save("key", "value");

		const storage = tieredStorage([hot, cold]);
		storage.load("key"); // triggers auto-promote

		expect(hot.load("key")).toBe("value");
	});

	// --- Delete ---

	it("delete removes from both tiers", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const storage = tieredStorage([hot, cold]);

		storage.save("key", "value");
		cold.save("key", "cold-value"); // also in cold

		storage.delete("key");
		expect(hot.load("key")).toBeUndefined();
		expect(cold.load("key")).toBeUndefined();
	});

	// --- Eviction with maxSize ---

	it("evicts from cache when maxSize exceeded (LRU default)", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const storage = tieredStorage([hot, cold], { maxSize: 2 });

		storage.save("a", 1);
		storage.save("b", 2);
		storage.save("c", 3); // should evict "a" (LRU)

		// "a" demoted to cold (last tier with save)
		expect(cold.load("a")).toBe(1);
		// "b" and "c" still cached
		expect(storage.has("b")).toBe(true);
		expect(storage.has("c")).toBe(true);
	});

	it("LRU eviction respects access order", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const storage = tieredStorage([hot, cold], {
			maxSize: 2,
			eviction: lru(),
		});

		storage.save("a", 1);
		storage.save("b", 2);
		storage.load("a"); // touch "a", making "b" the LRU
		storage.save("c", 3); // should evict "b" (least recently used)

		expect(cold.load("b")).toBe(2);
		expect(storage.has("a")).toBe(true);
		expect(storage.has("c")).toBe(true);
	});

	it("uses custom eviction policy (FIFO)", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const storage = tieredStorage([hot, cold], {
			maxSize: 2,
			eviction: fifo(),
		});

		storage.save("a", 1);
		storage.save("b", 2);
		storage.load("a"); // touch doesn't matter for FIFO
		storage.save("c", 3); // should evict "a" (first in)

		expect(cold.load("a")).toBe(1);
		expect(storage.has("b")).toBe(true);
		expect(storage.has("c")).toBe(true);
	});

	it("auto-promote triggers eviction if cache full", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const storage = tieredStorage([hot, cold], { maxSize: 2 });

		storage.save("a", 1);
		storage.save("b", 2);
		// Now load from cold — should promote and evict "a"
		cold.save("c", 3);
		storage.load("c"); // promote "c", evict "a"

		expect(storage.load("c").get()).toBe(3);
		// "a" should have been demoted to cold
		expect(cold.load("a")).toBe(1);
	});

	// --- Singleton store behavior ---

	it("load returns same store instance for same key", () => {
		const storage = tieredStorage([memoryAdapter()]);
		storage.save("k", 1);
		const s1 = storage.load("k");
		const s2 = storage.load("k");
		expect(s1).toBe(s2);
	});

	it("save updates existing store in-place", () => {
		const storage = tieredStorage([memoryAdapter()]);
		storage.save("k", 1);
		const store = storage.load("k");
		expect(store.get()).toBe(1);

		storage.save("k", 2);
		expect(store.get()).toBe(2); // same instance, updated in-place
	});

	it("invalidate re-cascades into same store", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		cold.save("k", "original");

		const storage = tieredStorage([hot, cold]);
		const store = storage.load("k");
		expect(store.get()).toBe("original");

		// Simulate external update to cold
		cold.save("k", "updated");
		hot.clear("k");
		storage.invalidate("k");

		expect(store.get()).toBe("updated");
	});

	// --- 3-tier cascade ---

	it("supports 3+ tiers", () => {
		const t0 = memoryAdapter();
		const t1 = memoryAdapter();
		const t2 = memoryAdapter();
		t2.save("k", "deep");

		const storage = tieredStorage([t0, t1, t2]);
		const store = storage.load("k");

		expect(store.get()).toBe("deep");
		// Auto-promoted to both faster tiers
		expect(t0.load("k")).toBe("deep");
		expect(t1.load("k")).toBe("deep");
	});

	// --- No maxSize (unlimited) ---

	it("no eviction without maxSize", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const storage = tieredStorage([hot, cold]);

		for (let i = 0; i < 100; i++) {
			storage.save(`key-${i}`, i);
		}

		// All should be cached
		for (let i = 0; i < 100; i++) {
			expect(storage.load(`key-${i}`).get()).toBe(i);
		}
	});

	// --- Edge: delete updates eviction tracking ---

	it("delete removes from eviction tracking", () => {
		const hot = memoryAdapter();
		const cold = memoryAdapter();
		const storage = tieredStorage([hot, cold], { maxSize: 2 });

		storage.save("a", 1);
		storage.save("b", 2);
		storage.delete("a"); // removes "a" from tracking

		storage.save("c", 3); // should NOT evict "b" since "a" was deleted
		expect(storage.has("b")).toBe(true);
		expect(storage.has("c")).toBe(true);
	});

	// --- has() and size ---

	it("has() and size track entries", () => {
		const storage = tieredStorage([memoryAdapter()]);

		expect(storage.has("k")).toBe(false);
		expect(storage.size).toBe(0);

		storage.save("k", 1);
		expect(storage.has("k")).toBe(true);
		expect(storage.size).toBe(1);

		storage.delete("k");
		expect(storage.has("k")).toBe(false);
		expect(storage.size).toBe(0);
	});
});
