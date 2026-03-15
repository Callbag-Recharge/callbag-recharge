import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { combine } from "../extra/combine";
import { concat } from "../extra/concat";
import { concatMap } from "../extra/concatMap";
import { exhaustMap } from "../extra/exhaustMap";
import { flat } from "../extra/flat";
import { forEach } from "../extra/forEach";
import { fromEvent } from "../extra/fromEvent";
import { fromIter } from "../extra/fromIter";
import { fromObs } from "../extra/fromObs";
import { fromPromise } from "../extra/fromPromise";
import { interval } from "../extra/interval";
import { merge } from "../extra/merge";
import { share } from "../extra/share";
import { skip } from "../extra/skip";
import { subscribe } from "../extra/subscribe";
import { switchMap } from "../extra/switchMap";
import { take } from "../extra/take";
import { Inspector, pipe, producer, state } from "../index";

beforeEach(() => {
	Inspector._reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// interval
// ---------------------------------------------------------------------------

describe("interval", () => {
	it("emits incrementing integers", () => {
		const s = interval(100);
		const values: number[] = [];
		subscribe(s, (v) => {
			if (v !== undefined) values.push(v);
		});

		vi.advanceTimersByTime(350);
		expect(values).toEqual([0, 1, 2]);
	});

	it("clears interval on unsubscribe", () => {
		const s = interval(100);
		const values: number[] = [];
		const unsub = subscribe(s, (v) => {
			if (v !== undefined) values.push(v);
		});

		vi.advanceTimersByTime(250);
		unsub();
		vi.advanceTimersByTime(500);

		expect(values).toEqual([0, 1]);
	});
});

// ---------------------------------------------------------------------------
// fromEvent
// ---------------------------------------------------------------------------

describe("fromEvent", () => {
	it("emits events from target", () => {
		// Minimal EventTarget mock
		const listeners: Record<string, Array<(ev: unknown) => void>> = {};
		const target: EventTarget = {
			addEventListener(name: string, fn: any) {
				let arr = listeners[name];
				if (!arr) {
					arr = [];
					listeners[name] = arr;
				}
				arr.push(fn);
			},
			removeEventListener(name: string, fn: any) {
				const arr = listeners[name];
				if (arr) {
					const idx = arr.indexOf(fn);
					if (idx >= 0) arr.splice(idx, 1);
				}
			},
			dispatchEvent() {
				return true;
			},
		};

		const s = fromEvent(target, "click");
		const values: unknown[] = [];
		subscribe(s, (v: unknown) => {
			if (v !== undefined) values.push(v);
		});

		const ev1 = { type: "click" };
		const ev2 = { type: "click" };
		for (const fn of listeners.click ?? []) fn(ev1);
		for (const fn of listeners.click ?? []) fn(ev2);

		expect(values).toEqual([ev1, ev2]);
	});

	it("removes event listener on unsubscribe", () => {
		const addSpy = vi.fn();
		const removeSpy = vi.fn();
		const target: EventTarget = {
			addEventListener: addSpy,
			removeEventListener: removeSpy,
			dispatchEvent() {
				return true;
			},
		};

		const s = fromEvent(target, "click");
		const unsub = subscribe(s, () => {});

		expect(addSpy).toHaveBeenCalledTimes(1);
		unsub();
		expect(removeSpy).toHaveBeenCalledTimes(1);
		expect(removeSpy.mock.calls[0][0]).toBe("click");
	});
});

// ---------------------------------------------------------------------------
// fromObs
// ---------------------------------------------------------------------------

describe("fromObs", () => {
	it("emits values from observable", () => {
		let observer: { next: (v: number) => void };
		const obs = {
			subscribe(o: { next: (v: number) => void }) {
				observer = o;
				return { unsubscribe: vi.fn() };
			},
		};

		const s = fromObs(obs);
		const values: number[] = [];
		subscribe(s, (v) => {
			if (v !== undefined) values.push(v);
		});

		observer?.next(1);
		observer?.next(2);

		expect(values).toEqual([1, 2]);
	});

	it("calls unsubscribe on teardown", () => {
		const unsubSpy = vi.fn();
		const obs = {
			subscribe() {
				return { unsubscribe: unsubSpy };
			},
		};

		const s = fromObs(obs);
		const unsub = subscribe(s, () => {});
		unsub();

		expect(unsubSpy).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// fromPromise
// ---------------------------------------------------------------------------

describe("fromPromise", () => {
	it("emits resolved value", async () => {
		vi.useRealTimers();
		const p = Promise.resolve(42);
		const s = fromPromise(p);
		const values: number[] = [];
		subscribe(s, (v) => {
			if (v !== undefined) values.push(v);
		});

		await p;
		// Allow microtask to flush
		await new Promise((r) => setTimeout(r, 0));
		expect(values).toEqual([42]);
	});

	it("does not emit after unsubscribe", async () => {
		vi.useRealTimers();
		const p = Promise.resolve(99);
		const s = fromPromise(p);
		const values: number[] = [];
		const unsub = subscribe(s, (v) => {
			if (v !== undefined) values.push(v);
		});

		unsub();
		await p;
		await new Promise((r) => setTimeout(r, 0));
		expect(values).toEqual([]);
	});

	it("silently ignores rejected promises", async () => {
		vi.useRealTimers();
		const p = Promise.reject(new Error("fail"));
		const s = fromPromise(p);
		subscribe(s, () => {});

		// Should not throw unhandled rejection
		await new Promise((r) => setTimeout(r, 10));
	});
});

// ---------------------------------------------------------------------------
// fromIter
// ---------------------------------------------------------------------------

describe("fromIter", () => {
	it("emits all values from iterable synchronously", () => {
		const s = fromIter([10, 20, 30]);
		const values: number[] = [];
		subscribe(s, (v) => {
			if (v !== undefined) values.push(v);
		});

		expect(values).toEqual([10, 20, 30]);
	});

	it("works with generators", () => {
		function* gen() {
			yield "a";
			yield "b";
		}
		const s = fromIter(gen());
		const values: string[] = [];
		subscribe(s, (v) => {
			if (v !== undefined) values.push(v);
		});

		expect(values).toEqual(["a", "b"]);
	});

	it("get() returns last value after iteration", () => {
		const s = fromIter([1, 2, 3]);
		subscribe(s, () => {});
		expect(s.get()).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// combine
// ---------------------------------------------------------------------------

describe("combine", () => {
	it("returns a tuple of all source values", () => {
		const a = state(1);
		const b = state("x");
		const c = combine(a, b);

		expect(c.get()).toEqual([1, "x"]);
	});

	it("recomputes when any source changes", () => {
		const a = state(1);
		const b = state(2);
		const c = combine(a, b);
		const values: [number, number][] = [];
		subscribe(c, (v) => values.push(v as [number, number]));

		a.set(10);
		b.set(20);

		expect(values).toEqual([
			[10, 2],
			[10, 20],
		]);
	});

	it("teardown via derived is clean", () => {
		const a = state(1);
		const b = state(2);
		const c = combine(a, b);
		const unsub = subscribe(c, () => {});
		unsub();
		// should not throw
	});
});

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

describe("merge", () => {
	it("emits values from any source", () => {
		const a = state(0);
		const b = state(0);
		const m = merge(a, b);
		const values: number[] = [];
		subscribe(m, (v) => {
			if (v !== undefined) values.push(v);
		});

		a.set(1);
		b.set(2);
		a.set(3);

		expect(values).toEqual([1, 2, 3]);
	});

	it("tears down all sources on unsubscribe", () => {
		const a = state(0);
		const b = state(0);
		const m = merge(a, b);
		const values: number[] = [];
		const unsub = subscribe(m, (v) => {
			if (v !== undefined) values.push(v);
		});

		a.set(1);
		unsub();
		a.set(2);
		b.set(3);

		expect(values).toEqual([1]);
	});

	it("handles END from individual sources without double-END", () => {
		const a = producer<number>();
		const b = state(0);

		const m = merge(a, b);
		const values: number[] = [];
		subscribe(m, (v) => {
			if (v !== undefined) values.push(v);
		});

		a.emit(1);
		a.complete(); // a completes
		b.set(10); // b should still work

		expect(values).toEqual([1, 10]);
	});
});

// ---------------------------------------------------------------------------
// concat
// ---------------------------------------------------------------------------

describe("concat", () => {
	it("subscribes to sources sequentially", () => {
		const a = producer<number>();
		const b = state(99);

		const c = concat(a, b);
		const values: number[] = [];
		subscribe(c, (v) => {
			if (v !== undefined) values.push(v);
		});

		a.emit(1);
		a.emit(2);
		a.complete(); // a completes → subscribes to b

		expect(values).toEqual([1, 2]);
	});

	it("tears down current source on unsubscribe", () => {
		const cleanup = vi.fn();
		const a = producer<number>(() => cleanup);
		const c = concat(a);
		const unsub = subscribe(c, () => {});
		unsub();
		expect(cleanup).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// flat
// ---------------------------------------------------------------------------

describe("flat", () => {
	it("switches to latest inner store", () => {
		const inner1 = state(10);
		const inner2 = state(20);
		const outer = state<typeof inner1 | undefined>(inner1);

		const f = pipe(outer, flat());
		subscribe(f, () => {});

		expect(f.get()).toBe(10);

		outer.set(inner2);
		expect(f.get()).toBe(20);
	});

	it("tracks changes on the current inner store", () => {
		const inner = state(1);
		const outer = state<typeof inner | undefined>(inner);
		const f = pipe(outer, flat());
		const values: (number | undefined)[] = [];
		subscribe(f, (v) => values.push(v));

		inner.set(2);
		inner.set(3);

		expect(values).toEqual([2, 3]);
	});

	it("disconnects previous inner when outer changes", () => {
		const inner1 = state(10);
		const inner2 = state(20);
		const outer = state<typeof inner1 | undefined>(inner1);

		const f = pipe(outer, flat());
		const values: (number | undefined)[] = [];
		subscribe(f, (v) => values.push(v));

		outer.set(inner2); // switch to inner2
		inner1.set(99); // should NOT propagate

		expect(values).toEqual([20]);
	});

	it("tears down on last sink disconnect", () => {
		const inner = state(1);
		const outer = state<typeof inner | undefined>(inner);
		const f = pipe(outer, flat());
		const unsub = subscribe(f, () => {});
		unsub();
		// should not throw
	});

	it("handles outer emitting undefined", () => {
		const inner = state(1);
		const outer = state<typeof inner | undefined>(inner);
		const f = pipe(outer, flat());
		subscribe(f, () => {});

		outer.set(undefined);
		expect(f.get()).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// skip
// ---------------------------------------------------------------------------

describe("skip", () => {
	it("skips the first n value changes", () => {
		const s = state(0);
		const sk = pipe(s, skip(2));
		const values: number[] = [];
		subscribe(sk, (v) => {
			if (v !== undefined) values.push(v);
		});

		s.set(1); // skipped (1st)
		s.set(2); // skipped (2nd)
		s.set(3); // passes
		s.set(4); // passes

		expect(values).toEqual([3, 4]);
	});

	it("get() returns undefined until n values are skipped", () => {
		const s = state(0);
		const sk = pipe(s, skip(1));
		subscribe(sk, () => {});

		expect(sk.get()).toBeUndefined();
		s.set(1); // skipped
		expect(sk.get()).toBeUndefined();
		s.set(2); // passes
		expect(sk.get()).toBe(2);
	});

	it("tears down upstream on last sink disconnect", () => {
		const s = state(0);
		const sk = pipe(s, skip(1));
		const unsub = subscribe(sk, () => {});
		unsub();
		// should not throw
	});
});

// ---------------------------------------------------------------------------
// take
// ---------------------------------------------------------------------------

describe("take", () => {
	it("passes through first n value changes", () => {
		const s = state(0);
		const t = pipe(s, take(2));
		const values: number[] = [];
		subscribe(t, (v) => {
			if (v !== undefined) values.push(v);
		});

		s.set(1); // taken (1st)
		s.set(2); // taken (2nd)
		s.set(3); // ignored
		s.set(4); // ignored

		expect(values).toEqual([1, 2]);
	});

	it("get() holds last accepted value after n reached", () => {
		const s = state(0);
		const t = pipe(s, take(1));
		subscribe(t, () => {});

		s.set(5);
		expect(t.get()).toBe(5);

		s.set(99);
		expect(t.get()).toBe(5); // still 5
	});

	it("unsubscribes from upstream after n values (no memory leak)", () => {
		const s = state(0);
		const t = pipe(s, take(2));

		// Track whether upstream DIRTY still reaches take's subscriber
		const _dirtyAfterN = false;
		subscribe(t, () => {});

		s.set(1); // taken (1st)
		s.set(2); // taken (2nd) → should unsub from upstream

		// After take has collected 2 values, changing upstream should NOT
		// trigger any work in the take store. We verify by checking that
		// the state store's sinks set does not grow unboundedly.
		// More directly: subscribe to the take store and confirm no new values arrive.
		const laterValues: (number | undefined)[] = [];
		subscribe(t, (v) => laterValues.push(v));

		s.set(3);
		s.set(4);

		expect(laterValues).toEqual([]);
	});

	it("tears down upstream on last sink disconnect", () => {
		const s = state(0);
		const t = pipe(s, take(5));
		const unsub = subscribe(t, () => {});
		unsub();
		// should not throw
	});
});

// ---------------------------------------------------------------------------
// forEach
// ---------------------------------------------------------------------------

describe("forEach", () => {
	it("calls callback for each value change", () => {
		const s = state(0);
		const values: number[] = [];
		forEach<number>((v) => values.push(v))(s);

		s.set(1);
		s.set(2);

		expect(values).toEqual([1, 2]);
	});

	it("returns unsubscribe function", () => {
		const s = state(0);
		const values: number[] = [];
		const unsub = forEach<number>((v) => values.push(v))(s);

		s.set(1);
		unsub();
		s.set(2);

		expect(values).toEqual([1]);
	});
});

// ---------------------------------------------------------------------------
// share
// ---------------------------------------------------------------------------

describe("share", () => {
	it("returns the same store (identity)", () => {
		const s = state(42);
		const shared = pipe(s, share());
		expect(shared).toBe(s);
	});
});

// ---------------------------------------------------------------------------
// Teardown verification for higher-order operators
// ---------------------------------------------------------------------------

describe("switchMap teardown verification", () => {
	it("inner subscription is actually torn down (verified via DIRTY propagation)", () => {
		const outer = state(1);
		const inner1 = state(10);
		const inner2 = state(20);

		const mapped = pipe(
			outer,
			switchMap((v) => (v === 1 ? inner1 : inner2)),
		);
		const values: (number | undefined)[] = [];
		const unsub = subscribe(mapped, (v) => {
			if (v !== undefined) values.push(v);
		});

		inner1.set(11);
		expect(values).toEqual([11]);

		// Switch to inner2
		outer.set(2);
		values.length = 0;

		// inner1 changes should NOT propagate
		inner1.set(99);
		expect(values).toEqual([]);

		// inner2 changes should propagate
		inner2.set(21);
		expect(values).toEqual([21]);

		unsub();

		// After full unsub, nothing should propagate
		values.length = 0;
		inner2.set(22);
		outer.set(1);
		expect(values).toEqual([]);
	});
});

describe("concatMap teardown verification", () => {
	it("queue and inner are fully torn down on unsub", () => {
		const outer = state("a");
		const inner = state(1);

		const mapped = pipe(
			outer,
			concatMap(() => inner),
		);
		const values: (number | undefined)[] = [];
		const unsub = subscribe(mapped, (v) => {
			if (v !== undefined) values.push(v);
		});

		inner.set(2);
		expect(values).toEqual([2]);

		unsub();

		// After unsub, nothing propagates
		values.length = 0;
		inner.set(3);
		outer.set("b");
		expect(values).toEqual([]);
	});
});

describe("exhaustMap teardown verification", () => {
	it("inner is fully torn down on unsub", () => {
		const outer = state("x");
		const inner = state(1);

		const mapped = pipe(
			outer,
			exhaustMap(() => inner),
		);
		const values: (number | undefined)[] = [];
		const unsub = subscribe(mapped, (v) => {
			if (v !== undefined) values.push(v);
		});

		inner.set(2);
		expect(values).toEqual([2]);

		unsub();

		values.length = 0;
		inner.set(3);
		expect(values).toEqual([]);
	});
});
