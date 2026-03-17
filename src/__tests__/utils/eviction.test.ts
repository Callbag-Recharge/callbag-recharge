import { describe, expect, it } from "vitest";
import { fifo, lfu, lru, random, scored } from "../../utils/eviction";

// ---------------------------------------------------------------------------
// FIFO
// ---------------------------------------------------------------------------
describe("fifo", () => {
	it("evicts in insertion order", () => {
		const p = fifo<string>();
		p.insert("a");
		p.insert("b");
		p.insert("c");
		expect(p.evict()).toEqual(["a"]);
		expect(p.evict()).toEqual(["b"]);
		expect(p.evict()).toEqual(["c"]);
		expect(p.evict()).toEqual([]);
	});

	it("ignores duplicate inserts", () => {
		const p = fifo<string>();
		p.insert("a");
		p.insert("a");
		expect(p.size()).toBe(1);
		expect(p.evict()).toEqual(["a"]);
		expect(p.evict()).toEqual([]);
	});

	it("touch does not affect order", () => {
		const p = fifo<string>();
		p.insert("a");
		p.insert("b");
		p.touch("a"); // no-op for FIFO
		expect(p.evict()).toEqual(["a"]);
	});

	it("delete removes from queue", () => {
		const p = fifo<string>();
		p.insert("a");
		p.insert("b");
		p.insert("c");
		p.delete("b");
		expect(p.size()).toBe(2);
		expect(p.evict(2)).toEqual(["a", "c"]);
	});

	it("evict(count) returns multiple keys", () => {
		const p = fifo<string>();
		p.insert("a");
		p.insert("b");
		p.insert("c");
		expect(p.evict(2)).toEqual(["a", "b"]);
		expect(p.size()).toBe(1);
	});

	it("clear resets state", () => {
		const p = fifo<string>();
		p.insert("a");
		p.insert("b");
		p.clear();
		expect(p.size()).toBe(0);
		expect(p.evict()).toEqual([]);
	});

	it("lazy delete — evict skips deleted entries", () => {
		const p = fifo<string>();
		p.insert("a");
		p.insert("b");
		p.insert("c");
		p.insert("d");
		p.delete("b");
		p.delete("c");
		// evict should skip b and c, return a then d
		expect(p.evict()).toEqual(["a"]);
		expect(p.evict()).toEqual(["d"]);
		expect(p.size()).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// LRU
// ---------------------------------------------------------------------------
describe("lru", () => {
	it("evicts least recently used", () => {
		const p = lru<string>();
		p.insert("a");
		p.insert("b");
		p.insert("c");
		// "a" is LRU (oldest insert, no touch)
		expect(p.evict()).toEqual(["a"]);
	});

	it("touch moves key to front", () => {
		const p = lru<string>();
		p.insert("a");
		p.insert("b");
		p.insert("c");
		p.touch("a"); // "a" moves to front, "b" is now LRU
		expect(p.evict()).toEqual(["b"]);
	});

	it("insert of existing key moves to front", () => {
		const p = lru<string>();
		p.insert("a");
		p.insert("b");
		p.insert("a"); // move "a" to front
		expect(p.evict()).toEqual(["b"]);
	});

	it("evict multiple", () => {
		const p = lru<string>();
		p.insert("a");
		p.insert("b");
		p.insert("c");
		expect(p.evict(2)).toEqual(["a", "b"]);
		expect(p.size()).toBe(1);
	});

	it("delete removes key", () => {
		const p = lru<string>();
		p.insert("a");
		p.insert("b");
		p.insert("c");
		p.delete("a");
		expect(p.size()).toBe(2);
		expect(p.evict()).toEqual(["b"]);
	});

	it("clear resets state", () => {
		const p = lru<string>();
		p.insert("a");
		p.insert("b");
		p.clear();
		expect(p.size()).toBe(0);
		expect(p.evict()).toEqual([]);
	});

	it("complex access pattern", () => {
		const p = lru<string>();
		p.insert("a");
		p.insert("b");
		p.insert("c");
		p.insert("d");
		p.touch("b");
		p.touch("a");
		// Order (most recent first): a, b, d, c
		expect(p.evict()).toEqual(["c"]);
		expect(p.evict()).toEqual(["d"]);
		expect(p.evict()).toEqual(["b"]);
		expect(p.evict()).toEqual(["a"]);
	});
});

// ---------------------------------------------------------------------------
// LFU
// ---------------------------------------------------------------------------
describe("lfu", () => {
	it("evicts least frequently used", () => {
		const p = lfu<string>();
		p.insert("a");
		p.insert("b");
		p.insert("c");
		p.touch("b");
		p.touch("c");
		p.touch("c");
		// freq: a=1, b=2, c=3
		expect(p.evict()).toEqual(["a"]);
	});

	it("ties broken by insertion order (Set iteration)", () => {
		const p = lfu<string>();
		p.insert("a");
		p.insert("b");
		// Both freq=1, "a" inserted first → evicted first
		expect(p.evict()).toEqual(["a"]);
	});

	it("re-insert acts as touch", () => {
		const p = lfu<string>();
		p.insert("a");
		p.insert("b");
		p.insert("a"); // acts as touch, freq→2
		// b has freq=1, a has freq=2
		expect(p.evict()).toEqual(["b"]);
	});

	it("evict multiple", () => {
		const p = lfu<string>();
		p.insert("a");
		p.insert("b");
		p.insert("c");
		p.touch("c"); // c=2
		expect(p.evict(2)).toEqual(["a", "b"]);
	});

	it("delete removes key", () => {
		const p = lfu<string>();
		p.insert("a");
		p.insert("b");
		p.insert("c");
		p.delete("a");
		expect(p.size()).toBe(2);
		expect(p.evict()).toEqual(["b"]);
	});

	it("clear resets state", () => {
		const p = lfu<string>();
		p.insert("a");
		p.clear();
		expect(p.size()).toBe(0);
		expect(p.evict()).toEqual([]);
	});

	it("handles large frequency gaps after delete — O(1), no scan", () => {
		const p = lfu<string>();
		p.insert("a");
		p.insert("b");
		// Touch "b" 1,000,000 times — old impl would scan 1M buckets on delete
		for (let i = 0; i < 1_000_000; i++) p.touch("b");
		// Delete "a" (freq=1, the min bucket) — new impl is O(1)
		p.delete("a");
		// "b" at freq=1_000_001 must still be evictable
		expect(p.evict()).toEqual(["b"]);
		expect(p.size()).toBe(0);
	});

	it("min bucket always points to correct node after touch", () => {
		const p = lfu<string>();
		p.insert("a"); // freq=1
		p.insert("b"); // freq=1
		p.touch("a"); // a→freq=2, b still at freq=1
		// b is LFU
		expect(p.evict()).toEqual(["b"]);
		// Now only a (freq=2) remains
		expect(p.evict()).toEqual(["a"]);
		expect(p.size()).toBe(0);
	});

	it("bucket reuse — freq+1 bucket used by multiple keys", () => {
		const p = lfu<string>();
		p.insert("a"); // freq=1
		p.insert("b"); // freq=1
		p.touch("a"); // a→freq=2
		p.touch("b"); // b→freq=2 — both in same freq=2 bucket
		p.insert("c"); // freq=1, new min
		expect(p.evict()).toEqual(["c"]);
		// a and b both at freq=2
		expect(p.size()).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Scored
// ---------------------------------------------------------------------------
describe("scored", () => {
	it("evicts lowest-scored key", () => {
		const scores: Record<string, number> = { a: 10, b: 5, c: 15 };
		const p = scored<string>((k) => scores[k]);
		p.insert("a");
		p.insert("b");
		p.insert("c");
		expect(p.evict()).toEqual(["b"]); // lowest score
	});

	it("evicts multiple lowest-scored", () => {
		const scores: Record<string, number> = { a: 10, b: 5, c: 15, d: 1 };
		const p = scored<string>((k) => scores[k]);
		p.insert("a");
		p.insert("b");
		p.insert("c");
		p.insert("d");
		expect(p.evict(2)).toEqual(["d", "b"]);
	});

	it("dynamic scores — uses score at eviction time", () => {
		let aScore = 100;
		const p = scored<string>((k) => (k === "a" ? aScore : 50));
		p.insert("a");
		p.insert("b");
		// a=100, b=50 → evict b
		expect(p.evict()).toEqual(["b"]);

		p.insert("b");
		aScore = 1;
		// a=1, b=50 → evict a
		expect(p.evict()).toEqual(["a"]);
	});

	it("delete removes key from scoring", () => {
		const p = scored<string>(() => 0);
		p.insert("a");
		p.insert("b");
		p.delete("a");
		expect(p.size()).toBe(1);
		expect(p.evict()).toEqual(["b"]);
	});

	it("clear resets state", () => {
		const p = scored<string>(() => 0);
		p.insert("a");
		p.clear();
		expect(p.size()).toBe(0);
	});

	it("scoreFn throwing evicts that key first (-Infinity)", () => {
		const p = scored<string>((k) => {
			if (k === "bad") throw new Error("corrupted");
			return 100;
		});
		p.insert("good");
		p.insert("bad");
		// "bad" throws → -Infinity score → evicted first
		expect(p.evict()).toEqual(["bad"]);
		expect(p.evict()).toEqual(["good"]);
	});
});

// ---------------------------------------------------------------------------
// Random
// ---------------------------------------------------------------------------
describe("random", () => {
	it("evicts a key", () => {
		const p = random<string>();
		p.insert("a");
		p.insert("b");
		p.insert("c");
		const result = p.evict();
		expect(result).toHaveLength(1);
		expect(["a", "b", "c"]).toContain(result[0]);
		expect(p.size()).toBe(2);
	});

	it("evict multiple", () => {
		const p = random<string>();
		p.insert("a");
		p.insert("b");
		p.insert("c");
		const result = p.evict(3);
		expect(result).toHaveLength(3);
		expect(new Set(result).size).toBe(3); // all unique
		expect(p.size()).toBe(0);
	});

	it("delete removes key", () => {
		const p = random<string>();
		p.insert("a");
		p.insert("b");
		p.delete("a");
		expect(p.size()).toBe(1);
		expect(p.evict()).toEqual(["b"]);
	});

	it("ignores duplicate inserts", () => {
		const p = random<string>();
		p.insert("a");
		p.insert("a");
		expect(p.size()).toBe(1);
	});

	it("clear resets state", () => {
		const p = random<string>();
		p.insert("a");
		p.insert("b");
		p.clear();
		expect(p.size()).toBe(0);
		expect(p.evict()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------
describe("EvictionPolicy common behavior", () => {
	const factories = [
		["fifo", fifo],
		["lru", lru],
		["lfu", lfu],
		["random", random],
	] as const;

	for (const [name, factory] of factories) {
		it(`${name}: evict from empty returns []`, () => {
			const p = factory<string>();
			expect(p.evict()).toEqual([]);
		});

		it(`${name}: evict more than available returns what's available`, () => {
			const p = factory<string>();
			p.insert("x");
			const result = p.evict(5);
			expect(result).toEqual(["x"]);
			expect(p.size()).toBe(0);
		});

		it(`${name}: delete non-existent key is safe`, () => {
			const p = factory<string>();
			p.delete("nope"); // should not throw
			expect(p.size()).toBe(0);
		});
	}
});
