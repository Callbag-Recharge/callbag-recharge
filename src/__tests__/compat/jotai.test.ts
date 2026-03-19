import { describe, expect, it, vi } from "vitest";
import { atom } from "../../compat/jotai";

describe("compat/jotai", () => {
	// -----------------------------------------------------------------------
	// Primitive atom
	// -----------------------------------------------------------------------

	describe("primitive atom", () => {
		it("initializes with a value", () => {
			const a = atom(42);
			expect(a.get()).toBe(42);
		});

		it("set updates the value", () => {
			const a = atom(0);
			a.set(5);
			expect(a.get()).toBe(5);
		});

		it("update applies a function", () => {
			const a = atom(10);
			a.update((n) => n + 5);
			expect(a.get()).toBe(15);
		});

		it("subscribe receives changes", () => {
			const a = atom(0);
			const values: number[] = [];
			const unsub = a.subscribe((v) => values.push(v));

			a.set(1);
			a.set(2);
			expect(values).toEqual([1, 2]);

			unsub();
			a.set(3);
			expect(values).toEqual([1, 2]);
		});

		it("equality guard skips duplicates", () => {
			const a = atom(5);
			const cb = vi.fn();
			a.subscribe(cb);

			a.set(5); // same
			expect(cb).not.toHaveBeenCalled();

			a.set(6);
			expect(cb).toHaveBeenCalledWith(6);
		});

		it("has _kind = primitive", () => {
			const a = atom(0);
			expect(a._kind).toBe("primitive");
		});
	});

	// -----------------------------------------------------------------------
	// Derived atom (read-only)
	// -----------------------------------------------------------------------

	describe("derived atom", () => {
		it("computes from a single atom", () => {
			const count = atom(3);
			const doubled = atom((get) => get(count) * 2);
			expect(doubled.get()).toBe(6);
		});

		it("recomputes when dependency changes", () => {
			const count = atom(1);
			const doubled = atom((get) => get(count) * 2);

			count.set(5);
			expect(doubled.get()).toBe(10);
		});

		it("computes from multiple atoms", () => {
			const a = atom(2);
			const b = atom(3);
			const sum = atom((get) => get(a) + get(b));
			expect(sum.get()).toBe(5);

			a.set(10);
			expect(sum.get()).toBe(13);
		});

		it("chains derived atoms", () => {
			const a = atom(1);
			const b = atom((get) => get(a) * 2);
			const c = atom((get) => get(b) + 10);

			expect(c.get()).toBe(12);

			a.set(5);
			expect(c.get()).toBe(20);
		});

		it("subscribe receives changes", () => {
			const count = atom(0);
			const doubled = atom((get) => get(count) * 2);
			const values: number[] = [];
			const unsub = doubled.subscribe((v) => values.push(v));

			count.set(3);
			expect(values).toEqual([6]);

			unsub();
			count.set(5);
			expect(values).toEqual([6]);
		});

		it("has _kind = derived", () => {
			const count = atom(0);
			const d = atom((get) => get(count));
			expect(d._kind).toBe("derived");
		});

		it("push-phase memoization with equals", () => {
			const count = atom(1);
			const isPositive = atom((get) => get(count) > 0);
			const cb = vi.fn();
			isPositive.subscribe(cb);

			count.set(2); // still true
			expect(cb).not.toHaveBeenCalled();

			count.set(-1); // now false
			expect(cb).toHaveBeenCalledWith(false);
		});
	});

	// -----------------------------------------------------------------------
	// Writable derived atom
	// -----------------------------------------------------------------------

	describe("writable derived atom", () => {
		it("reads like a derived atom", () => {
			const count = atom(3);
			const clamped = atom(
				(get) => get(count),
				(_get, set, value: number) => set(count, Math.max(0, Math.min(100, value))),
			);
			expect(clamped.get()).toBe(3);
		});

		it("write function updates underlying atom", () => {
			const count = atom(0);
			const clamped = atom(
				(get) => get(count),
				(_get, set, value: number) => set(count, Math.max(0, Math.min(100, value))),
			);

			clamped.set(50);
			expect(count.get()).toBe(50);
			expect(clamped.get()).toBe(50);
		});

		it("write function applies constraints", () => {
			const count = atom(0);
			const clamped = atom(
				(get) => get(count),
				(_get, set, value: number) => set(count, Math.max(0, Math.min(100, value))),
			);

			clamped.set(200);
			expect(count.get()).toBe(100);

			clamped.set(-50);
			expect(count.get()).toBe(0);
		});

		it("update applies function then write", () => {
			const count = atom(10);
			const doubled = atom(
				(get) => get(count),
				(_get, set, value: number) => set(count, value),
			);

			doubled.update((v) => v * 2);
			expect(count.get()).toBe(20);
		});

		it("write can read other atoms via get", () => {
			const a = atom(10);
			const b = atom(5);
			const synced = atom(
				(get) => get(a),
				(get, set, _value: number) => {
					set(a, get(b));
				},
			);

			synced.set(0); // triggers sync from b to a
			expect(a.get()).toBe(5);
		});

		it("has _kind = writable-derived", () => {
			const count = atom(0);
			const w = atom(
				(get) => get(count),
				(_get, set, v: number) => set(count, v),
			);
			expect(w._kind).toBe("writable-derived");
		});
	});

	// -----------------------------------------------------------------------
	// Dynamic dep tracking (D1 fix)
	// -----------------------------------------------------------------------

	describe("dynamic dep tracking", () => {
		it("tracks deps used in the read function", () => {
			const a = atom(1);
			const b = atom(2);
			const sum = atom((get) => get(a) + get(b));

			expect(sum.get()).toBe(3);

			a.set(10);
			expect(sum.get()).toBe(12);

			b.set(20);
			expect(sum.get()).toBe(30);
		});

		it("conditional deps work with subscribe", () => {
			const flag = atom(true);
			const a = atom(1);
			const b = atom(2);
			const result = atom((get) => (get(flag) ? get(a) : get(b)));

			const values: number[] = [];
			const unsub = result.subscribe((v) => values.push(v));

			expect(result.get()).toBe(1);

			// Switch to false branch — b becomes a dep
			flag.set(false);
			expect(result.get()).toBe(2);

			// b changes should now propagate to subscribers
			b.set(20);
			expect(result.get()).toBe(20);

			// a changes should NOT propagate (no longer in active branch)
			values.length = 0;
			a.set(100);
			// result still reads b since flag is false
			expect(result.get()).toBe(20);

			unsub();
		});

		it("deps discovered later are subscribed dynamically", () => {
			const flag = atom(false);
			const a = atom(10);
			const b = atom(20);
			const result = atom((get) => {
				if (get(flag)) return get(a) + get(b);
				return get(a);
			});

			const values: number[] = [];
			const unsub = result.subscribe((v) => values.push(v));

			// Initially only flag + a are deps
			expect(result.get()).toBe(10);

			// Enable flag — b becomes a dep
			flag.set(true);
			expect(result.get()).toBe(30);

			// b changes should now propagate
			b.set(100);
			expect(result.get()).toBe(110);

			unsub();
		});
	});

	// -----------------------------------------------------------------------
	// Diamond resolution (tier 1 via dynamicDerived)
	// -----------------------------------------------------------------------

	describe("diamond resolution", () => {
		it("recomputes derived atom once in a diamond", () => {
			const a = atom(1);
			const b = atom((get) => get(a) * 2);
			const c = atom((get) => get(a) + 10);
			let dCount = 0;
			const d = atom((get) => {
				dCount++;
				return get(b) + get(c);
			});

			// Subscribe to activate push path
			const unsub = d.subscribe(() => {});
			dCount = 0;

			a.set(5);
			expect(d.get()).toBe(25); // (5*2) + (5+10)
			expect(dCount).toBe(1); // computed exactly once

			unsub();
		});
	});

	// -----------------------------------------------------------------------
	// P1: function values are treated as read functions
	// -----------------------------------------------------------------------

	describe("function handling", () => {
		it("function argument is treated as derived read", () => {
			const count = atom(3);
			const derived = atom((get) => get(count) * 2);
			// Should be a derived atom, not store a function
			expect(derived._kind).toBe("derived");
			expect(derived.get()).toBe(6);
		});
	});
});
