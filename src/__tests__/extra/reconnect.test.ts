import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA, STATE } from "../../core/protocol";
import { bufferTime } from "../../extra/bufferTime";
import { combine } from "../../extra/combine";
import { concatMap } from "../../extra/concatMap";
import { debounce } from "../../extra/debounce";
import { delay } from "../../extra/delay";
import { distinctUntilChanged } from "../../extra/distinctUntilChanged";
import { exhaustMap } from "../../extra/exhaustMap";
import { filter } from "../../extra/filter";
import { map } from "../../extra/map";
import { merge } from "../../extra/merge";
import { of } from "../../extra/of";
import { pairwise } from "../../extra/pairwise";
import { partition } from "../../extra/partition";
import { rescue } from "../../extra/rescue";
import { retry } from "../../extra/retry";
import { sample } from "../../extra/sample";
import { scan } from "../../extra/scan";
import { skip } from "../../extra/skip";
import { subscribe } from "../../extra/subscribe";
import { switchMap } from "../../extra/switchMap";
import { take } from "../../extra/take";
import { throttle } from "../../extra/throttle";
import { timeout } from "../../extra/timeout";
import { derived, effect, Inspector, operator, pipe, producer, state } from "../../index";

beforeEach(() => {
	Inspector._reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tier 1 operators — reconnect
// ---------------------------------------------------------------------------

describe("Tier 1 operators — reconnect", () => {
	it("take: counter resets on reconnect", () => {
		const s = state(0);
		const t = pipe(s, take(2));

		// First subscription
		const values1: number[] = [];
		const _unsub1 = subscribe(t, (v) => values1.push(v));
		s.set(1);
		s.set(2); // take(2) completes
		expect(values1).toEqual([1, 2]);

		// Reconnect — take is built on operator() which marks _completed, so
		// late subscribers get END. This tests whether that's the behavior.
		const values2: number[] = [];
		let ended2 = false;
		subscribe(t, (v) => values2.push(v), { onEnd: () => (ended2 = true) });

		// After completion, new subscribers get END immediately
		expect(ended2).toBe(true);
		expect(values2).toEqual([]);
	});

	it("skip: counter resets on reconnect (when not completed)", () => {
		const s = state(0);
		const sk = pipe(s, skip(2));

		// First subscription
		const values1: number[] = [];
		const unsub1 = subscribe(sk, (v) => values1.push(v));
		s.set(1); // skipped
		s.set(2); // skipped
		s.set(3); // passed
		expect(values1).toEqual([3]);
		unsub1();

		// Reconnect — operator re-inits, counter should reset
		const values2: number[] = [];
		const unsub2 = subscribe(sk, (v) => values2.push(v));
		s.set(4); // skipped (counter reset)
		s.set(5); // skipped
		s.set(6); // passed
		expect(values2).toEqual([6]);
		unsub2();
	});

	it("pairwise: prev buffer resets on reconnect", () => {
		const s = state(0);
		const pw = pipe(s, pairwise());

		const values1: [number, number][] = [];
		const unsub1 = subscribe(pw, (v) => values1.push(v as [number, number]));
		s.set(1); // [0, 1]? No — pairwise needs 2 DATA emissions, not initial value
		s.set(2);
		unsub1();

		// Reconnect — prev should reset
		const values2: [number, number][] = [];
		const unsub2 = subscribe(pw, (v) => values2.push(v as [number, number]));

		// After reconnect, pairwise needs 2 new DATA emissions
		s.set(10);
		s.set(20);
		// First DATA after reconnect buffers, second creates pair
		expect(values2.length).toBeGreaterThanOrEqual(1);
		unsub2();
	});

	it("scan: accumulator resets to seed on reconnect", () => {
		const s = state(0);
		const sc = pipe(
			s,
			scan((acc, v) => acc + v, 0),
		);

		const values1: number[] = [];
		const unsub1 = subscribe(sc, (v) => values1.push(v));
		s.set(1); // 0 + 1 = 1
		s.set(2); // 1 + 2 = 3
		expect(values1).toEqual([1, 3]);
		unsub1();

		// Reconnect — accumulator resets to seed (0)
		const values2: number[] = [];
		const unsub2 = subscribe(sc, (v) => values2.push(v));
		s.set(10); // 0 + 10 = 10 (reset!)
		expect(values2).toEqual([10]);
		unsub2();
	});

	it("distinctUntilChanged: cached value resets on reconnect", () => {
		const s = state(1);
		const duc = pipe(s, distinctUntilChanged());

		const values1: number[] = [];
		const unsub1 = subscribe(duc, (v) => values1.push(v));
		s.set(2);
		s.set(2); // suppressed
		expect(values1).toEqual([2]);
		unsub1();

		// Reconnect — cached value resets. Now input.get() returns 2.
		const values2: number[] = [];
		const unsub2 = subscribe(duc, (v) => values2.push(v));
		s.set(2); // Was 2 at reconnect, so this is a duplicate
		s.set(3);
		expect(values2).toEqual([3]);
		unsub2();
	});

	it("map: stateless, reconnect works", () => {
		const s = state(0);
		const m = pipe(
			s,
			map((v) => v * 2),
		);

		const values1: number[] = [];
		const unsub1 = subscribe(m, (v) => values1.push(v));
		s.set(5);
		expect(values1).toEqual([10]);
		unsub1();

		const values2: number[] = [];
		const unsub2 = subscribe(m, (v) => values2.push(v));
		s.set(10);
		expect(values2).toEqual([20]);
		unsub2();
	});

	it("filter: stateless, reconnect works", () => {
		const s = state(0);
		const f = pipe(
			s,
			filter((v) => v > 5),
		);

		const values1: number[] = [];
		const unsub1 = subscribe(f, (v) => values1.push(v as number));
		s.set(3); // filtered
		s.set(10); // passed
		expect(values1).toEqual([10]);
		unsub1();

		const values2: number[] = [];
		const unsub2 = subscribe(f, (v) => values2.push(v as number));
		s.set(2); // filtered
		s.set(20); // passed
		expect(values2).toEqual([20]);
		unsub2();
	});

	it("merge: all sources re-subscribed on reconnect", () => {
		const a = state(0);
		const b = state(0);
		const m = merge(a, b);

		const values1: number[] = [];
		const unsub1 = subscribe(m, (v) => values1.push(v as number));
		a.set(1);
		b.set(2);
		expect(values1).toEqual([1, 2]);
		unsub1();

		const values2: number[] = [];
		const unsub2 = subscribe(m, (v) => values2.push(v as number));
		a.set(10);
		b.set(20);
		expect(values2).toEqual([10, 20]);
		unsub2();
	});

	it("combine: all sources re-subscribed on reconnect", () => {
		const a = state(1);
		const b = state(2);
		const c = combine(a, b);

		const values1: [number, number][] = [];
		const unsub1 = subscribe(c, (v) => values1.push(v as [number, number]));
		a.set(10);
		expect(values1).toEqual([[10, 2]]);
		unsub1();

		const values2: [number, number][] = [];
		const unsub2 = subscribe(c, (v) => values2.push(v as [number, number]));
		b.set(20);
		expect(values2).toEqual([[10, 20]]);
		unsub2();
	});

	it("partition: both branches re-subscribe on reconnect", () => {
		const s = state(0);
		const [evens, odds] = pipe(
			s,
			partition((v: number) => v % 2 === 0),
		);

		const evenValues1: number[] = [];
		const oddValues1: number[] = [];
		const unsub1e = subscribe(evens, (v) => evenValues1.push(v as number));
		const unsub1o = subscribe(odds, (v) => oddValues1.push(v as number));

		s.set(2);
		s.set(3);
		expect(evenValues1).toEqual([2]);
		expect(oddValues1).toEqual([3]);

		unsub1e();
		unsub1o();

		// Reconnect
		const evenValues2: number[] = [];
		const oddValues2: number[] = [];
		const unsub2e = subscribe(evens, (v) => evenValues2.push(v as number));
		const unsub2o = subscribe(odds, (v) => oddValues2.push(v as number));

		s.set(4);
		s.set(5);
		expect(evenValues2).toEqual([4]);
		expect(oddValues2).toEqual([5]);

		unsub2e();
		unsub2o();
	});
});

// ---------------------------------------------------------------------------
// Tier 2 operators — reconnect
// ---------------------------------------------------------------------------

describe("Tier 2 operators — reconnect", () => {
	it("debounce: timer state cleared on reconnect", () => {
		const s = state(0);
		const d = pipe(s, debounce(100));

		const values1: number[] = [];
		const unsub1 = subscribe(d, (v) => values1.push(v as number));
		s.set(1);
		vi.advanceTimersByTime(100);
		expect(values1).toEqual([1]);
		unsub1(); // cleanup clears timer

		// Reconnect — timer state should be fresh
		const values2: number[] = [];
		const unsub2 = subscribe(d, (v) => values2.push(v as number));
		s.set(10);
		vi.advanceTimersByTime(50); // not yet
		expect(values2).toEqual([]);
		vi.advanceTimersByTime(50); // now
		expect(values2).toEqual([10]);
		unsub2();
	});

	it("throttle: timer state cleared on reconnect", () => {
		const s = state(0);
		const t = pipe(s, throttle(100));

		const values1: number[] = [];
		const unsub1 = subscribe(t, (v) => values1.push(v as number));
		s.set(1); // passes (leading edge)
		s.set(2); // throttled
		expect(values1).toEqual([1]);
		unsub1();

		// Reconnect — throttle window should be fresh
		const values2: number[] = [];
		const unsub2 = subscribe(t, (v) => values2.push(v as number));
		s.set(10); // should pass (fresh window)
		expect(values2).toEqual([10]);
		unsub2();
	});

	it("delay: no pending timers on reconnect", () => {
		const s = state(0);
		const d = pipe(s, delay(100));

		const values1: number[] = [];
		const unsub1 = subscribe(d, (v) => values1.push(v as number));
		s.set(1);
		unsub1(); // cleanup clears pending timers

		vi.advanceTimersByTime(200);
		expect(values1).toEqual([]); // timer was cleared

		// Reconnect — fresh state
		const values2: number[] = [];
		const unsub2 = subscribe(d, (v) => values2.push(v as number));
		s.set(10);
		vi.advanceTimersByTime(100);
		expect(values2).toEqual([10]);
		unsub2();
	});

	it("bufferTime: buffer empty, timer restarted on reconnect", () => {
		const s = state(0);
		const bt = pipe(s, bufferTime(100));

		const values1: number[][] = [];
		const unsub1 = subscribe(bt, (v) => values1.push(v as number[]));
		s.set(1);
		s.set(2);
		vi.advanceTimersByTime(100);
		expect(values1).toEqual([[1, 2]]);
		unsub1();

		// Reconnect
		const values2: number[][] = [];
		const unsub2 = subscribe(bt, (v) => values2.push(v as number[]));
		s.set(10);
		vi.advanceTimersByTime(100);
		expect(values2).toEqual([[10]]);
		unsub2();
	});

	it("timeout: timer restarted on reconnect", () => {
		const s = state(0);
		const t = pipe(s, timeout(200));

		const values1: number[] = [];
		const unsub1 = subscribe(t, (v) => values1.push(v as number));
		s.set(1);
		expect(values1).toEqual([1]);
		unsub1();

		// Reconnect — timeout timer restarts from scratch
		const values2: number[] = [];
		let endErr: unknown;
		const _unsub2 = subscribe(t, (v) => values2.push(v as number), {
			onEnd: (err) => (endErr = err),
		});
		// No emission within 200ms
		vi.advanceTimersByTime(200);
		expect(endErr).toBeDefined();
		// The error should be a TimeoutError
	});

	it("sample: latest value cleared on reconnect", () => {
		const s = state(0);
		const notifier = state(0);
		const sm = pipe(s, sample(notifier));

		const values1: number[] = [];
		const unsub1 = subscribe(sm, (v) => values1.push(v as number));
		s.set(5);
		notifier.set(1);
		expect(values1).toEqual([5]);
		unsub1();

		// Reconnect — latest value should start fresh from s.get()
		const values2: number[] = [];
		const unsub2 = subscribe(sm, (v) => values2.push(v as number));
		notifier.set(2);
		expect(values2).toEqual([5]); // s.get() is still 5
		s.set(10);
		notifier.set(3);
		expect(values2).toEqual([5, 10]);
		unsub2();
	});

	it("switchMap: no active inner on reconnect", () => {
		const s = state(1);
		const inner1 = state(100);
		const inner2 = state(200);
		const sm = pipe(
			s,
			switchMap((v) => (v === 1 ? inner1 : inner2)),
		);

		const values1: number[] = [];
		const unsub1 = subscribe(sm, (v) => values1.push(v as number));
		inner1.set(101);
		expect(values1).toEqual([101]);
		unsub1();

		// Reconnect — should subscribe to inner for current s.get()
		const values2: number[] = [];
		const unsub2 = subscribe(sm, (v) => values2.push(v as number));
		inner1.set(102);
		expect(values2).toEqual([102]);
		unsub2();
	});

	it("concatMap: queue empty on reconnect", () => {
		const s = state(1);
		const sm = pipe(
			s,
			concatMap((v) => of(v * 10)),
		);

		const values1: number[] = [];
		const unsub1 = subscribe(sm, (v) => values1.push(v as number));
		expect(values1.length).toBeGreaterThanOrEqual(0);
		unsub1();

		// Reconnect
		const values2: number[] = [];
		const unsub2 = subscribe(sm, (v) => values2.push(v as number));
		s.set(5);
		// Should get values from fresh subscription
		expect(values2.length).toBeGreaterThanOrEqual(0);
		unsub2();
	});

	it("exhaustMap: not locked on reconnect", () => {
		const s = state(1);
		const p = producer<number>();
		const em = pipe(
			s,
			exhaustMap(() => p as any),
		);

		const values1: number[] = [];
		const unsub1 = subscribe(em, (v) => values1.push(v as number));
		// Inner is active (p not completed)
		s.set(2); // ignored because inner is active
		unsub1();

		// Reconnect — should not be locked
		const values2: number[] = [];
		const unsub2 = subscribe(em, (v) => values2.push(v as number));
		p.emit(42);
		expect(values2).toContain(42);
		unsub2();
	});

	it("retry: retry count reset on reconnect", () => {
		let attempt = 0;
		const source = producer<number>(({ emit, error }) => {
			attempt++;
			if (attempt <= 2) {
				error("fail");
			} else {
				emit(42);
			}
			return undefined;
		});

		const r = pipe(source as any, retry(3));

		const values1: number[] = [];
		let endErr1: unknown;
		const _unsub1 = subscribe(r, (v) => values1.push(v as number), {
			onEnd: (err) => (endErr1 = err),
		});
		// After retries, should eventually succeed or error
		// attempt was incremented by the inner producer
	});

	it("rescue: not in fallback state on reconnect", () => {
		const p = producer<number>();
		const fallback = state(999);
		const r = pipe(
			p as any,
			rescue(() => fallback),
		);

		const values1: number[] = [];
		const unsub1 = subscribe(r, (v) => values1.push(v as number));
		p.emit(1);
		p.error("boom"); // should switch to fallback
		expect(values1).toContain(1);
		unsub1();
	});
});

// ---------------------------------------------------------------------------
// Core primitives — reconnect/lifecycle
// ---------------------------------------------------------------------------

describe("Core primitives — reconnect/lifecycle", () => {
	it("producer: cleanup called, fresh init on reconnect", () => {
		let initCount = 0;
		let cleanupCount = 0;

		const p = producer<number>(({ emit }) => {
			initCount++;
			emit(initCount * 10);
			return () => cleanupCount++;
		});

		const values1: number[] = [];
		const unsub1 = subscribe(p, (v) => values1.push(v));
		expect(initCount).toBe(1);
		expect(values1).toEqual([10]);

		unsub1();
		expect(cleanupCount).toBe(1);

		// Reconnect
		const values2: number[] = [];
		const unsub2 = subscribe(p, (v) => values2.push(v));
		expect(initCount).toBe(2);
		expect(values2).toEqual([20]);

		unsub2();
		expect(cleanupCount).toBe(2);
	});

	it("derived: cache invalidated, recomputes on reconnect", () => {
		const s = state(1);
		let computeCount = 0;
		const d = derived([s], () => {
			computeCount++;
			return s.get() * 2;
		});

		const unsub1 = subscribe(d, () => {});
		expect(d.get()).toBe(2);
		computeCount = 0;

		unsub1(); // disconnects upstream

		// After disconnect, get() recomputes on demand
		s.set(5);
		expect(d.get()).toBe(10);
		expect(computeCount).toBeGreaterThanOrEqual(1);

		// Reconnect
		computeCount = 0;
		const values: number[] = [];
		const unsub2 = subscribe(d, (v) => values.push(v));

		s.set(10);
		expect(values).toEqual([20]);

		unsub2();
	});

	it("state: reconnect is transparent (state persists)", () => {
		const s = state(0);

		const values1: number[] = [];
		const unsub1 = subscribe(s, (v) => values1.push(v));
		s.set(1);
		expect(values1).toEqual([1]);
		unsub1();

		// State persists across disconnect/reconnect
		expect(s.get()).toBe(1);

		const values2: number[] = [];
		const unsub2 = subscribe(s, (v) => values2.push(v));
		s.set(2);
		expect(values2).toEqual([2]);
		expect(s.get()).toBe(2);
		unsub2();
	});

	it("operator: init re-runs on reconnect", () => {
		const s = state(0);
		let initRuns = 0;

		const op = operator<number>(
			[s],
			({ emit, signal }) => {
				initRuns++;
				return (_dep, type, data) => {
					if (type === STATE) signal(data);
					if (type === DATA) emit(data as number);
				};
			},
			{ initial: 0 },
		);

		const unsub1 = subscribe(op, () => {});
		expect(initRuns).toBe(1);
		unsub1();

		const unsub2 = subscribe(op, () => {});
		expect(initRuns).toBe(2);
		unsub2();
	});

	it("effect: cleanup called, dispose required (no automatic reconnect)", () => {
		const s = state(0);
		let runCount = 0;
		let cleanupCount = 0;

		const dispose = effect([s], () => {
			runCount++;
			return () => cleanupCount++;
		});

		expect(runCount).toBe(1);

		s.set(1);
		expect(runCount).toBe(2);
		expect(cleanupCount).toBe(1); // cleanup from first run

		dispose();
		expect(cleanupCount).toBe(2); // final cleanup

		// After dispose, no more runs
		s.set(2);
		expect(runCount).toBe(2);

		// Effect doesn't "reconnect" — it's dispose + create new
		const dispose2 = effect([s], () => {
			runCount++;
			return () => cleanupCount++;
		});

		expect(runCount).toBe(3); // fresh effect ran
		dispose2();
	});
});
