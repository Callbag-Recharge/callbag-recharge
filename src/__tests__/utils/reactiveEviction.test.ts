import { describe, expect, it } from "vitest";
import { producer } from "../../core/producer";
import { state } from "../../core/state";
import { reactiveScored } from "../../utils/reactiveEviction";

describe("reactiveScored", () => {
	// ---- Basic correctness ----

	it("evicts lowest-scored key", () => {
		const scores = { a: state(10), b: state(5), c: state(15) };
		const p = reactiveScored<string>((k) => scores[k as keyof typeof scores]);
		p.insert("a");
		p.insert("b");
		p.insert("c");
		expect(p.evict()).toEqual(["b"]); // b has lowest score (5)
	});

	it("evict(k) extracts k lowest", () => {
		const scores = { a: state(10), b: state(5), c: state(15), d: state(1) };
		const p = reactiveScored<string>((k) => scores[k as keyof typeof scores]);
		for (const k of Object.keys(scores)) p.insert(k);
		expect(p.evict(2)).toEqual(["d", "b"]); // d=1, b=5
		expect(p.size()).toBe(2);
	});

	it("evict from empty returns []", () => {
		const p = reactiveScored<string>((_k) => state(0));
		expect(p.evict()).toEqual([]);
	});

	// ---- Core feature: reactive heap update ----

	it("score push updates heap position — O(log n)", () => {
		const scoreA = state(100);
		const scoreB = state(50);
		const p = reactiveScored<string>((k) => (k === "a" ? scoreA : scoreB));
		p.insert("a");
		p.insert("b");

		// Initial: b(50) < a(100), so b is min
		expect(p.evict()).toEqual(["b"]);
		p.insert("b"); // re-insert b

		// Now push a's score below b's — heap must update immediately
		scoreA.set(1);
		expect(p.evict()).toEqual(["a"]); // a is now min
	});

	it("score decreasing sifts key up (toward min)", () => {
		const scoreA = state(50);
		const scoreB = state(50);
		const scoreC = state(50);
		const p = reactiveScored<string>((k) => {
			if (k === "a") return scoreA;
			if (k === "b") return scoreB;
			return scoreC;
		});
		p.insert("a");
		p.insert("b");
		p.insert("c");

		// Drop c's score to 1 — should become the new min
		scoreC.set(1);
		expect(p.evict()).toEqual(["c"]);
	});

	it("score increasing sifts key down (away from min)", () => {
		const scoreA = state(10);
		const scoreB = state(20);
		const p = reactiveScored<string>((k) => (k === "a" ? scoreA : scoreB));
		p.insert("a");
		p.insert("b");
		// a is min. Push a's score above b's.
		scoreA.set(100);
		// Now b should be min
		expect(p.evict()).toEqual(["b"]);
	});

	it("multiple score updates before evict — only last matters", () => {
		const score = state(1);
		const scoreB = state(50);
		const p = reactiveScored<string>((k) => (k === "a" ? score : scoreB));
		p.insert("a");
		p.insert("b");
		// Bounce a's score around
		score.set(100);
		score.set(200);
		score.set(5); // ends below b
		expect(p.evict()).toEqual(["a"]);
	});

	// ---- delete ----

	it("delete removes key and unsubscribes", () => {
		const scoreA = state(10);
		const p = reactiveScored<string>((_k) => scoreA);
		p.insert("a");
		p.insert("b");
		p.delete("a");
		expect(p.size()).toBe(1);
		// Push scoreA to a very low value — should NOT affect heap (unsubscribed)
		scoreA.set(-Infinity);
		expect(p.evict()).toEqual(["b"]);
	});

	it("delete non-existent key is safe", () => {
		const p = reactiveScored<string>((_k) => state(0));
		p.delete("nope");
		expect(p.size()).toBe(0);
	});

	it("delete updates heap correctly for arbitrary positions", () => {
		const scores = {
			a: state(10),
			b: state(20),
			c: state(30),
			d: state(40),
		};
		const p = reactiveScored<string>((k) => scores[k as keyof typeof scores]);
		for (const k of Object.keys(scores)) p.insert(k);
		// Delete a middle element
		p.delete("b");
		expect(p.size()).toBe(3);
		// Remaining: a(10), c(30), d(40)
		expect(p.evict()).toEqual(["a"]);
		expect(p.evict()).toEqual(["c"]);
		expect(p.evict()).toEqual(["d"]);
	});

	// ---- clear ----

	it("clear removes all keys and unsubscribes", () => {
		const scoreA = state(10);
		const p = reactiveScored<string>((_k) => scoreA);
		p.insert("a");
		p.insert("b");
		p.clear();
		expect(p.size()).toBe(0);
		// Score changes after clear should be silent (unsubscribed)
		scoreA.set(-Infinity);
		expect(p.evict()).toEqual([]);
	});

	// ---- touch is a no-op ----

	it("touch() is a no-op — reactivity handles updates", () => {
		const score = state(50);
		const p = reactiveScored<string>((_k) => score);
		p.insert("a");
		p.touch("a"); // should not throw or change anything
		expect(p.size()).toBe(1);
	});

	// ---- heap invariants under stress ----

	it("maintains correct min after many score changes", () => {
		const n = 20;
		// Start at 100 so no key begins at 0
		const stores = Array.from({ length: n }, (_, i) => state((i + 1) * 10));
		const p = reactiveScored<number>((k) => stores[k]);
		for (let i = 0; i < n; i++) p.insert(i);

		// Push key 15 to score 0 — should become new min
		stores[15].set(0);
		expect(p.evict()).toEqual([15]);
		expect(p.size()).toBe(n - 1);

		// Push key 3 to score -1 — should become new min
		stores[3].set(-1);
		expect(p.evict()).toEqual([3]);
	});

	// ---- store END cleanup (optimizations.md #3) ----

	it("store END removes entry from heap automatically", () => {
		let completeA: (() => void) | undefined;
		const storeA = producer<number>(({ emit, complete }) => {
			emit(10);
			completeA = complete;
		});
		const storeB = state(20);
		const p = reactiveScored<string>((k) => (k === "a" ? storeA : storeB));
		p.insert("a");
		p.insert("b");
		expect(p.size()).toBe(2);

		// Complete storeA — should auto-remove "a" from heap
		completeA!();
		expect(p.size()).toBe(1);
		expect(p.evict()).toEqual(["b"]);
	});

	it("store END after manual delete does not double-remove", () => {
		let completeA: (() => void) | undefined;
		const storeA = producer<number>(({ emit, complete }) => {
			emit(5);
			completeA = complete;
		});
		const p = reactiveScored<string>((_k) => storeA);
		p.insert("a");

		// Manually delete first
		p.delete("a");
		expect(p.size()).toBe(0);

		// Now complete — onEnd fires but entry is already gone, should be a no-op
		completeA!();
		expect(p.size()).toBe(0);
	});

	it("evicts in correct order after reactive score reordering", () => {
		const sa = state(30);
		const sb = state(20);
		const sc = state(10);
		const p = reactiveScored<string>((k) => (k === "a" ? sa : k === "b" ? sb : sc));
		p.insert("a");
		p.insert("b");
		p.insert("c");
		// Invert all scores: a→1, b→2, c→3
		sa.set(1);
		sb.set(2);
		sc.set(3);
		expect(p.evict()).toEqual(["a"]);
		expect(p.evict()).toEqual(["b"]);
		expect(p.evict()).toEqual(["c"]);
	});
});
