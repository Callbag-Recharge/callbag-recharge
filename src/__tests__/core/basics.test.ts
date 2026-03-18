import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { combine } from "../../extra/combine";
import { concat } from "../../extra/concat";
import { filter } from "../../extra/filter";
import { flat } from "../../extra/flat";
import { forEach } from "../../extra/forEach";
import { fromIter } from "../../extra/fromIter";
import { fromPromise } from "../../extra/fromPromise";
import { interval } from "../../extra/interval";
import { map } from "../../extra/map";
import { merge } from "../../extra/merge";
import { skip } from "../../extra/skip";
import { subscribe } from "../../extra/subscribe";
import { take } from "../../extra/take";
import { pipe, state } from "../../index";

// ---------------------------------------------------------------------------
// Tests adapted from callbag-basics (https://github.com/staltz/callbag-basics)
// ---------------------------------------------------------------------------

describe("callbag-basics compatibility", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	test("it works with observables (push-based)", () => {
		const expected = [1, 3, 5, 7, 9];
		const received: number[] = [];

		const result = pipe(
			interval(10),
			map((x) => (x !== undefined ? x + 1 : undefined)),
			filter((x) => x !== undefined && x % 2 !== 0),
			take<number>(5),
		);

		const unsub = forEach<number | undefined>((x) => {
			if (x !== undefined) received.push(x);
		})(result);

		vi.advanceTimersByTime(300);

		expect(received).toEqual(expected);
		unsub();
	});

	test("it works with iterables (synchronous)", () => {
		const expected = [10, 10.25, 10.5, 10.75, 11];
		const received: number[] = [];

		function* range(from: number, to: number) {
			let i = from;
			while (i <= to) {
				yield i;
				i++;
			}
		}

		const result = pipe(
			fromIter(range(40, 99)),
			take<number>(5),
			map((x) => (x !== undefined ? x / 4 : undefined)),
		);

		forEach<number | undefined>((x) => {
			if (x !== undefined) received.push(x);
		})(result);

		expect(received).toEqual(expected);
	});
});

// ---------------------------------------------------------------------------
// Extra operator tests
// ---------------------------------------------------------------------------

describe("take", () => {
	test("passes first n value changes then holds", () => {
		const s = state(0);
		const result = pipe(s, take<number>(3));
		const received: number[] = [];

		subscribe(result, (v) => {
			if (v !== undefined) received.push(v);
		});

		s.set(1);
		s.set(2);
		s.set(3);
		s.set(4);
		s.set(5);

		expect(received).toEqual([1, 2, 3]);
		expect(result.get()).toBe(3);
	});

	test("ignores duplicate values", () => {
		const s = state(0);
		const result = pipe(s, take<number>(3));
		const received: number[] = [];

		subscribe(result, (v) => {
			if (v !== undefined) received.push(v);
		});

		s.set(1);
		s.set(1); // duplicate
		s.set(2);
		s.set(2); // duplicate
		s.set(3);

		expect(received).toEqual([1, 2, 3]);
	});

	test("take(0) never passes values", () => {
		const s = state(0);
		const result = pipe(s, take<number>(0));
		const received: number[] = [];

		subscribe(result, (v) => {
			if (v !== undefined) received.push(v);
		});

		s.set(1);
		s.set(2);

		expect(received).toEqual([]);
	});
});

describe("skip", () => {
	test("skips first n value changes then passes through", () => {
		const s = state(0);
		const result = pipe(s, skip<number>(2));
		const received: number[] = [];

		subscribe(result, (v) => {
			if (v !== undefined) received.push(v);
		});

		s.set(1);
		s.set(2);
		s.set(3);
		s.set(4);

		expect(received).toEqual([3, 4]);
	});

	test("skip(0) passes all values", () => {
		const s = state(0);
		const result = pipe(s, skip<number>(0));
		const received: number[] = [];

		subscribe(result, (v) => {
			if (v !== undefined) received.push(v);
		});

		s.set(1);
		s.set(2);

		expect(received).toEqual([1, 2]);
	});
});

describe("merge", () => {
	test("emits latest value from whichever source changed", () => {
		const a = state(0);
		const b = state(0);
		const merged = merge<number>(a, b);
		const received: number[] = [];

		subscribe(merged, (v) => {
			if (v !== undefined) received.push(v);
		});

		a.set(1);
		b.set(2);
		a.set(3);

		expect(received).toEqual([1, 2, 3]);
	});
});

describe("combine", () => {
	test("produces tuple of all source values", () => {
		const a = state(1);
		const b = state("x");
		const combined = combine(a, b);

		expect(combined.get()).toEqual([1, "x"]);

		a.set(2);
		expect(combined.get()).toEqual([2, "x"]);

		b.set("y");
		expect(combined.get()).toEqual([2, "y"]);
	});

	test("notifies on any source change", () => {
		const a = state(1);
		const b = state(2);
		const combined = combine(a, b);
		const cb = vi.fn();

		subscribe(combined, cb);

		a.set(10);
		expect(cb).toHaveBeenCalledTimes(1);
		expect(cb.mock.calls[0][0]).toEqual([10, 2]);

		b.set(20);
		expect(cb).toHaveBeenCalledTimes(2);
		expect(cb.mock.calls[1][0]).toEqual([10, 20]);
	});
});

describe("fromPromise", () => {
	test("emits the resolved value", async () => {
		const p = Promise.resolve(42);
		const s = fromPromise(p);
		const received: number[] = [];

		subscribe(s, (v) => {
			if (v !== undefined) received.push(v);
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(received).toEqual([42]);
	});

	test("rejection does not crash", async () => {
		const s = fromPromise(Promise.reject(new Error("fail")));
		const received: unknown[] = [];

		subscribe(s, (v) => {
			received.push(v);
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(received).toEqual([]);
	});
});

describe("forEach", () => {
	test("fires for each value change", () => {
		const s = state(0);
		const received: number[] = [];

		const unsub = forEach<number>((x) => received.push(x))(s);

		s.set(1);
		s.set(2);
		s.set(3);

		expect(received).toEqual([1, 2, 3]);

		unsub();
		s.set(4);
		expect(received).toEqual([1, 2, 3]);
	});
});

describe("pipe integration", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	test("interval → map → filter → take → forEach", () => {
		const received: number[] = [];

		const result = pipe(
			interval(5),
			map((x) => (x !== undefined ? x * 10 : undefined)),
			filter((x) => x !== undefined && x >= 20),
			take<number>(3),
		);

		const unsub = forEach<number | undefined>((x) => {
			if (x !== undefined) received.push(x);
		})(result);

		vi.advanceTimersByTime(200);

		expect(received).toEqual([20, 30, 40]);
		unsub();
	});
});

// ---------------------------------------------------------------------------
// Completion protocol tests
// ---------------------------------------------------------------------------

describe("completion protocol", () => {
	test("fromIter signals completion to subscribers", () => {
		const s = fromIter([1, 2, 3]);
		const received: number[] = [];

		subscribe(s, (v) => {
			if (v !== undefined) received.push(v);
		});

		expect(received).toEqual([1, 2, 3]);
	});

	test("fromPromise signals completion after resolve", async () => {
		const s = fromPromise(Promise.resolve(42));
		const received: number[] = [];

		subscribe(s, (v) => {
			if (v !== undefined) received.push(v);
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(received).toEqual([42]);
	});

	test("completed source sends END to late subscribers", () => {
		const s = fromIter([1]);
		const received: number[] = [];

		// First subscriber triggers completion
		subscribe(s, () => {});

		// Late subscriber should get no values (source already completed)
		subscribe(s, (v) => {
			if (v !== undefined) received.push(v);
		});

		expect(received).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// concat tests
// ---------------------------------------------------------------------------

describe("concat", () => {
	test("emits values from sources sequentially", () => {
		const s = concat(fromIter([1, 2]), fromIter([3, 4]));
		const received: number[] = [];

		subscribe(s, (v) => {
			if (v !== undefined) received.push(v);
		});

		expect(received).toEqual([1, 2, 3, 4]);
	});

	test("waits for completion before moving to next source", () => {
		const _s1 = state(0);
		const s2 = fromIter([10, 20]);
		const s = concat(fromIter([1, 2]), s2);
		const received: number[] = [];

		subscribe(s, (v) => {
			if (v !== undefined) received.push(v);
		});

		// fromIter([1,2]) completes synchronously, then fromIter([10,20]) emits
		expect(received).toEqual([1, 2, 10, 20]);
	});

	test("handles empty iterables", () => {
		const s = concat(fromIter([]), fromIter([1, 2]));
		const received: number[] = [];

		subscribe(s, (v) => {
			if (v !== undefined) received.push(v);
		});

		expect(received).toEqual([1, 2]);
	});

	test("single source concat", () => {
		const s = concat(fromIter([1, 2, 3]));
		const received: number[] = [];

		subscribe(s, (v) => {
			if (v !== undefined) received.push(v);
		});

		expect(received).toEqual([1, 2, 3]);
	});
});

// ---------------------------------------------------------------------------
// flat tests
// ---------------------------------------------------------------------------

describe("flat", () => {
	test("subscribes to inner store from outer", () => {
		const inner = state(10);
		// v6: flat is purely reactive — start with undefined, then emit inner
		const outer = state<ReturnType<typeof state<number>> | undefined>(undefined);
		const result = pipe(outer, flat<number>());
		const received: number[] = [];

		subscribe(result, (v) => {
			if (v !== undefined) received.push(v);
		});

		// Trigger outer to emit inner store
		outer.set(inner);

		inner.set(20);
		inner.set(30);

		expect(received).toEqual([10, 20, 30]);
	});

	test("switches to new inner when outer changes", () => {
		const inner1 = state(1);
		const inner2 = state(100);
		// v6: flat is purely reactive — start with undefined, then emit inner1
		const outer = state<ReturnType<typeof state<number>> | undefined>(undefined);
		const result = pipe(outer, flat<number>());
		const received: number[] = [];

		subscribe(result, (v) => {
			if (v !== undefined) received.push(v);
		});

		// Trigger outer to emit inner1
		outer.set(inner1);

		inner1.set(2);
		// Switch to inner2
		outer.set(inner2);
		// inner1 updates should be ignored now
		inner1.set(3);
		inner2.set(200);

		expect(received).toEqual([1, 2, 100, 200]);
	});

	test("handles inner completion", () => {
		const inner = fromIter([1, 2, 3]);
		// v6: flat is purely reactive — start with undefined, then emit inner
		const outer = state<ReturnType<typeof fromIter<number>> | undefined>(undefined);
		const result = pipe(outer, flat<number>());
		const received: number[] = [];

		subscribe(result, (v) => {
			if (v !== undefined) received.push(v);
		});

		// Trigger outer to emit inner store
		outer.set(inner);

		// fromIter completes synchronously — values should arrive
		expect(received).toEqual([1, 2, 3]);
	});
});

// ---------------------------------------------------------------------------
// Edge case tests
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	test("fromIter with empty iterable", () => {
		const s = fromIter<number>([]);
		const received: number[] = [];

		subscribe(s, (v) => {
			if (v !== undefined) received.push(v);
		});

		expect(received).toEqual([]);
	});
});
