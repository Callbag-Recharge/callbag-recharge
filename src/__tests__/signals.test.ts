// ---------------------------------------------------------------------------
// Tests mirroring TC39 Signals behavior
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscribe } from "../extra/subscribe";
import { derived, effect, Inspector, state } from "../index";

beforeEach(() => {
	Inspector._reset();
});

describe("State (like Signal.State)", () => {
	it("reads initial value via .get()", () => {
		const count = state(0);
		expect(count.get()).toBe(0);
	});

	it("updates with .set()", () => {
		const count = state(0);
		count.set(5);
		expect(count.get()).toBe(5);
	});

	it("updates with .update()", () => {
		const count = state(0);
		count.update((n) => n + 1);
		expect(count.get()).toBe(1);
	});

	it("skips update when value is identical (Object.is)", () => {
		const count = state(0);
		const cb = vi.fn();
		subscribe(count, cb);
		count.set(0);
		expect(cb).not.toHaveBeenCalled();
	});

	it("handles NaN correctly", () => {
		const n = state(NaN);
		const cb = vi.fn();
		subscribe(n, cb);
		n.set(NaN); // Object.is(NaN, NaN) is true
		expect(cb).not.toHaveBeenCalled();
	});

	it("distinguishes +0 and -0", () => {
		const n = state(0);
		const cb = vi.fn();
		subscribe(n, cb);
		n.set(-0); // Object.is(0, -0) is false
		expect(cb).toHaveBeenCalledTimes(1);
	});
});

describe("Derived (like Signal.Computed)", () => {
	it("computes from a state store", () => {
		const count = state(3);
		const doubled = derived([count], () => count.get() * 2);
		expect(doubled.get()).toBe(6);
	});

	it("recomputes when dependency changes", () => {
		const count = state(1);
		const doubled = derived([count], () => count.get() * 2);
		expect(doubled.get()).toBe(2);
		count.set(5);
		expect(doubled.get()).toBe(10);
	});

	it("tracks multiple dependencies", () => {
		const a = state(2);
		const b = state(3);
		const sum = derived([a, b], () => a.get() + b.get());
		expect(sum.get()).toBe(5);
		a.set(10);
		expect(sum.get()).toBe(13);
		b.set(7);
		expect(sum.get()).toBe(17);
	});

	it("chains derived stores", () => {
		const count = state(2);
		const doubled = derived([count], () => count.get() * 2);
		const quadrupled = derived([doubled], () => doubled.get() * 2);
		expect(quadrupled.get()).toBe(8);
		count.set(3);
		expect(quadrupled.get()).toBe(12);
	});

	it("is lazy — does not compute until .get() is called", () => {
		const count = state(0);
		const computeFn = vi.fn(() => count.get() * 2);
		const doubled = derived([count], computeFn);

		// Should NOT have computed yet — nobody called .get()
		expect(computeFn).toHaveBeenCalledTimes(0);

		doubled.get();
		expect(computeFn).toHaveBeenCalledTimes(1);
	});

	it("always recomputes on .get() (no cache)", () => {
		const count = state(0);
		const computeFn = vi.fn(() => count.get() * 2);
		const doubled = derived([count], computeFn);

		doubled.get();
		doubled.get();
		doubled.get();
		// No cache — runs fn every time
		expect(computeFn).toHaveBeenCalledTimes(3);
	});

	it("handles conditional dependencies (all deps listed upfront)", () => {
		const toggle = state(true);
		const a = state(1);
		const b = state(2);
		const result = derived([toggle, a, b], () => (toggle.get() ? a.get() : b.get()));

		expect(result.get()).toBe(1);

		b.set(20);
		// b is always subscribed now, but fn returns a.get() when toggle is true
		expect(result.get()).toBe(1);

		toggle.set(false);
		expect(result.get()).toBe(20); // now reads b

		a.set(100);
		// a is always subscribed, but fn returns b.get() when toggle is false
		expect(result.get()).toBe(20);
	});
});

describe("Diamond problem (glitch-free)", () => {
	it("derived D depending on B and C (both from A) computes once per pull", () => {
		const a = state(1);
		const b = derived([a], () => a.get() + 1);
		const c = derived([a], () => a.get() * 2);
		const computeD = vi.fn(() => b.get() + c.get());
		const d = derived([b, c], computeD);

		expect(d.get()).toBe(4); // b=2, c=2 → 4
		computeD.mockClear();

		a.set(2);
		expect(d.get()).toBe(7); // b=3, c=4 → 7
		expect(computeD).toHaveBeenCalledTimes(1);
	});

	it("never sees inconsistent intermediate state", () => {
		const a = state(1);
		const b = derived([a], () => a.get() + 1);
		const c = derived([a], () => a.get() * 2);
		const snapshots: Array<{ b: number; c: number }> = [];

		const d = derived([b, c], () => {
			const bv = b.get();
			const cv = c.get();
			snapshots.push({ b: bv, c: cv });
			return bv + cv;
		});

		d.get(); // initial
		snapshots.length = 0;

		a.set(2);
		d.get();

		expect(snapshots).toEqual([{ b: 3, c: 4 }]);
	});

	it("deep diamond: A → B → D, A → C → D, D → E", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([a], () => a.get() * 3);
		const d = derived([b, c], () => b.get() + c.get());
		const computeE = vi.fn(() => d.get() * 10);
		const e = derived([d], computeE);

		expect(e.get()).toBe(50); // (2+3)*10
		computeE.mockClear();

		a.set(2);
		expect(e.get()).toBe(100); // (4+6)*10
		expect(computeE).toHaveBeenCalledTimes(1);
	});

	it("effect on diamond runs once per source change", () => {
		const a = state(1);
		const b = derived([a], () => a.get() + 1);
		const c = derived([a], () => a.get() * 2);
		const runs: number[] = [];

		effect([b, c], () => {
			runs.push(b.get() + c.get());
		});

		expect(runs).toEqual([4]); // initial: b=2, c=2

		a.set(2);
		expect(runs).toEqual([4, 7]); // b=3, c=4 → 7, runs ONCE
	});
});

describe("Effect (like Signal effect/watcher)", () => {
	it("runs immediately on creation", () => {
		const count = state(0);
		const log: number[] = [];
		effect([count], () => {
			log.push(count.get());
		});
		expect(log).toEqual([0]);
	});

	it("re-runs when dependency changes", () => {
		const count = state(0);
		const log: number[] = [];
		effect([count], () => {
			log.push(count.get());
		});
		count.set(1);
		count.set(2);
		expect(log).toEqual([0, 1, 2]);
	});

	it("cleanup function runs before re-execution", () => {
		const count = state(0);
		const cleanups: number[] = [];

		effect([count], () => {
			const val = count.get();
			return () => cleanups.push(val);
		});

		count.set(1);
		expect(cleanups).toEqual([0]);
		count.set(2);
		expect(cleanups).toEqual([0, 1]);
	});

	it("dispose stops the effect", () => {
		const count = state(0);
		const log: number[] = [];

		const dispose = effect([count], () => {
			log.push(count.get());
		});

		count.set(1);
		dispose();
		count.set(2);
		expect(log).toEqual([0, 1]);
	});
});

describe("Subscribe", () => {
	it("fires callback on value change", () => {
		const count = state(0);
		const values: number[] = [];
		subscribe(count, (v) => values.push(v));
		count.set(1);
		count.set(2);
		expect(values).toEqual([1, 2]);
	});

	it("does not fire on initial subscription", () => {
		const count = state(42);
		const cb = vi.fn();
		subscribe(count, cb);
		expect(cb).not.toHaveBeenCalled();
	});

	it("unsubscribe stops notifications", () => {
		const count = state(0);
		const values: number[] = [];
		const unsub = subscribe(count, (v) => values.push(v));
		count.set(1);
		unsub();
		count.set(2);
		expect(values).toEqual([1]);
	});

	it("provides previous value", () => {
		const count = state(0);
		const changes: Array<{ value: number; prev: number | undefined }> = [];
		subscribe(count, (value, prev) => changes.push({ value, prev }));
		count.set(10);
		count.set(20);
		expect(changes).toEqual([
			{ value: 10, prev: 0 },
			{ value: 20, prev: 10 },
		]);
	});

	it("subscribe to derived store", () => {
		const count = state(0);
		const doubled = derived([count], () => count.get() * 2);
		const values: number[] = [];
		subscribe(doubled, (v) => values.push(v));
		count.set(1);
		count.set(2);
		expect(values).toEqual([2, 4]);
	});
});
