import { describe, expect, it } from "vitest";
import { Inspector } from "../../core/inspector";
import { rawFromPromise } from "../../raw/fromPromise";
import type { CacheTier } from "../../utils/cascadingCache";
import { cascadingCache } from "../../utils/cascadingCache";

/** Helper: sync in-memory tier backed by a Map. */
function memoryTier<V>(): CacheTier<V> & { data: Map<string, V> } {
	const data = new Map<string, V>();
	return {
		data,
		load: (key) => data.get(key),
		save: (key, value) => {
			data.set(key, value);
		},
		clear: (key) => {
			data.delete(key);
		},
	};
}

/** Helper: async tier with configurable delay, returning CallbagSource. */
function asyncTier<V>(delayMs = 10): CacheTier<V> & { data: Map<string, V> } {
	const data = new Map<string, V>();
	return {
		data,
		load: (key) =>
			rawFromPromise(new Promise((resolve) => setTimeout(() => resolve(data.get(key)), delayMs))),
		save: (key, value) =>
			rawFromPromise(
				new Promise<void>((resolve) =>
					setTimeout(() => {
						data.set(key, value);
						resolve();
					}, delayMs),
				),
			),
		clear: (key) =>
			rawFromPromise(
				new Promise<void>((resolve) =>
					setTimeout(() => {
						data.delete(key);
						resolve();
					}, delayMs),
				),
			),
	};
}

describe("cascadingCache", () => {
	describe("basic operations", () => {
		it("returns undefined store on all-miss", () => {
			const cache = cascadingCache([memoryTier()]);
			const store = cache.load("missing");
			expect(store.get()).toBe(undefined);
		});

		it("sync tier 0 hit — store has value immediately", () => {
			const hot = memoryTier<number>();
			hot.data.set("k", 42);
			const cache = cascadingCache([hot]);
			const store = cache.load("k");
			expect(store.get()).toBe(42);
		});

		it("singleton — same key returns same store instance", () => {
			const hot = memoryTier<number>();
			hot.data.set("k", 1);
			const cache = cascadingCache([hot]);
			const s1 = cache.load("k");
			const s2 = cache.load("k");
			expect(s1).toBe(s2);
		});

		it("save writes to tier 0 and updates cache store", () => {
			const hot = memoryTier<number>();
			const cache = cascadingCache([hot]);
			cache.save("k", 99);
			expect(hot.data.get("k")).toBe(99);
			expect(cache.load("k").get()).toBe(99);
		});

		it("save updates existing store in-place", () => {
			const hot = memoryTier<number>();
			hot.data.set("k", 1);
			const cache = cascadingCache([hot]);
			const store = cache.load("k");
			expect(store.get()).toBe(1);

			cache.save("k", 2);
			expect(store.get()).toBe(2); // same instance updated
		});

		it("has() and size", () => {
			const cache = cascadingCache([memoryTier<number>()]);
			expect(cache.has("k")).toBe(false);
			expect(cache.size).toBe(0);

			cache.load("k");
			expect(cache.has("k")).toBe(true);
			expect(cache.size).toBe(1);
		});

		it("delete removes from cache and all tiers", () => {
			const hot = memoryTier<number>();
			const cold = memoryTier<number>();
			hot.data.set("k", 1);
			cold.data.set("k", 1);
			const cache = cascadingCache([hot, cold]);
			cache.load("k");

			cache.delete("k");
			expect(cache.has("k")).toBe(false);
			expect(hot.data.has("k")).toBe(false);
			expect(cold.data.has("k")).toBe(false);
		});
	});

	describe("tier cascading", () => {
		it("tier 0 miss → tier 1 hit — auto-promotes to tier 0", () => {
			const hot = memoryTier<string>();
			const cold = memoryTier<string>();
			cold.data.set("k", "from-cold");

			const cache = cascadingCache([hot, cold]);
			const store = cache.load("k");

			expect(store.get()).toBe("from-cold");
			expect(hot.data.get("k")).toBe("from-cold"); // auto-promoted
		});

		it("3-tier cascade — promotes to all faster tiers", () => {
			const t0 = memoryTier<number>();
			const t1 = memoryTier<number>();
			const t2 = memoryTier<number>();
			t2.data.set("k", 777);

			const cache = cascadingCache([t0, t1, t2]);
			const store = cache.load("k");

			expect(store.get()).toBe(777);
			expect(t0.data.get("k")).toBe(777);
			expect(t1.data.get("k")).toBe(777);
		});

		it("async tier — store starts undefined, resolves later", async () => {
			const cold = asyncTier<string>(10);
			cold.data.set("k", "async-val");

			const cache = cascadingCache([memoryTier(), cold]);
			const store = cache.load("k");

			expect(store.get()).toBe(undefined); // not yet resolved
			await new Promise((r) => setTimeout(r, 30));
			expect(store.get()).toBe("async-val");
		});

		it("async tier — auto-promotes to sync tier", async () => {
			const hot = memoryTier<string>();
			const cold = asyncTier<string>(10);
			cold.data.set("k", "val");

			const cache = cascadingCache([hot, cold]);
			cache.load("k");

			await new Promise((r) => setTimeout(r, 30));
			expect(hot.data.get("k")).toBe("val");
		});

		it("mixed sync miss → async hit cascades correctly", async () => {
			const t0 = memoryTier<number>();
			const t1 = memoryTier<number>(); // miss
			const t2 = asyncTier<number>(10);
			t2.data.set("k", 42);

			const cache = cascadingCache([t0, t1, t2]);
			const store = cache.load("k");

			expect(store.get()).toBe(undefined);
			await new Promise((r) => setTimeout(r, 30));
			expect(store.get()).toBe(42);
			expect(t0.data.get("k")).toBe(42);
			expect(t1.data.get("k")).toBe(42);
		});

		it("read-only tier (no save) — promotion skips it", () => {
			const readOnly: CacheTier<number> = {
				load: () => undefined,
				// no save, no clear
			};
			const cold = memoryTier<number>();
			cold.data.set("k", 5);

			const cache = cascadingCache([readOnly, cold]);
			const store = cache.load("k");
			expect(store.get()).toBe(5);
			// readOnly has no save — promotion skipped silently
		});
	});

	describe("subscribers see updates", () => {
		it("subscriber notified when async tier resolves", async () => {
			const cold = asyncTier<string>(10);
			cold.data.set("k", "hello");

			const cache = cascadingCache([memoryTier(), cold]);
			const store = cache.load("k");
			const obs = Inspector.observe(store);

			await new Promise((r) => setTimeout(r, 30));
			expect(obs.values).toContain("hello");
		});

		it("subscriber notified on save (update in-place)", () => {
			const cache = cascadingCache([memoryTier<number>()]);
			const store = cache.load("k");
			const obs = Inspector.observe(store);

			cache.save("k", 10);
			cache.save("k", 20);
			expect(obs.values).toEqual([10, 20]);
		});

		it("invalidate re-cascades into same store — subscriber sees update", () => {
			const hot = memoryTier<number>();
			const cold = memoryTier<number>();
			cold.data.set("k", 1);

			const cache = cascadingCache([hot, cold]);
			const store = cache.load("k");
			expect(store.get()).toBe(1);

			const obs = Inspector.observe(store);

			// Simulate external update to cold tier
			cold.data.set("k", 2);
			hot.data.delete("k");
			cache.invalidate("k");

			expect(store.get()).toBe(2);
			expect(obs.values).toContain(2);
		});

		it("invalidate on same store instance — reference preserved", () => {
			const cache = cascadingCache([memoryTier<number>()]);
			const store1 = cache.load("k");
			cache.invalidate("k");
			const store2 = cache.load("k");
			expect(store1).toBe(store2); // same instance
		});
	});

	describe("concurrent dedup", () => {
		it("concurrent load() calls share one cascade", async () => {
			let loadCount = 0;
			const slow: CacheTier<string> = {
				load: (key) => {
					loadCount++;
					return rawFromPromise(new Promise((r) => setTimeout(() => r(`val-${key}`), 10)));
				},
			};

			const cache = cascadingCache([slow]);
			const s1 = cache.load("k");
			const s2 = cache.load("k");

			expect(s1).toBe(s2); // singleton
			await new Promise((r) => setTimeout(r, 30));
			expect(loadCount).toBe(1); // only one tier.load() call
			expect(s1.get()).toBe("val-k");
		});
	});

	describe("eviction", () => {
		it("evicts oldest entry when maxSize exceeded (LRU default)", () => {
			const hot = memoryTier<number>();
			const cache = cascadingCache<number>([hot], { maxSize: 2 });

			cache.save("a", 1);
			cache.save("b", 2);
			cache.save("c", 3); // should evict "a"

			expect(cache.has("a")).toBe(false);
			expect(cache.has("b")).toBe(true);
			expect(cache.has("c")).toBe(true);
		});

		it("LRU touch keeps entry alive", () => {
			const hot = memoryTier<number>();
			hot.data.set("a", 1);
			hot.data.set("b", 2);
			const cache = cascadingCache<number>([hot], { maxSize: 2 });

			cache.load("a");
			cache.load("b");
			cache.load("a"); // touch a — b is now oldest

			cache.save("c", 3); // should evict "b"
			expect(cache.has("a")).toBe(true);
			expect(cache.has("b")).toBe(false);
			expect(cache.has("c")).toBe(true);
		});

		it("evicted entry demotes to last tier with save", () => {
			const hot = memoryTier<number>();
			const cold = memoryTier<number>();
			const cache = cascadingCache<number>([hot, cold], { maxSize: 1 });

			cache.save("a", 1);
			cache.save("b", 2); // evicts "a" → demotes to cold

			expect(cold.data.get("a")).toBe(1);
		});
	});

	describe("error handling", () => {
		it("sync tier load throw — falls through to next tier", () => {
			const broken: CacheTier<number> = {
				load: () => {
					throw new Error("broken");
				},
			};
			const fallback = memoryTier<number>();
			fallback.data.set("k", 42);

			const cache = cascadingCache([broken, fallback]);
			const store = cache.load("k");
			expect(store.get()).toBe(42);
		});

		it("async tier load rejection — falls through to next tier", async () => {
			const broken: CacheTier<number> = {
				load: () => rawFromPromise(Promise.reject(new Error("fail"))),
			};
			const fallback = memoryTier<number>();
			fallback.data.set("k", 99);

			const cache = cascadingCache([broken, fallback]);
			const store = cache.load("k");

			// broken is async (CallbagSource), so cascade goes async
			await new Promise((r) => setTimeout(r, 10));
			expect(store.get()).toBe(99);
		});
	});
});
