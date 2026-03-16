import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProducerStore, Store } from "../../core/types";
import {
	audit,
	bufferCount,
	empty,
	fromAsyncIter,
	fromIter,
	groupBy,
	map,
	never,
	of,
	race,
	reduce,
	subscribe,
	throwError,
	toArray,
	windowCount,
	window as windowOp,
	windowTime,
	withLatestFrom,
} from "../../extra";
import { derived, effect, pipe, producer, state } from "../../index";

// ---------------------------------------------------------------------------
// P0 — fromAsyncIter
// ---------------------------------------------------------------------------
describe("fromAsyncIter", () => {
	it("emits values from an async iterable", async () => {
		async function* gen() {
			yield 1;
			yield 2;
			yield 3;
		}
		const source = fromAsyncIter(gen());
		const values: number[] = [];
		const unsub = subscribe(source, (v) => {
			if (v !== undefined) values.push(v);
		});
		// Allow microtasks to flush
		await new Promise((r) => setTimeout(r, 50));
		unsub();
		expect(values).toEqual([1, 2, 3]);
	});

	it("completes when async iterable is exhausted", async () => {
		async function* gen() {
			yield 1;
		}
		const source = fromAsyncIter(gen());
		let completed = false;
		subscribe(source, () => {}, {
			onEnd: (err) => {
				if (err === undefined) completed = true;
			},
		});
		await new Promise((r) => setTimeout(r, 50));
		expect(completed).toBe(true);
	});

	it("forwards errors from async iterable", async () => {
		async function* gen() {
			yield 1;
			throw new Error("async fail");
		}
		const source = fromAsyncIter(gen());
		let receivedError: unknown;
		subscribe(source, () => {}, {
			onEnd: (err) => {
				receivedError = err;
			},
		});
		await new Promise((r) => setTimeout(r, 50));
		expect(receivedError).toBeInstanceOf(Error);
		expect((receivedError as Error).message).toBe("async fail");
	});

	it("supports factory form for retry/repeat", async () => {
		let callCount = 0;
		const factory = () => {
			callCount++;
			return (async function* () {
				yield callCount;
			})();
		};
		const source = fromAsyncIter(factory);
		const values: number[] = [];

		// First subscription
		let unsub = subscribe(source, (v) => {
			if (v !== undefined) values.push(v);
		});
		await new Promise((r) => setTimeout(r, 50));
		unsub();

		// Second subscription (factory re-invoked)
		unsub = subscribe(source, (v) => {
			if (v !== undefined) values.push(v);
		});
		await new Promise((r) => setTimeout(r, 50));
		unsub();

		expect(callCount).toBe(2);
		expect(values).toEqual([1, 2]);
	});

	it("cancels iteration on unsubscribe", async () => {
		let yielded = 0;
		let returnCalled = false;
		async function* gen() {
			try {
				while (true) {
					yielded++;
					yield yielded;
					await new Promise((r) => setTimeout(r, 10));
				}
			} finally {
				returnCalled = true;
			}
		}
		const source = fromAsyncIter(gen());
		const values: number[] = [];
		const unsub = subscribe(source, (v) => {
			if (v !== undefined) values.push(v);
		});
		await new Promise((r) => setTimeout(r, 35));
		unsub();
		await new Promise((r) => setTimeout(r, 20));
		expect(values.length).toBeGreaterThan(0);
		expect(values.length).toBeLessThan(10);
		expect(returnCalled).toBe(true);
	});

	it("get() returns last emitted value", async () => {
		async function* gen() {
			yield 10;
			yield 20;
		}
		const source = fromAsyncIter(gen());
		subscribe(source, () => {});
		await new Promise((r) => setTimeout(r, 50));
		expect(source.get()).toBe(20);
	});
});

// ---------------------------------------------------------------------------
// P1 — withLatestFrom
// ---------------------------------------------------------------------------
describe("withLatestFrom", () => {
	it("combines source value with latest from other stores", () => {
		const a = state(1);
		const b = state(10);
		const result = pipe(
			a,
			withLatestFrom(b, (av, bv) => av + bv),
		);
		const values: number[] = [];
		const unsub = subscribe(result, (v) => values.push(v));

		a.set(2);
		expect(values).toEqual([12]);

		b.set(20); // b change alone doesn't trigger
		expect(values).toEqual([12]);

		a.set(3); // a triggers, picks up b=20
		expect(values).toEqual([12, 23]);
		unsub();
	});

	it("get() returns current computed value", () => {
		const a = state(5);
		const b = state(100);
		const result = pipe(
			a,
			withLatestFrom(b, (av, bv) => av * bv),
		);
		expect(result.get()).toBe(500);
		b.set(200);
		a.set(6);
		expect(result.get()).toBe(1200);
	});

	it("forwards upstream errors", () => {
		const src = producer<number>(({ emit, error }) => {
			emit(1);
			error(new Error("up err"));
		});
		const b = state(10);
		const result = pipe(
			src,
			withLatestFrom(b, (a, bv) => a! + bv),
		);
		let receivedError: unknown;
		subscribe(result, () => {}, {
			onEnd: (err) => {
				receivedError = err;
			},
		});
		expect(receivedError).toBeInstanceOf(Error);
	});

	it("forwards upstream completion", () => {
		const src = producer<number>(({ emit, complete }) => {
			emit(1);
			complete();
		});
		const b = state(10);
		const result = pipe(
			src,
			withLatestFrom(b, (a, bv) => a! + bv),
		);
		let completed = false;
		subscribe(result, () => {}, {
			onEnd: (err) => {
				if (err === undefined) completed = true;
			},
		});
		expect(completed).toBe(true);
	});

	it("resolves diamonds correctly (no stale reads)", () => {
		// a → b (derived), a is source, b is "other"
		// When a changes, both a and b are dirty. withLatestFrom should
		// wait for both to settle before computing.
		const a = state(1);
		const b = derived([a], () => a.get() * 10);
		const result = pipe(
			a,
			withLatestFrom(b, (av, bv) => `${av}:${bv}`),
		);
		const values: string[] = [];
		const unsub = subscribe(result, (v) => values.push(v));

		a.set(2);
		// b should be 20 (not stale 10) when withLatestFrom computes
		expect(values).toEqual(["2:20"]);

		a.set(3);
		expect(values).toEqual(["2:20", "3:30"]);
		unsub();
	});

	it("does not emit when only secondary deps change", () => {
		const a = state(1);
		const b = state(10);
		const result = pipe(
			a,
			withLatestFrom(b, (av, bv) => av + bv),
		);
		const values: number[] = [];
		let effectCount = 0;
		const unsub = subscribe(result, (v) => {
			values.push(v);
			effectCount++;
		});

		b.set(20); // only secondary changed — should NOT emit
		b.set(30); // still only secondary
		expect(effectCount).toBe(0);

		a.set(2); // primary changed — should emit with latest b=30
		expect(values).toEqual([32]);
		expect(effectCount).toBe(1);
		unsub();
	});

	it("works with multiple other stores", () => {
		const a = state(1);
		const b = state(10);
		const c = state(100);
		const result = pipe(
			a,
			withLatestFrom(b, c, (av, bv, cv) => av + bv + cv),
		);
		const values: number[] = [];
		const unsub = subscribe(result, (v) => values.push(v));

		a.set(2);
		expect(values).toEqual([112]);

		b.set(20);
		c.set(200);
		a.set(3);
		expect(values).toEqual([112, 223]);
		unsub();
	});
});

// ---------------------------------------------------------------------------
// P1 — bufferCount
// ---------------------------------------------------------------------------
describe("bufferCount", () => {
	it("flushes buffer when count is reached (tumbling)", () => {
		const a = state(0);
		const buffered = pipe(a, bufferCount(3));
		const values: number[][] = [];
		const unsub = subscribe(buffered, (v) => values.push(v as number[]));

		a.set(1);
		a.set(2);
		a.set(3); // flush
		expect(values).toEqual([[1, 2, 3]]);

		a.set(4);
		a.set(5);
		a.set(6); // flush
		expect(values).toEqual([
			[1, 2, 3],
			[4, 5, 6],
		]);
		unsub();
	});

	it("flushes partial buffer on completion", () => {
		const src = producer<number>(({ emit, complete }) => {
			emit(1);
			emit(2);
			complete();
		});
		const buffered = pipe(src, bufferCount(5));
		const values: number[][] = [];
		let completed = false;
		subscribe(buffered, (v) => values.push(v as number[]), {
			onEnd: (err) => {
				if (err === undefined) completed = true;
			},
		});
		expect(values).toEqual([[1, 2]]);
		expect(completed).toBe(true);
	});

	it("forwards upstream errors (discards partial buffer)", () => {
		const src = producer<number>(({ emit, error }) => {
			emit(1);
			error(new Error("buf err"));
		});
		const buffered = pipe(src, bufferCount(5));
		let receivedError: unknown;
		subscribe(buffered, () => {}, {
			onEnd: (err) => {
				receivedError = err;
			},
		});
		expect(receivedError).toBeInstanceOf(Error);
	});

	it("sliding window with startEvery", () => {
		const a = state(0);
		const buffered = pipe(a, bufferCount(3, 1));
		const values: number[][] = [];
		const unsub = subscribe(buffered, (v) => values.push(v as number[]));

		a.set(1);
		a.set(2);
		a.set(3); // first window [1,2,3] flushes
		expect(values).toEqual([[1, 2, 3]]);

		a.set(4); // second window [2,3,4] flushes
		expect(values).toEqual([
			[1, 2, 3],
			[2, 3, 4],
		]);

		a.set(5); // third window [3,4,5] flushes
		expect(values).toEqual([
			[1, 2, 3],
			[2, 3, 4],
			[3, 4, 5],
		]);
		unsub();
	});

	it("sliding window flushes partial on completion", () => {
		const src = producer<number>(({ emit, complete }) => {
			emit(1);
			emit(2);
			emit(3);
			emit(4);
			complete();
		});
		const buffered = pipe(src, bufferCount(3, 2));
		const values: number[][] = [];
		let completed = false;
		subscribe(buffered, (v) => values.push(v as number[]), {
			onEnd: (err) => {
				if (err === undefined) completed = true;
			},
		});
		// Window starting at index 0: [1,2,3] -> flush
		// Window starting at index 2: [3,4] -> partial flush on complete
		expect(values).toEqual([
			[1, 2, 3],
			[3, 4],
		]);
		expect(completed).toBe(true);
	});

	it("get() returns last flushed array", () => {
		const a = state(0);
		const buffered = pipe(a, bufferCount(2));
		const unsub = subscribe(buffered, () => {}); // activate producer

		a.set(1);
		expect(buffered.get()).toEqual([]); // not yet flushed

		a.set(2);
		expect(buffered.get()).toEqual([1, 2]);
		unsub();
	});

	it("reconnect resets buffer state", () => {
		const a = state(0);
		const buffered = pipe(a, bufferCount(3));

		const values1: number[][] = [];
		const unsub1 = subscribe(buffered, (v) => values1.push(v as number[]));
		a.set(1);
		a.set(2);
		unsub1(); // partial buffer discarded

		const values2: number[][] = [];
		const unsub2 = subscribe(buffered, (v) => values2.push(v as number[]));
		a.set(3);
		a.set(4);
		a.set(5); // flush
		expect(values2).toEqual([[3, 4, 5]]);
		unsub2();
	});
});

// ---------------------------------------------------------------------------
// P2 — groupBy
// ---------------------------------------------------------------------------
describe("groupBy", () => {
	it("routes values into sub-stores by key", () => {
		const a = state<{ type: string; value: number }>({ type: "a", value: 0 });
		const grouped = pipe(
			a,
			groupBy((v) => v.type),
		);
		const maps: Map<string, Store<{ type: string; value: number }>>[] = [];
		const unsub = subscribe(grouped, (v) =>
			maps.push(v as Map<string, Store<{ type: string; value: number }>>),
		);

		a.set({ type: "a", value: 1 }); // new group "a"
		expect(maps.length).toBe(1);
		expect(maps[0].has("a")).toBe(true);
		expect(maps[0].get("a")!.get()).toEqual({ type: "a", value: 1 });

		a.set({ type: "b", value: 2 }); // new group "b"
		expect(maps.length).toBe(2);
		expect(maps[1].has("b")).toBe(true);

		a.set({ type: "a", value: 3 }); // existing group "a" — no new map emission
		expect(maps.length).toBe(2);
		expect(maps[1].get("a")!.get()).toEqual({ type: "a", value: 3 });
		unsub();
	});

	it("forwards upstream completion", () => {
		const src = producer<number>(({ emit, complete }) => {
			emit(1);
			emit(2);
			complete();
		});
		const grouped = pipe(
			src,
			groupBy((v) => (v! % 2 === 0 ? "even" : "odd")),
		);
		let completed = false;
		subscribe(grouped, () => {}, {
			onEnd: (err) => {
				if (err === undefined) completed = true;
			},
		});
		expect(completed).toBe(true);
	});

	it("forwards upstream errors", () => {
		const src = producer<number>(({ emit, error }) => {
			emit(1);
			error(new Error("group err"));
		});
		const grouped = pipe(
			src,
			groupBy((v) => v),
		);
		let receivedError: unknown;
		subscribe(grouped, () => {}, {
			onEnd: (err) => {
				receivedError = err;
			},
		});
		expect(receivedError).toBeInstanceOf(Error);
	});

	it("get() returns current map", () => {
		const a = state(0);
		const grouped = pipe(
			a,
			groupBy((v) => (v % 2 === 0 ? "even" : "odd")),
		);
		subscribe(grouped, () => {}); // activate

		a.set(1); // odd
		a.set(2); // even
		const m = grouped.get() as Map<string, Store<number>>;
		expect(m.has("odd")).toBe(true);
		expect(m.has("even")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// P2 — reduce
// ---------------------------------------------------------------------------
describe("reduce", () => {
	it("emits accumulated value on completion", () => {
		const src = producer<number>(({ emit, complete }) => {
			emit(1);
			emit(2);
			emit(3);
			complete();
		});
		const reduced = pipe(
			src,
			reduce((acc, v) => acc + v!, 0),
		);
		const values: number[] = [];
		let completed = false;
		subscribe(reduced, (v) => values.push(v), {
			onEnd: (err) => {
				if (err === undefined) completed = true;
			},
		});
		expect(values).toEqual([6]);
		expect(completed).toBe(true);
	});

	it("emits seed on empty completion", () => {
		const src = producer<number>(({ complete }) => {
			complete();
		});
		const reduced = pipe(
			src,
			reduce((acc, v) => acc + v!, 42),
		);
		const values: number[] = [];
		subscribe(reduced, (v) => values.push(v));
		expect(values).toEqual([42]);
	});

	it("forwards upstream error (no value emitted)", () => {
		const src = producer<number>(({ emit, error }) => {
			emit(1);
			error(new Error("reduce err"));
		});
		const reduced = pipe(
			src,
			reduce((acc, v) => acc + v!, 0),
		);
		const values: number[] = [];
		let receivedError: unknown;
		subscribe(reduced, (v) => values.push(v), {
			onEnd: (err) => {
				receivedError = err;
			},
		});
		expect(values).toEqual([]);
		expect(receivedError).toBeInstanceOf(Error);
	});

	it("get() returns seed before completion", () => {
		const a = state(0);
		const reduced = pipe(
			a,
			reduce((acc, v) => acc + v, 100),
		);
		expect(reduced.get()).toBe(100);
	});
});

// ---------------------------------------------------------------------------
// P2 — toArray
// ---------------------------------------------------------------------------
describe("toArray", () => {
	it("collects all values into an array on completion", () => {
		const src = producer<number>(({ emit, complete }) => {
			emit(1);
			emit(2);
			emit(3);
			complete();
		});
		const arr = pipe(src, toArray());
		const values: number[][] = [];
		let completed = false;
		subscribe(arr, (v) => values.push(v as number[]), {
			onEnd: (err) => {
				if (err === undefined) completed = true;
			},
		});
		expect(values).toEqual([[1, 2, 3]]);
		expect(completed).toBe(true);
	});

	it("emits empty array on empty completion", () => {
		const src = producer<number>(({ complete }) => {
			complete();
		});
		const arr = pipe(src, toArray());
		const values: number[][] = [];
		subscribe(arr, (v) => values.push(v as number[]));
		expect(values).toEqual([[]]);
	});

	it("forwards upstream error (no value emitted)", () => {
		const src = producer<number>(({ emit, error }) => {
			emit(1);
			error(new Error("arr err"));
		});
		const arr = pipe(src, toArray());
		const values: number[][] = [];
		let receivedError: unknown;
		subscribe(arr, (v) => values.push(v as number[]), {
			onEnd: (err) => {
				receivedError = err;
			},
		});
		expect(values).toEqual([]);
		expect(receivedError).toBeInstanceOf(Error);
	});

	it("result array is frozen", () => {
		const src = producer<number>(({ emit, complete }) => {
			emit(1);
			complete();
		});
		const arr = pipe(src, toArray());
		let result: number[] = [];
		subscribe(arr, (v) => {
			result = v as number[];
		});
		expect(Object.isFrozen(result)).toBe(true);
	});

	it("get() returns empty array before completion", () => {
		const a = state(0);
		const arr = pipe(a, toArray());
		expect(arr.get()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// P2 — race
// ---------------------------------------------------------------------------
describe("race", () => {
	it("emits from whichever source fires first", () => {
		const a = state<number>(0);
		const b = state<number>(0);
		// We need sources that don't emit synchronously at construction
		const raced = race(a, b);
		const values: number[] = [];
		const unsub = subscribe(raced, (v) => {
			if (v !== undefined) values.push(v);
		});

		a.set(1); // a wins
		expect(values).toEqual([1]);

		b.set(2); // b is ignored
		expect(values).toEqual([1]);

		a.set(3); // a continues
		expect(values).toEqual([1, 3]);
		unsub();
	});

	it("completes when winner completes", () => {
		const src1 = producer<number>(({ emit, complete }) => {
			emit(1);
			complete();
		});
		const src2 = state(0);
		const raced = race(src1, src2);
		let completed = false;
		subscribe(raced, () => {}, {
			onEnd: (err) => {
				if (err === undefined) completed = true;
			},
		});
		expect(completed).toBe(true);
	});

	it("completes when all sources complete without emitting", () => {
		const src1 = producer<number>(({ complete }) => {
			complete();
		});
		const src2 = producer<number>(({ complete }) => {
			complete();
		});
		const raced = race(src1, src2);
		let completed = false;
		subscribe(raced, () => {}, {
			onEnd: (err) => {
				if (err === undefined) completed = true;
			},
		});
		expect(completed).toBe(true);
	});

	it("forwards error from pre-winner source", () => {
		const src1 = producer<number>(({ error }) => {
			error(new Error("race err"));
		});
		const src2 = state(0);
		const raced = race(src1, src2);
		let receivedError: unknown;
		subscribe(raced, () => {}, {
			onEnd: (err) => {
				receivedError = err;
			},
		});
		expect(receivedError).toBeInstanceOf(Error);
	});

	it("empty race completes immediately", () => {
		const raced = race();
		let completed = false;
		subscribe(raced, () => {}, {
			onEnd: (err) => {
				if (err === undefined) completed = true;
			},
		});
		expect(completed).toBe(true);
	});

	it("unsubscribes losers when winner is determined", () => {
		const a = state(0);
		const b = state(0);
		const raced = race(a, b);
		const unsub = subscribe(raced, () => {});

		a.set(1); // a wins, b should be unsubscribed
		// No way to directly test b is unsubscribed, but verify b changes don't propagate
		const values: number[] = [];
		subscribe(raced, (v) => {
			if (v !== undefined) values.push(v);
		});
		b.set(99);
		expect(values.filter((v) => v === 99)).toEqual([]);
		unsub();
	});
});

// ---------------------------------------------------------------------------
// P3 — audit
// ---------------------------------------------------------------------------
describe("audit", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("emits latest value after timer fires (trailing edge)", () => {
		const a = state(0);
		const audited = pipe(a, audit(100));
		const values: number[] = [];
		const unsub = subscribe(audited, (v) => {
			if (v !== undefined) values.push(v);
		});

		a.set(1);
		a.set(2);
		a.set(3);
		expect(values).toEqual([]); // timer not yet fired

		vi.advanceTimersByTime(100);
		expect(values).toEqual([3]); // latest value

		// No new values → no new emission after next timer
		vi.advanceTimersByTime(100);
		expect(values).toEqual([3]);

		a.set(4); // starts new timer
		a.set(5);
		vi.advanceTimersByTime(100);
		expect(values).toEqual([3, 5]);
		unsub();
	});

	it("flushes pending value on upstream completion", () => {
		const src = producer<number>(({ emit, complete }) => {
			emit(1);
			emit(2);
			setTimeout(() => complete(), 50);
		});
		const audited = pipe(src, audit(200));
		const values: number[] = [];
		let completed = false;
		subscribe(
			audited,
			(v) => {
				if (v !== undefined) values.push(v);
			},
			{
				onEnd: (err) => {
					if (err === undefined) completed = true;
				},
			},
		);

		vi.advanceTimersByTime(50);
		expect(values).toEqual([2]); // flushed on completion
		expect(completed).toBe(true);
	});

	it("forwards upstream errors", () => {
		const src = producer<number>(({ emit, error }) => {
			emit(1);
			setTimeout(() => error(new Error("audit err")), 50);
		});
		const audited = pipe(src, audit(200));
		let receivedError: unknown;
		subscribe(audited, () => {}, {
			onEnd: (err) => {
				receivedError = err;
			},
		});

		vi.advanceTimersByTime(50);
		expect(receivedError).toBeInstanceOf(Error);
	});

	it("clears timer on teardown", () => {
		const a = state(0);
		const audited = pipe(a, audit(100));
		const values: number[] = [];
		const unsub = subscribe(audited, (v) => {
			if (v !== undefined) values.push(v);
		});

		a.set(1);
		unsub(); // teardown before timer fires
		vi.advanceTimersByTime(200);
		expect(values).toEqual([]); // nothing emitted after teardown
	});

	it("reconnect resets timer state", () => {
		const a = state(0);
		const audited = pipe(a, audit(100));

		const values1: number[] = [];
		const unsub1 = subscribe(audited, (v) => {
			if (v !== undefined) values1.push(v);
		});
		a.set(1);
		unsub1();
		vi.advanceTimersByTime(200);
		expect(values1).toEqual([]);

		// Fresh subscription
		const values2: number[] = [];
		const unsub2 = subscribe(audited, (v) => {
			if (v !== undefined) values2.push(v);
		});
		a.set(2);
		vi.advanceTimersByTime(100);
		expect(values2).toEqual([2]);
		unsub2();
	});
});

// ---------------------------------------------------------------------------
// P3 — window
// ---------------------------------------------------------------------------
describe("window (notifier)", () => {
	it("creates new window stores on notifier emission", () => {
		const a = state(0);
		const notifier = state(0);
		const windowed = pipe(a, windowOp(notifier));

		const windows: Store<number>[] = [];
		const unsub = subscribe(windowed, (w) => {
			if (w) windows.push(w as Store<number>);
		});

		// Initial window emitted at start
		expect(windows.length).toBe(1);
		a.set(1);
		a.set(2);
		expect(windows[0].get()).toBe(2);

		// Notifier triggers new window
		notifier.set(1);
		expect(windows.length).toBe(2);
		a.set(3);
		expect(windows[1].get()).toBe(3);
		unsub();
	});

	it("forwards upstream completion", () => {
		const src = producer<number>(({ emit, complete }) => {
			emit(1);
			complete();
		});
		const notifier = state(0);
		const windowed = pipe(src, windowOp(notifier));
		let completed = false;
		subscribe(windowed, () => {}, {
			onEnd: (err) => {
				if (err === undefined) completed = true;
			},
		});
		expect(completed).toBe(true);
	});

	it("forwards upstream error", () => {
		const src = producer<number>(({ error }) => {
			error(new Error("win err"));
		});
		const notifier = state(0);
		const windowed = pipe(src, windowOp(notifier));
		let receivedError: unknown;
		subscribe(windowed, () => {}, {
			onEnd: (err) => {
				receivedError = err;
			},
		});
		expect(receivedError).toBeInstanceOf(Error);
	});
});

// ---------------------------------------------------------------------------
// P3 — windowCount
// ---------------------------------------------------------------------------
describe("windowCount", () => {
	it("creates new window every N values", () => {
		const a = state(0);
		const windowed = pipe(a, windowCount(2));

		const windows: Store<number>[] = [];
		const unsub = subscribe(windowed, (w) => {
			if (w) windows.push(w as Store<number>);
		});

		expect(windows.length).toBe(1);
		a.set(1);
		a.set(2); // count reached, new window
		expect(windows.length).toBe(2);

		a.set(3);
		a.set(4); // count reached, new window
		expect(windows.length).toBe(3);
		expect(windows[2].get()).toBe(undefined); // new window, no value yet
		unsub();
	});

	it("forwards upstream completion", () => {
		const src = producer<number>(({ emit, complete }) => {
			emit(1);
			complete();
		});
		const windowed = pipe(src, windowCount(5));
		let completed = false;
		subscribe(windowed, () => {}, {
			onEnd: (err) => {
				if (err === undefined) completed = true;
			},
		});
		expect(completed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// P3 — windowTime
// ---------------------------------------------------------------------------
describe("windowTime", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("creates new window every ms milliseconds", () => {
		const a = state(0);
		const windowed = pipe(a, windowTime(100));

		const windows: Store<number>[] = [];
		const unsub = subscribe(windowed, (w) => {
			if (w) windows.push(w as Store<number>);
		});

		expect(windows.length).toBe(1);
		a.set(1);

		vi.advanceTimersByTime(100);
		expect(windows.length).toBe(2); // new time window

		a.set(2);
		expect(windows[1].get()).toBe(2);

		vi.advanceTimersByTime(100);
		expect(windows.length).toBe(3);
		unsub();
	});

	it("clears interval on teardown", () => {
		const a = state(0);
		const windowed = pipe(a, windowTime(100));

		const windows: Store<number>[] = [];
		const unsub = subscribe(windowed, (w) => {
			if (w) windows.push(w as Store<number>);
		});

		unsub();
		vi.advanceTimersByTime(500);
		// Should not create new windows after teardown
		expect(windows.length).toBe(1);
	});

	it("forwards upstream completion and clears interval", () => {
		const src = producer<number>(({ emit, complete }) => {
			emit(1);
			setTimeout(() => complete(), 50);
		});
		const windowed = pipe(src, windowTime(200));
		let completed = false;
		subscribe(windowed, () => {}, {
			onEnd: (err) => {
				if (err === undefined) completed = true;
			},
		});

		vi.advanceTimersByTime(50);
		expect(completed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Regression tests for code review fixes
// ---------------------------------------------------------------------------
describe("race — code review regressions", () => {
	// Bug: race subscribed via raw source(START, ...) bypassing deferStart,
	// giving earlier sources unfair advantage. Sources that emitted sync
	// during START leaked subscriptions for later sources.
	// Fixed: use beginDeferredStart/endDeferredStart + cleanup late-joining losers.

	it("does not leak subscriptions for sources subscribed after sync winner", () => {
		// Source that emits synchronously on subscribe
		const syncSource = producer<number>(({ emit }) => {
			emit(42);
		});
		const lazySource = state<number>(0);

		const raced = race(syncSource, lazySource);
		const values: number[] = [];
		const unsub = subscribe(raced, (v) => {
			if (v !== undefined) values.push(v);
		});

		// lazySource changes should NOT propagate (it lost the race)
		lazySource.set(99);
		expect(values.filter((v) => v === 99)).toEqual([]);
		unsub();
	});

	it("uses deferStart so all sources have equal chance", () => {
		// Both sources emit on subscribe — with deferStart batching, neither
		// has an unfair advantage based on array position
		const src1 = producer<number>(({ emit }) => {
			emit(1);
		});
		const src2 = producer<number>(({ emit }) => {
			emit(2);
		});

		const raced = race(src1, src2);
		const values: number[] = [];
		subscribe(raced, (v) => {
			if (v !== undefined) values.push(v);
		});
		// One of them should win — the important thing is no crash/leak
		expect(values.length).toBeGreaterThanOrEqual(1);
	});
});

describe("fromAsyncIter — code review regressions", () => {
	// Bug: iterator.return() returns a Promise that was never caught,
	// causing unhandled promise rejection if return() rejects.
	// Fixed: wrap in Promise.resolve(...).catch(() => {}).

	it("does not crash when iterator.return() rejects", async () => {
		let returnCalled = false;
		const iter: AsyncIterable<number> = {
			[Symbol.asyncIterator]() {
				return {
					async next() {
						await new Promise((r) => setTimeout(r, 10));
						return { value: 1, done: false };
					},
					return() {
						returnCalled = true;
						return Promise.reject(new Error("return failed"));
					},
				};
			},
		};
		const source = fromAsyncIter(iter);
		const unsub = subscribe(source, () => {});
		await new Promise((r) => setTimeout(r, 30));
		unsub(); // triggers teardown which calls return()
		await new Promise((r) => setTimeout(r, 30));

		// Verify return() was called and no crash occurred
		expect(returnCalled).toBe(true);
	});
});

describe("groupBy — code review regressions", () => {
	// Bug: keyFn throwing left the producer in limbo — started but dead subscription.
	// Fixed: wrap keyFn in try/catch and call error() on failure.

	it("forwards error when keyFn throws", () => {
		const a = state<number>(0);
		const grouped = pipe(
			a,
			groupBy((v) => {
				if (v === 42) throw new Error("bad key");
				return v;
			}),
		);
		let receivedError: unknown;
		const unsub = subscribe(grouped, () => {}, {
			onEnd: (err) => {
				receivedError = err;
			},
		});

		a.set(42); // triggers keyFn to throw
		expect(receivedError).toBeInstanceOf(Error);
		expect((receivedError as Error).message).toBe("bad key");
		unsub();
	});
});
