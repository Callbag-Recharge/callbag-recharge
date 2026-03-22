import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { combine } from "../../extra/combine";
import { debounce } from "../../extra/debounce";
import { distinctUntilChanged } from "../../extra/distinctUntilChanged";
import { filter } from "../../extra/filter";
import { map } from "../../extra/map";
import { merge } from "../../extra/merge";
import { pipeRaw, SKIP } from "../../extra/pipeRaw";
import { sample } from "../../extra/sample";
import { scan } from "../../extra/scan";
import { subscribe } from "../../extra/subscribe";
import { switchMap } from "../../extra/switchMap";
import { throttle } from "../../extra/throttle";
import { batch, derived, effect, Inspector, pipe, producer, state } from "../../index";

beforeEach(() => {
	Inspector._reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ===========================================================================
// 1. Diamond resolution + RESOLVED propagation
//
// When a tier-1 operator with equals sends RESOLVED instead of DATA,
// combine must correctly count it and not hang or double-emit.
// ===========================================================================

describe("diamond + RESOLVED interaction", () => {
	it("combine resolves when one branch sends RESOLVED via map(equals)", () => {
		const s = state(1);
		// Branch A: map with equals — returns same value for 1→2, so sends RESOLVED
		const a = pipe(
			s,
			map((v: number) => (v <= 2 ? 10 : v * 10), { equals: Object.is }),
		);
		// Branch B: normal map
		const b = pipe(
			s,
			map((v: number) => v + 100),
		);
		const c = combine(a, b);
		const values: unknown[] = [];
		subscribe(c, (v) => values.push(v));

		s.set(2); // a: map(2)=10 === prev(10) → RESOLVED; b: map(2)=102 → DATA
		expect(values).toEqual([[10, 102]]);
	});

	it("combine resolves when BOTH branches send RESOLVED", () => {
		const s = state(1);
		const a = pipe(
			s,
			map(() => "constant", { equals: Object.is }),
		);
		const b = pipe(
			s,
			map(() => "constant", { equals: Object.is }),
		);
		const c = combine(a, b);
		const values: unknown[] = [];
		subscribe(c, (v) => values.push(v));

		s.set(2); // Both branches RESOLVED → combine sends RESOLVED, no emission
		expect(values).toEqual([]);
	});

	it("combine emits correctly after RESOLVED then real change", () => {
		const s = state(1);
		const a = pipe(
			s,
			map((v: number) => (v <= 2 ? 10 : v * 10), { equals: Object.is }),
		);
		const b = pipe(
			s,
			map((v: number) => v + 100),
		);
		const c = combine(a, b);
		const values: unknown[] = [];
		subscribe(c, (v) => values.push(v));

		s.set(2); // a: RESOLVED, b: DATA → emit once
		s.set(3); // a: 30 (changed!), b: 103 → emit once

		expect(values).toEqual([
			[10, 102],
			[30, 103],
		]);
	});

	it("deep diamond: s → a → c, s → b → c, with RESOLVED on one path", () => {
		const s = state(1);
		const a = pipe(
			s,
			map((v: number) => Math.min(v, 5), { equals: Object.is }),
		);
		const b = pipe(
			s,
			map((v: number) => v * 2),
		);
		// derived fn reads deps via get(), not destructured array
		const c = derived([a, b], () => a.get() + b.get());
		const values: number[] = [];
		subscribe(c, (v) => values.push(v));

		// s=1: a=1, b=2, c=3 (initial)
		s.set(2); // a=2, b=4, c=6
		s.set(3); // a=3, b=6, c=9
		s.set(4); // a=4, b=8, c=12
		s.set(5); // a=5, b=10, c=15
		s.set(6); // a=min(6,5)=5 → RESOLVED, b=12, c=17

		expect(values).toEqual([6, 9, 12, 15, 17]);
	});

	it("3-way diamond with mixed RESOLVED/DATA", () => {
		const s = state(0);
		const a = pipe(
			s,
			map((v: number) => v % 2, { equals: Object.is }), // only changes on odd/even switch
		);
		const b = pipe(
			s,
			map((v: number) => v * 10),
		); // always changes
		const c = pipe(
			s,
			map(() => "static", { equals: Object.is }),
		); // never changes after init
		const combo = derived([a, b, c], () => `${a.get()}-${b.get()}-${c.get()}`);
		const values: string[] = [];
		subscribe(combo, (v) => values.push(v));

		s.set(1); // a: 0→1 (DATA), b: 0→10 (DATA), c: RESOLVED
		s.set(2); // a: 1→0 (DATA), b: 10→20 (DATA), c: RESOLVED
		s.set(4); // a: 0→0 (RESOLVED), b: 20→40 (DATA), c: RESOLVED

		expect(values).toEqual(["1-10-static", "0-20-static", "0-40-static"]);
	});
});

// ===========================================================================
// 2. filter should NOT dedup by default (rxjs/callbag semantics)
//
// filter() should only test the predicate. Dedup is distinctUntilChanged's job.
// These tests assert the CORRECT no-dedup behavior.
// ===========================================================================

describe("filter: no default dedup (rxjs/callbag semantics)", () => {
	it("filter passes through consecutive identical passing values", () => {
		// In rxjs: filter(x => x > 0) called with [1, 1] emits both 1s.
		// Use producer to avoid state's own dedup.
		const s = producer<number>(undefined, { initial: 0 });
		const f = pipe(
			s,
			filter((v: number) => v > 0),
		);
		const obs = Inspector.observe(f);

		s.emit(1);
		s.emit(1); // same value, passes predicate → should emit (no dedup!)

		expect(obs.values).toEqual([1, 1]);
	});

	it("filter re-emits value after fail→pass with same value", () => {
		// Sequence: 2 (pass) → 3 (fail) → 2 (pass). The second 2 should emit.
		const s = state(2);
		const f = pipe(
			s,
			filter((v: number) => v % 2 === 0),
		);
		const obs = Inspector.observe(f);

		s.set(3); // fails predicate
		s.set(2); // passes — same as initial, but downstream may have missed it

		// After removing default dedup, this should emit 2 again
		expect(obs.values).toEqual([2]);
	});

	it("filter with explicit equals still deduplicates (opt-in)", () => {
		const s = producer<number>(undefined, { initial: 0 });
		const f = pipe(
			s,
			filter((v: number) => v > 0, { equals: Object.is }),
		);
		const obs = Inspector.observe(f);

		s.emit(1);
		s.emit(1); // equals: Object.is → deduplicated

		expect(obs.values).toEqual([1]);
	});
});

// ===========================================================================
// 3. subscribe should NOT dedup (rxjs/callbag semantics)
//
// In rxjs, subscribe() is a transparent sink — every next() value reaches
// the observer. Dedup belongs in distinctUntilChanged, not subscribe.
// ===========================================================================

describe("subscribe: no built-in dedup (rxjs/callbag semantics)", () => {
	it("subscribe forwards consecutive identical values", () => {
		// In rxjs: subject.next(1); subject.next(1); → observer sees both.
		const s = producer<number>();
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		s.emit(1);
		s.emit(1); // same value — must NOT be suppressed

		expect(values).toEqual([1, 1]);
	});

	it("subscribe forwards value identical to initial", () => {
		// If store starts with 5 and emits 5, subscribe should fire.
		const s = producer<number>(undefined, { initial: 5 });
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		s.emit(5); // same as initial — must still fire

		expect(values).toEqual([5]);
	});

	it("subscribe passes duplicate DATA when value changes back", () => {
		const s = producer<number>();
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		s.emit(1);
		s.emit(2);
		s.emit(1); // back to 1 — must fire

		expect(values).toEqual([1, 2, 1]);
	});

	it("raw callbag sink sees all DATA including duplicates", () => {
		const s = producer<number>();
		const obs = Inspector.observe(s);

		s.emit(1);
		s.emit(1); // producer has no equals → raw DATA is sent

		expect(obs.values).toEqual([1, 1]);
	});

	it("state's dedup is in state, not subscribe — subscribe is transparent", () => {
		// state() uses equals: Object.is internally. subscribe should NOT
		// add a second dedup layer. With no-dedup subscribe, the only gate
		// is state.set()'s own equals check.
		const s = producer<number>(undefined, { equals: Object.is });
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		s.emit(1);
		s.emit(1); // blocked at producer level (equals), not subscribe
		s.emit(2);

		expect(values).toEqual([1, 2]);
	});
});

// ===========================================================================
// 3b. Tier-2 extras inherit subscribe's dedup — should be fixed transitively
//
// debounce, throttle, switchMap etc. use subscribe() internally. If subscribe
// deduplicates, these operators silently swallow repeated input values even
// though they're documented as "no built-in dedup".
// ===========================================================================

describe("tier-2 internal subscribe must not dedup input", () => {
	it("throttle: same input value in consecutive windows should all pass", () => {
		// throttle uses subscribe(input, ...) internally.
		// If subscribe deduplicates, emit(1) → emit(1) won't reach
		// throttle's callback, silently dropping the second value.
		const s = producer<number>();
		const t = pipe(s, throttle(50));
		const obs = Inspector.observe(t);

		s.emit(1); // window opens, passes
		vi.advanceTimersByTime(50); // window closes
		s.emit(1); // new window — must reach throttle callback

		expect(obs.values).toEqual([1, 1]);
	});

	it("debounce: re-emitting same value resets timer and emits", () => {
		const s = producer<number>();
		const d = pipe(s, debounce(50));
		const obs = Inspector.observe(d);

		s.emit(1);
		vi.advanceTimersByTime(50); // output: 1

		s.emit(1); // same value — subscribe should NOT suppress this
		vi.advanceTimersByTime(50); // output: 1 again

		expect(obs.values).toEqual([1, 1]);
	});

	it("sample: same input value sampled twice should emit both times", () => {
		const s = producer<number>(undefined, { initial: 5 });
		const notifier = state(0);
		const sampled = pipe(s, sample(notifier));
		const obs = Inspector.observe(sampled);

		// input is 5, notifier fires twice
		notifier.set(1); // sample emits 5
		notifier.set(2); // sample emits 5 again — must not be suppressed

		expect(obs.values).toEqual([5, 5]);
	});
});

// ===========================================================================
// 4. Push/pull consistency — get() must match subscribed value
// ===========================================================================

describe("push/pull consistency", () => {
	it("map: get() matches last subscribed value after multiple changes", () => {
		const s = state(1);
		const m = pipe(
			s,
			map((v: number) => v * 2),
		);
		let lastSub: number | undefined;
		subscribe(m, (v) => {
			lastSub = v;
		});

		s.set(5);
		expect(m.get()).toBe(10);
		expect(lastSub).toBe(10);

		s.set(3);
		expect(m.get()).toBe(6);
		expect(lastSub).toBe(6);
	});

	it("filter: get() returns lastPassing consistent with subscribed state", () => {
		const s = state(2);
		const f = pipe(
			s,
			filter((v: number) => v > 3),
		);
		let lastSub: number | undefined;
		subscribe(f, (v) => {
			lastSub = v;
		});

		s.set(5); // passes
		expect(f.get()).toBe(5);
		expect(lastSub).toBe(5);

		s.set(1); // fails
		expect(f.get()).toBe(5); // still 5
		// subscribe doesn't fire for failed predicate
	});

	it("scan: get() accumulator matches subscribed state after changes", () => {
		const s = state(1);
		const acc = pipe(
			s,
			scan((a, v: number) => a + v, 0),
		);
		const values: number[] = [];
		subscribe(acc, (v) => values.push(v));

		// On subscribe, scan connects. No DATA yet (state doesn't push on connect).
		// scan's value is seed=0. subscribe's prev = acc.get() = 0.
		s.set(2); // DATA 2 → reducer(0, 2) = 2
		expect(acc.get()).toBe(2);
		s.set(3); // DATA 3 → reducer(2, 3) = 5
		expect(acc.get()).toBe(5);
		expect(values).toEqual([2, 5]);
	});

	it("scan: pull mode (no subscriber) applies reducer with initial value", () => {
		const s = state(1);
		const acc = pipe(
			s,
			scan((a, v: number) => a + v, 0),
		);

		// Pull mode: getter reads input.get()=1 → reducer(0, 1) = 1
		expect(acc.get()).toBe(1);
		s.set(2);
		// getter reads input.get()=2 → reducer(1, 2) = 3
		expect(acc.get()).toBe(3);
	});

	it("combine: get() reflects latest state even between emissions", () => {
		const a = state(1);
		const b = state(2);
		const c = combine(a, b);

		subscribe(c, () => {}); // activate

		a.set(10);
		expect(c.get()).toEqual([10, 2]);

		b.set(20);
		expect(c.get()).toEqual([10, 20]);
	});

	it("derived get() without subscriber matches what subscribe would see", () => {
		const s = state(1);
		const d = derived([s], () => s.get() * 100);

		// Pull only
		expect(d.get()).toBe(100);
		s.set(5);
		expect(d.get()).toBe(500);

		// Now subscribe
		const values: number[] = [];
		subscribe(d, (v) => values.push(v));
		s.set(7);
		expect(d.get()).toBe(700);
		expect(values).toEqual([700]);
	});
});

// ===========================================================================
// 5. Batch + dedup interaction
// ===========================================================================

describe("batch + dedup coalescing", () => {
	it("batch coalesces to final value; subscribe sees only that", () => {
		const s = state(1);
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		batch(() => {
			s.set(2);
			s.set(3);
			s.set(4);
		});

		expect(values).toEqual([4]);
	});

	it("batch that returns to original value: DATA still sent, subscribe forwards", () => {
		const s = state(1);
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		batch(() => {
			s.set(2); // state: eqFn(1,2)=false → _value=2, DIRTY sent, DATA deferred
			s.set(3); // state: eqFn(2,3)=false → _value=3, already pending
			s.set(1); // state: eqFn(3,1)=false → _value=1, already pending
		});

		// Batch drains: DATA sent with _value=1. State's per-set() equals
		// doesn't track the pre-batch baseline, so the round-trip isn't caught.
		// subscribe is transparent — use distinctUntilChanged for suppression.
		expect(values).toEqual([1]);
	});

	it("batch + diamond: combine sees consistent snapshot", () => {
		const s = state(1);
		const a = pipe(
			s,
			map((v: number) => v * 2),
		);
		const b = pipe(
			s,
			map((v: number) => v + 10),
		);
		const c = combine(a, b);
		const values: unknown[] = [];
		subscribe(c, (v) => values.push(v));

		batch(() => {
			s.set(2);
			s.set(3);
		});

		// After batch drains, s=3, a=6, b=13
		expect(values).toEqual([[6, 13]]);
	});

	it("batch + derived with equals: no emission when result unchanged", () => {
		const s = state(1);
		const d = derived([s], () => Math.min(s.get(), 5), { equals: Object.is });
		const values: number[] = [];
		subscribe(d, (v) => values.push(v));

		batch(() => {
			s.set(10); // d would be 5
			s.set(3); // d would be 3
		});
		// After batch: s=3, d=min(3,5)=3 — changed from 1
		expect(values).toEqual([3]);

		batch(() => {
			s.set(100); // d=5
			s.set(2); // d=2
		});
		expect(values).toEqual([3, 2]);
	});
});

// ===========================================================================
// 6. Multi-operator chains — complex pipelines exercising dedup boundaries
// ===========================================================================

describe("multi-operator chains", () => {
	it("map → filter → scan: correct accumulation through dedup layers", () => {
		const s = state(1);
		const chain = pipe(
			s,
			map((v: number) => v * 2),
			filter((v: number) => v > 5),
			scan((acc, v: number) => acc + v, 0),
		);
		const values: number[] = [];
		subscribe(chain, (v) => values.push(v));

		s.set(2); // map→4, filter fails
		s.set(3); // map→6, filter passes, scan: 0+6=6
		s.set(4); // map→8, filter passes, scan: 6+8=14

		expect(values).toEqual([6, 14]);
		expect(chain.get()).toBe(14);
	});

	it("map → distinctUntilChanged: dedup stacks correctly", () => {
		const s = state(1);
		const chain = pipe(
			s,
			map((v: number) => v % 3), // 1→1, 2→2, 3→0, 4→1
			distinctUntilChanged(),
		);
		const obs = Inspector.observe(chain);

		s.set(2); // map→2, distinct: 1→2 (emit)
		s.set(4); // map→1, distinct: 2→1 (emit)
		s.set(7); // map→1, distinct: 1→1 (RESOLVED)

		expect(obs.values).toEqual([2, 1]);
	});

	it("pipeRaw fused pipeline handles SKIP + repeated values", () => {
		const s = state(0);
		const p = pipeRaw(
			s,
			(v: number) => (v > 0 ? v : SKIP),
			(v: number) => v * 10,
		);
		const obs = Inspector.observe(p);

		s.set(-1); // SKIP
		s.set(2); // 20
		s.set(-5); // SKIP
		s.set(2); // 20 again — pipeRaw doesn't dedup, so this emits

		expect(obs.values).toEqual([20, 20]);
	});

	it("merge → scan: accumulates from independent sources", () => {
		const a = state(0);
		const b = state(0);
		const merged = merge(a, b);
		const total = pipe(
			merged,
			scan((acc, v: number | undefined) => acc + (v ?? 0), 0),
		);
		const values: number[] = [];
		subscribe(total, (v) => values.push(v));

		a.set(3); // merged→3, scan: 0+3=3
		b.set(5); // merged→5, scan: 3+5=8
		a.set(7); // merged→7, scan: 8+7=15

		expect(values).toEqual([3, 8, 15]);
	});

	it("merge does not dedup same value from different sources", () => {
		const a = state(0);
		const b = state(0);
		const merged = merge(a, b);
		const obs = Inspector.observe(merged);

		a.set(5); // merged emits 5
		b.set(5); // merged emits 5 (different source, no dedup)

		expect(obs.values).toEqual([5, 5]);
	});

	it("combine → map with equals: RESOLVED propagates through", () => {
		const a = state(1);
		const b = state(2);
		const c = combine(a, b);
		// map with equals that checks sum
		const summed = pipe(
			c,
			map(([x, y]: [number, number]) => x + y, { equals: Object.is }),
		);
		const values: number[] = [];
		subscribe(summed, (v) => values.push(v));

		a.set(2); // combine→[2,2], map→4 (changed from 3)
		b.set(2); // combine→[2,2], map→4 (RESOLVED — same sum)

		expect(values).toEqual([4]);
	});
});

// ===========================================================================
// 7. Tier-2 operator chains — cycle boundaries don't accumulate dedup
// ===========================================================================

describe("tier-2 chain dedup isolation", () => {
	it("debounce → map: map sees all debounced values via subscribe", () => {
		const s = producer<number>();
		const debounced = pipe(s, debounce(50));
		const mapped = pipe(
			debounced,
			map((v: number) => (v ?? 0) * 10),
		);
		const values: number[] = [];
		subscribe(mapped, (v) => values.push(v));

		s.emit(1);
		vi.advanceTimersByTime(50); // debounce→1, map→10

		s.emit(2);
		s.emit(1); // replace 2 with 1
		vi.advanceTimersByTime(50); // debounce→1, map→10 (again)

		// subscribe dedup: prev=10, next=10 → suppressed
		// This is subscribe's layer, NOT operator dedup. Correct behavior.
		// To verify map itself didn't dedup, check raw:
		const obs = Inspector.observe(mapped);
		s.emit(3);
		vi.advanceTimersByTime(50); // debounce→3, map→30
		s.emit(4);
		s.emit(3); // replace with 3
		vi.advanceTimersByTime(50); // debounce→3, map→30

		// map has no equals → emits both 30s at protocol level
		expect(obs.values).toEqual([30, 30]);
	});

	it("debounce itself does not dedup repeated values", () => {
		const s = producer<number>();
		const d = pipe(s, debounce(50));
		const obs = Inspector.observe(d);

		s.emit(1);
		vi.advanceTimersByTime(50); // output: 1

		s.emit(2);
		s.emit(1); // overwrite with 1
		vi.advanceTimersByTime(50); // output: 1 again

		expect(obs.values).toEqual([1, 1]);
	});

	it("throttle does not dedup repeated output values from different inputs", () => {
		// throttle's internal subscribe deduplicates same consecutive input values,
		// so we use different intermediate values to produce same output
		const s = producer<number>();
		const t = pipe(s, throttle(50));
		const obs = Inspector.observe(t);

		s.emit(1); // passes (first in window) → output: 1
		vi.advanceTimersByTime(50);
		s.emit(2); // passes (new window) → output: 2
		vi.advanceTimersByTime(50);
		s.emit(1); // passes (new window, same as first output) → output: 1

		// throttle producer has no equals → 1 appears again
		expect(obs.values).toEqual([1, 2, 1]);
	});

	it("switchMap → distinctUntilChanged: dedup only in distinctUntilChanged", () => {
		const selector = state("a");
		const innerA = state(10);
		const innerB = state(10);
		const switched = pipe(
			selector,
			switchMap((v) => (v === "a" ? innerA : innerB)),
		);
		const distinct = pipe(switched, distinctUntilChanged());
		const values: (number | undefined)[] = [];
		subscribe(distinct, (v) => values.push(v));

		// Trigger outer emission to create initial inner subscription
		selector.set("a"); // switchMap subscribes to innerA (10)
		selector.set("b"); // switchMap emits 10 (from innerB), distinct: 10→10 suppressed

		// distinctUntilChanged catches the duplicate
		expect(values).toEqual([10]); // first emission from innerA, then innerB is suppressed

		innerB.set(20); // distinct: 10→20, emits
		expect(values).toEqual([10, 20]);
	});
});

// ===========================================================================
// 8. Edge cases — undefined, NaN, object references
// ===========================================================================

describe("dedup edge cases", () => {
	it("NaN === NaN: Object.is(NaN, NaN) is true, dedup works", () => {
		const s = state(NaN);
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		s.set(NaN); // Object.is(NaN, NaN) → suppressed

		expect(values).toEqual([]);
	});

	it("+0 vs -0: Object.is(+0, -0) is false, not deduped", () => {
		const s = state(+0);
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		s.set(-0); // Object.is(+0, -0) = false → emits

		expect(values).toEqual([-0]);
	});

	it("undefined values: state skips equals check when _value is undefined", () => {
		const s = state<number | undefined>(undefined);
		const values: (number | undefined)[] = [];
		subscribe(s, (v) => values.push(v));

		// state's emit guard: `_value !== undefined` → false when _value is undefined,
		// so the equals check is skipped and emit proceeds. subscribe is transparent.
		s.set(undefined); // state _value=undefined → guard skipped → emits
		s.set(1);
		s.set(undefined); // state _value=1 → eqFn(1, undefined)=false → emits

		expect(values).toEqual([undefined, 1, undefined]);
	});

	it("object references: same shape, different ref → not deduped by default", () => {
		const s = state({ x: 1 });
		const values: object[] = [];
		subscribe(s, (v) => values.push(v));

		s.set({ x: 1 }); // new ref → not deduped

		expect(values).toEqual([{ x: 1 }]);
	});

	it("object references: custom equals prevents emission of equal objects", () => {
		const s = state({ x: 1 });
		const m = pipe(
			s,
			map((v: { x: number }) => ({ doubled: v.x * 2 }), {
				equals: (a, b) => a.doubled === b.doubled,
			}),
		);
		const obs = Inspector.observe(m);

		s.set({ x: 1 }); // map→{doubled:2}, equals prev → RESOLVED

		expect(obs.values).toEqual([]);

		s.set({ x: 2 }); // map→{doubled:4}, different → emits
		expect(obs.values).toEqual([{ doubled: 4 }]);
	});
});

// ===========================================================================
// 9. Effect dedup interaction — effects should fire on real changes only
// ===========================================================================

describe("effect + dedup", () => {
	it("effect fires only on actual value changes, not RESOLVED", () => {
		const s = state(1);
		const d = derived([s], () => Math.min(s.get(), 5), { equals: Object.is });
		const runs: number[] = [];

		const dispose = effect([d], () => {
			runs.push(d.get());
		});

		s.set(2); // d: 2 (changed from 1) → effect fires
		s.set(3); // d: 3 (changed) → effect fires
		s.set(100); // d: 5 (changed) → effect fires
		s.set(200); // d: min(200,5)=5 → RESOLVED, effect should NOT fire

		expect(runs).toEqual([1, 2, 3, 5]); // includes initial run

		dispose();
	});

	it("effect fires for each diamond resolution", () => {
		const s = state(1);
		const a = pipe(
			s,
			map((v: number) => v * 2),
		);
		const b = pipe(
			s,
			map((v: number) => v + 10),
		);
		const c = combine(a, b);
		const runs: unknown[] = [];

		const dispose = effect([c], () => {
			runs.push(c.get());
		});

		s.set(2); // a→4, b→12, combine→[4,12] → effect
		s.set(3); // a→6, b→13, combine→[6,13] → effect

		expect(runs).toEqual([
			[2, 11], // initial
			[4, 12],
			[6, 13],
		]);

		dispose();
	});
});

// ===========================================================================
// 10. RESOLVED signal counting in combine — stress test
// ===========================================================================

describe("RESOLVED counting stress", () => {
	it("combine with many deps, some RESOLVED", () => {
		const s = state(0);
		const deps = Array.from({ length: 8 }, (_, i) =>
			pipe(
				s,
				map((v: number) => (i % 2 === 0 ? v : "fixed"), { equals: Object.is }),
			),
		);
		// Even indices change, odd indices always RESOLVED
		const c = combine(...deps);
		const values: unknown[] = [];
		subscribe(c, (v) => values.push(v));

		s.set(1);

		expect(values.length).toBe(1);
		const result = values[0] as unknown[];
		// Even indices: 1, odd indices: "fixed"
		for (let i = 0; i < 8; i++) {
			expect(result[i]).toBe(i % 2 === 0 ? 1 : "fixed");
		}
	});

	it("combine with ALL deps RESOLVED produces no emission", () => {
		const s = state(0);
		const deps = Array.from({ length: 4 }, () =>
			pipe(
				s,
				map(() => "constant", { equals: Object.is }),
			),
		);
		const c = combine(...deps);
		const values: unknown[] = [];
		subscribe(c, (v) => values.push(v));

		s.set(1); // all deps RESOLVED

		expect(values).toEqual([]);
	});

	it("alternating RESOLVED/DATA across multiple updates", () => {
		const s = state(0);
		// a: changes only when s > 5
		const a = pipe(
			s,
			map((v: number) => (v > 5 ? v : 0), { equals: Object.is }),
		);
		// b: always changes
		const b = pipe(
			s,
			map((v: number) => v * 10),
		);
		const c = combine(a, b);
		const values: unknown[] = [];
		subscribe(c, (v) => values.push(v));

		s.set(1); // a: RESOLVED (still 0), b: 10 → emit [0, 10]
		s.set(2); // a: RESOLVED (still 0), b: 20 → emit [0, 20]
		s.set(6); // a: 6 (changed!), b: 60 → emit [6, 60]
		s.set(7); // a: 7, b: 70 → emit [7, 70]
		s.set(3); // a: 0 (back!), b: 30 → emit [0, 30]

		expect(values).toEqual([
			[0, 10],
			[0, 20],
			[6, 60],
			[7, 70],
			[0, 30],
		]);
	});
});

// ===========================================================================
// 11. Glitch-freedom — diamond graphs must never expose intermediate state
// ===========================================================================

describe("glitch-freedom in diamond graphs", () => {
	it("derived never sees inconsistent dep values in diamond", () => {
		const s = state(1);
		const a = pipe(
			s,
			map((v: number) => v * 2),
		);
		const b = pipe(
			s,
			map((v: number) => v * 3),
		);
		// c should always see a=2*s and b=3*s simultaneously
		const c = derived([a, b], () => {
			const av = a.get();
			const bv = b.get();
			// invariant: bv === av * 1.5
			expect(bv).toBe(av * 1.5);
			return av + bv;
		});
		subscribe(c, () => {}); // activate

		for (let i = 2; i <= 20; i++) {
			s.set(i); // invariant checked inside derived fn
		}
	});

	it("combine never exposes stale dep value in diamond", () => {
		const s = state(1);
		const doubled = pipe(
			s,
			map((v: number) => v * 2),
		);
		const tripled = pipe(
			s,
			map((v: number) => v * 3),
		);
		const c = combine(doubled, tripled);
		const values: [number, number][] = [];
		subscribe(c, (v) => values.push(v as [number, number]));

		for (let i = 2; i <= 10; i++) {
			s.set(i);
		}

		// Every emission must have tripled === doubled * 1.5
		for (const [d, t] of values) {
			expect(t).toBe(d * 1.5);
		}
	});
});

// ===========================================================================
// 12. Stress: rapid state changes with deep operator chains
// ===========================================================================

describe("rapid state change stress", () => {
	it("long chain of maps produces correct final value", () => {
		const s = state(0);
		let store = s as ReturnType<typeof state<number>>;
		// Chain 10 map(+1) operators
		for (let i = 0; i < 10; i++) {
			store = pipe(
				store,
				map((v: number) => v + 1),
			) as any;
		}
		const values: number[] = [];
		subscribe(store, (v) => values.push(v));

		s.set(1); // should be 1 + 10 = 11
		s.set(5); // should be 5 + 10 = 15

		expect(values).toEqual([11, 15]);
	});

	it("batch with diamond and long chain", () => {
		const s = state(0);
		const a = pipe(
			s,
			map((v: number) => v + 1),
			map((v: number) => v * 2),
		);
		const b = pipe(
			s,
			map((v: number) => v - 1),
			map((v: number) => v * 3),
		);
		const c = combine(a, b);
		const values: unknown[] = [];
		subscribe(c, (v) => values.push(v));

		batch(() => {
			for (let i = 1; i <= 100; i++) {
				s.set(i);
			}
		});

		// Only one emission after batch: s=100, a=(101)*2=202, b=(99)*3=297
		expect(values).toEqual([[202, 297]]);
	});
});
