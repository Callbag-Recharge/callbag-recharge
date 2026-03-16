import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA, DIRTY, END, RESOLVED, START, STATE } from "../../core/protocol";
import { bufferTime } from "../../extra/bufferTime";
import { combine } from "../../extra/combine";
import { concat } from "../../extra/concat";
import { concatMap } from "../../extra/concatMap";
import { debounce } from "../../extra/debounce";
import { delay } from "../../extra/delay";
import { exhaustMap } from "../../extra/exhaustMap";
import { filter } from "../../extra/filter";
import { flat } from "../../extra/flat";
import { map } from "../../extra/map";
import { merge } from "../../extra/merge";
import { pairwise } from "../../extra/pairwise";
import { sample } from "../../extra/sample";
import { scan } from "../../extra/scan";
import { skip } from "../../extra/skip";
import { subscribe } from "../../extra/subscribe";
import { switchMap } from "../../extra/switchMap";
import { take } from "../../extra/take";
import { throttle } from "../../extra/throttle";
import { throwError } from "../../extra/throwError";
import { TimeoutError, timeout } from "../../extra/timeout";
import { batch, derived, effect, Inspector, pipe, producer, state } from "../../index";

beforeEach(() => {
	Inspector._reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ===========================================================================
// Helpers
// ===========================================================================

/** Observe raw callbag events (DATA + END + STATE) */
function observeRaw<T>(store: { source: (type: number, payload?: any) => void }) {
	const data: T[] = [];
	let ended = false;
	let endError: unknown;
	const signals: unknown[] = [];
	store.source(START, (type: number, d: any) => {
		if (type === START) return;
		if (type === 1) data.push(d);
		if (type === STATE) signals.push(d);
		if (type === END) {
			ended = true;
			endError = d;
		}
	});
	return {
		data,
		signals,
		get ended() {
			return ended;
		},
		get endError() {
			return endError;
		},
	};
}

/** Create a producer that can be errored/completed externally */
function errorableProducer<T>(initial: T) {
	let _error: ((e: unknown) => void) | undefined;
	let _complete: (() => void) | undefined;
	let _emit: ((v: T) => void) | undefined;
	const s = producer<T>(
		({ error, complete, emit }) => {
			_error = error;
			_complete = complete;
			_emit = emit;
		},
		{ initial },
	);
	return {
		store: s,
		emit: (v: T) => _emit?.(v),
		error: (e: unknown) => _error?.(e),
		complete: () => _complete?.(),
	};
}

// ===========================================================================
// 1. merge error propagation
//
// merge forwards errors from any source immediately (rxjs semantics).
// ===========================================================================

describe("merge: error propagation", () => {
	it("merge forwards error from a source to downstream", () => {
		const a = errorableProducer(1);
		const b = state(10);
		const m = merge(a.store, b);
		const obs = observeRaw(m);
		subscribe(m, () => {});

		a.error("boom");

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBe("boom");
	});

	it("should complete (not error) when all sources complete cleanly", () => {
		const a = errorableProducer(1);
		const b = errorableProducer(2);
		const m = merge(a.store, b.store);
		const obs = observeRaw(m);
		subscribe(m, () => {});

		a.complete();
		expect(obs.ended).toBe(false); // one source still active
		b.complete();
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});

	it("merge emits from each source independently", () => {
		const a = state(1);
		const b = state(10);
		const m = merge(a, b);
		const values: unknown[] = [];
		subscribe(m, (v) => values.push(v));

		a.set(2);
		b.set(20);
		expect(values).toEqual([2, 20]);
	});
});

// ===========================================================================
// 2. Inner error forwarding in tier-2 dynamic subscription operators
//
// switchMap, flat, concatMap, exhaustMap forward inner errors via onEnd.
// ===========================================================================

describe("tier-2: inner error forwarding", () => {
	it("switchMap forwards error from inner store", () => {
		const outer = state(1);
		const sm = pipe(
			outer,
			switchMap((v) => (v === 2 ? throwError("inner-err") : state(v * 10))),
		);
		const obs = observeRaw(sm);
		subscribe(sm, () => {});

		outer.set(2);

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBe("inner-err");
	});

	it("concatMap forwards error from inner store", () => {
		// concatMap subscribes sequentially — initial inner must complete before
		// the next queued inner starts. Use throwError as the initial inner directly.
		const outer = state(1);
		const cm = pipe(
			outer,
			concatMap((v) => throwError<number>(`err-${v}`)),
		);
		const obs = observeRaw(cm);
		subscribe(cm, () => {});

		// Initial inner = throwError("err-1") → error propagates immediately
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBe("err-1");
	});

	it("exhaustMap forwards error from inner store", () => {
		// exhaustMap's initial inner errors immediately via throwError
		const outer = state(1);
		const em = pipe(
			outer,
			exhaustMap((v) => throwError<number>(`err-${v}`)),
		);
		const obs = observeRaw(em);
		subscribe(em, () => {});

		// Initial inner = throwError("err-1") → error propagates
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBe("err-1");
	});

	it("flat forwards error from inner store", () => {
		const inner1 = state(10);
		const inner2 = errorableProducer(20);
		const outer = state<typeof inner1 | typeof inner2.store>(inner1);
		const f = pipe(outer, flat<number>());
		const obs = observeRaw(f);
		subscribe(f, () => {});

		outer.set(inner2.store);
		inner2.error("inner-err");

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBe("inner-err");
	});
});

// ===========================================================================
// 3. take(0) completes immediately (like EMPTY in rxjs)
// ===========================================================================

describe("take(0)", () => {
	it("take(0) completes immediately without emitting", () => {
		const s = state(1);
		const t = pipe(s, take(0));
		const obs = observeRaw(t);

		expect(obs.data).toEqual([]);
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});

	it("take(0) should not forward STATE signals", () => {
		const s = state(1);
		const t = pipe(s, take(0));
		const obs = observeRaw(t);

		s.set(2);
		// take(0) correctly blocks STATE (count < n = 0 < 0 = false)
		const dirtySignals = obs.signals.filter((s) => s === DIRTY);
		expect(dirtySignals).toEqual([]);
	});

	it("take(1) works correctly — completes after one value", () => {
		const s = state(1);
		const t = pipe(s, take(1));
		const obs = observeRaw(t);
		subscribe(t, () => {});

		s.set(2);
		expect(obs.data).toContain(2);
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});
});

// ===========================================================================
// 4. Reentrancy: subscriber modifies state during emission
//
// When a subscriber callback triggers another state change, the system must
// remain consistent. This tests interaction between synchronous re-emission
// and diamond resolution.
// ===========================================================================

describe("reentrancy", () => {
	it("subscriber setting another state during emission — derived sees final state", () => {
		const a = state(1);
		const b = state(10);
		const values: number[] = [];

		const c = derived([a, b], () => a.get() + b.get());
		subscribe(c, (v) => values.push(v));

		// When a changes, a subscriber also changes b
		subscribe(a, (v) => b.set(v * 10));

		a.set(2);
		// After a.set(2): a=2, subscriber fires b.set(20)
		// The final consistent state should be a=2, b=20, c=22
		expect(c.get()).toBe(22);
		// Depending on ordering, we may see intermediate values
		expect(values[values.length - 1]).toBe(22);
	});

	it("reentrant set during batch produces single final value", () => {
		const a = state(1);
		const b = state(10);
		const values: number[] = [];

		const c = derived([a, b], () => a.get() + b.get());
		subscribe(c, (v) => values.push(v));

		batch(() => {
			a.set(2);
			b.set(20);
		});

		expect(values).toEqual([22]);
		expect(c.get()).toBe(22);
	});

	it("subscriber unsubscribing itself during emission doesn't crash", () => {
		const s = state(1);
		let unsub: (() => void) | null = null;
		const values: number[] = [];

		unsub = subscribe(s, (v) => {
			values.push(v);
			if (v === 2) unsub?.();
		});

		const other: number[] = [];
		subscribe(s, (v) => other.push(v));

		s.set(2);
		s.set(3);

		// First subscriber saw 2, then unsubscribed — misses 3
		expect(values).toEqual([2]);
		// Second subscriber saw both
		expect(other).toEqual([2, 3]);
	});

	it("subscriber adding a new subscriber during emission — new sub sees current value", () => {
		const s = state(1);
		const values: number[] = [];
		const lateValues: number[] = [];

		subscribe(s, (v) => {
			values.push(v);
			if (v === 2) {
				// Add new subscriber mid-emission
				subscribe(s, (v2) => lateValues.push(v2));
			}
		});

		s.set(2);
		s.set(3);

		expect(values).toEqual([2, 3]);
		// v4: Output slot dispatches to the snapshot at call time.
		// New subscriber added during DATA(2) dispatch only sees DATA(3).
		expect(lateValues).toEqual([3]);
	});

	it("effect triggering another state change during its callback", () => {
		const a = state(1);
		const b = state(10);

		const calls: string[] = [];

		const disposeA = effect([a], () => {
			const v = a.get();
			calls.push(`effectA: ${v}`);
			if (v === 2) b.set(20);
		});

		const disposeB = effect([b], () => {
			calls.push(`effectB: ${b.get()}`);
		});

		a.set(2);

		expect(calls).toContain("effectA: 2");
		expect(calls).toContain("effectB: 20");

		disposeA();
		disposeB();
	});
});

// ===========================================================================
// 5. Tier-2 completion forwarding
//
// Tier-2 operators now forward upstream completion via subscribe's onEnd.
// ===========================================================================

describe("tier-2: completion forwarding", () => {
	it("debounce forwards upstream completion", () => {
		const s = errorableProducer(1);
		const d = pipe(s.store, debounce(100));
		const obs = observeRaw(d);
		subscribe(d, () => {});

		s.complete();

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});

	it("throttle forwards upstream completion", () => {
		const s = errorableProducer(1);
		const t = pipe(s.store, throttle(100));
		const obs = observeRaw(t);
		subscribe(t, () => {});

		s.complete();

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});

	it("switchMap completes when outer completes and no active inner", () => {
		const outer = errorableProducer(1);
		const inner = errorableProducer(10);
		const sm = pipe(
			outer.store,
			switchMap(() => inner.store),
		);
		const obs = observeRaw(sm);
		subscribe(sm, () => {});

		// Outer completes — but inner is still active
		outer.complete();
		expect(obs.ended).toBe(false); // waiting for inner

		// Inner completes — now switchMap should complete
		inner.complete();
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});

	it("debounce flushes pending value on upstream completion", () => {
		const s = errorableProducer(0);
		const d = pipe(s.store, debounce(100));
		const values: number[] = [];
		subscribe(d, (v) => values.push(v));

		s.emit(42);
		// Value is pending in debounce timer
		s.complete();

		// Debounce flushes pending value synchronously, then completes
		expect(values).toEqual([42]);
	});

	it("debounce forwards upstream error (cancels pending)", () => {
		const s = errorableProducer(0);
		const d = pipe(s.store, debounce(100));
		const obs = observeRaw(d);
		const values: number[] = [];
		subscribe(d, (v) => values.push(v));

		s.emit(42);
		s.error("fail");

		// Error cancels pending timer — value is NOT flushed
		expect(values).toEqual([]);
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBe("fail");
	});

	it("throttle forwards upstream error", () => {
		const s = errorableProducer(1);
		const t = pipe(s.store, throttle(100));
		const obs = observeRaw(t);
		subscribe(t, () => {});

		s.error("fail");

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBe("fail");
	});
});

// ===========================================================================
// 6. scan accumulator resets on reconnect (rxjs semantics)
//
// Each subscription starts the accumulator from seed, matching rxjs behavior.
// ===========================================================================

describe("scan: accumulator across reconnect", () => {
	it("accumulator resets to seed after disconnect and reconnect", () => {
		const s = state(1);
		const sc = pipe(
			s,
			scan((acc: number, v: number) => acc + v, 0),
		);

		// First subscriber
		const values1: number[] = [];
		const unsub1 = subscribe(sc, (v) => values1.push(v));

		s.set(2); // acc = 0 + 2 = 2
		s.set(3); // acc = 2 + 3 = 5
		expect(values1).toEqual([2, 5]);

		unsub1();

		// Second subscriber — acc resets to seed (0)
		const values2: number[] = [];
		subscribe(sc, (v) => values2.push(v));

		s.set(4);
		// acc reset to 0: 0 + 4 = 4 (matches rxjs)
		expect(sc.get()).toBe(4);
	});

	it("getter after disconnect applies reducer from seed", () => {
		const s = state(1);
		const sc = pipe(
			s,
			scan((acc: number, v: number) => acc + v, 0),
		);

		const unsub = subscribe(sc, () => {});
		s.set(5); // acc = 0 + 5 = 5
		unsub();

		// Pull-based get() after disconnect — acc was reset to seed on reconnect init,
		// but getter uses the acc in the outer closure.
		// After unsub, acc = seed (reset by init on next connect) — but getter runs
		// without re-connect. The acc is still 5 from push mode (reset only on re-init).
		s.set(10);
		// getter: acc = 5 + 10 = 15 (acc not reset yet — reset only on re-connect)
		expect(sc.get()).toBe(15);
	});

	it("getter idempotency: repeated get() with same dep value doesn't re-accumulate", () => {
		const s = state(5);
		const sc = pipe(
			s,
			scan((acc: number, v: number) => acc + v, 0),
		);

		// First pull
		expect(sc.get()).toBe(5); // 0 + 5 = 5
		// Second pull with same dep value — should NOT re-accumulate
		expect(sc.get()).toBe(5); // idempotent
	});

	it("scan pull-push-pull: reconnect resets acc to seed", () => {
		const s = state(1);
		const sc = pipe(
			s,
			scan((acc: number, v: number) => acc + v, 0),
		);

		// Pull (disconnected) — getter applies reducer: 0 + 1 = 1
		expect(sc.get()).toBe(1);

		// Subscribe (push mode) — reconnect resets acc to seed
		const values: number[] = [];
		const unsub = subscribe(sc, (v) => values.push(v));

		s.set(5); // push: acc = 0 (reset) + 5 = 5
		expect(values).toEqual([5]);

		unsub();

		// After disconnect, getterSeeded was set to false during the push-mode init.
		// acc was reset to 0 (seed) on connect, then 0 + 5 = 5 during push.
		// On get(), getter sees getterSeeded=false → applies reducer: 5 + 5 = 10
		expect(sc.get()).toBe(10);
		// Subsequent calls with same dep value are idempotent
		expect(sc.get()).toBe(10);
	});
});

// ===========================================================================
// 7. pairwise first-emission semantics (rxjs semantics)
//
// pairwise requires 2 observed emissions before emitting the first pair.
// ===========================================================================

describe("pairwise: first-emission semantics", () => {
	it("does NOT emit on first upstream change (needs 2 observed values)", () => {
		const s = state(1);
		const p = pipe(s, pairwise());
		const values: unknown[] = [];
		subscribe(p, (v) => values.push(v));

		s.set(2);
		// First DATA is buffered as prev — no emission yet
		expect(values).toEqual([]);
	});

	it("emits [prev, curr] starting from second upstream change", () => {
		const s = state(1);
		const p = pipe(s, pairwise());
		const values: unknown[] = [];
		subscribe(p, (v) => values.push(v));

		s.set(2); // buffered as prev
		s.set(3); // emits [2, 3]
		s.set(4); // emits [3, 4]

		expect(values).toEqual([
			[2, 3],
			[3, 4],
		]);
	});

	it("get() returns undefined before two changes, then last pair", () => {
		const s = state(1);
		const p = pipe(s, pairwise());

		expect(p.get()).toBeUndefined();

		subscribe(p, () => {});
		s.set(2); // first change — buffered, no pair yet
		expect(p.get()).toBeUndefined();

		s.set(3); // second change — pair emitted
		expect(p.get()).toEqual([2, 3]);
	});
});

// ===========================================================================
// 8. combine edge cases
// ===========================================================================

describe("combine: single source", () => {
	it("works correctly with a single source", () => {
		const s = state(1);
		const c = combine(s);
		const values: unknown[] = [];
		subscribe(c, (v) => values.push(v));

		s.set(2);
		s.set(3);

		expect(values).toEqual([[2], [3]]);
		expect(c.get()).toEqual([3]);
	});

	it("RESOLVED propagation works with single source", () => {
		const s = state(1);
		const m = pipe(
			s,
			map(() => "constant", { equals: Object.is }),
		);
		const c = combine(m);
		const values: unknown[] = [];
		subscribe(c, (v) => values.push(v));

		s.set(2); // map returns "constant" → RESOLVED → combine should RESOLVED
		expect(values).toEqual([]); // no emission since map sent RESOLVED
	});
});

describe("combine: error from any source", () => {
	it("combine forwards error from a source", () => {
		const a = state(1);
		const b = errorableProducer(2);
		const c = combine(a, b.store);

		// Use single raw observer (no subscribe) to ensure we get the END
		let ended = false;
		let endErr: unknown;
		c.source(START, (type: number, d: any) => {
			if (type === START) return;
			if (type === END) {
				ended = true;
				endErr = d;
			}
		});

		b.error("combine-err");

		expect(ended).toBe(true);
		expect(endErr).toBe("combine-err");
	});
});

// ===========================================================================
// 9. Diamond through merge
// ===========================================================================

describe("diamond through merge", () => {
	it("merge emits from both branches when a diamond source changes", () => {
		const a = state(1);
		const b = pipe(
			a,
			map((v: number) => v * 2),
		);
		const c = pipe(
			a,
			map((v: number) => v * 3),
		);
		const m = merge(b, c);
		const values: number[] = [];
		subscribe(m, (v) => values.push(v));

		a.set(2);
		// merge emits immediately on each DATA — both branches fire
		expect(values).toContain(4);
		expect(values).toContain(6);
		expect(values.length).toBe(2);
	});

	it("merge sends single DIRTY for diamond, two DATAs", () => {
		const a = state(1);
		const b = pipe(
			a,
			map((v: number) => v * 2),
		);
		const c = pipe(
			a,
			map((v: number) => v * 3),
		);
		const m = merge(b, c);

		const obs = observeRaw(m);
		a.set(2);

		// One DIRTY (from first dep that dirties), two DATAs
		const dirtyCount = obs.signals.filter((s) => s === DIRTY).length;
		expect(dirtyCount).toBe(1);
		expect(obs.data.length).toBe(2);
	});
});

// ===========================================================================
// 10. take + filter interaction
// ===========================================================================

describe("take + filter interaction", () => {
	it("take counts only values that pass through filter", () => {
		const s = state(0);
		const t = pipe(
			s,
			filter((v: number) => v > 5),
			take(2),
		);
		const values: number[] = [];
		subscribe(t, (v) => values.push(v));

		s.set(1); // filtered out
		s.set(2); // filtered out
		s.set(6); // passes → take count 1
		s.set(3); // filtered out
		s.set(7); // passes → take count 2 → complete

		expect(values).toEqual([6, 7]);
	});

	it("take completes after n filtered values", () => {
		const s = state(0);
		const t = pipe(
			s,
			filter((v: number) => v % 2 === 0),
			take(1),
		);
		const obs = observeRaw(t);
		subscribe(t, () => {});

		s.set(1); // odd, filtered
		s.set(2); // even, passes → take completes

		expect(obs.data).toContain(2);
		expect(obs.ended).toBe(true);
	});
});

// ===========================================================================
// 11. skip edge cases
// ===========================================================================

describe("skip: reconnect resets counter", () => {
	it("counter resets when all subscribers leave and rejoin", () => {
		const s = state(0);
		const sk = pipe(s, skip(2));
		const values1: number[] = [];

		const unsub = subscribe(sk, (v) => values1.push(v));

		s.set(1); // skip (emissionCount=1)
		s.set(2); // skip (emissionCount=2)
		s.set(3); // emitted (emissionCount=3 > 2)
		expect(values1).toEqual([3]);

		unsub();

		// Reconnect — operator._init re-runs, emissionCount resets to 0
		const values2: number[] = [];
		subscribe(sk, (v) => values2.push(v));

		s.set(4); // skip again (emissionCount=1)
		s.set(5); // skip (emissionCount=2)
		s.set(6); // emitted (emissionCount=3 > 2)

		expect(values2).toEqual([6]);
	});
});

describe("skip: upstream completion/error", () => {
	it("forwards completion from upstream during skip phase", () => {
		const s = errorableProducer(0);
		const sk = pipe(s.store, skip(100));

		let ended = false;
		sk.source(START, (type: number, d: any) => {
			if (type === START) return;
			if (type === END) ended = true;
		});

		s.complete();
		expect(ended).toBe(true);
	});

	it("forwards error from upstream during skip phase", () => {
		const s = errorableProducer(0);
		const sk = pipe(s.store, skip(100));

		let ended = false;
		let endErr: unknown;
		sk.source(START, (type: number, d: any) => {
			if (type === START) return;
			if (type === END) {
				ended = true;
				endErr = d;
			}
		});

		s.error("oops");
		expect(ended).toBe(true);
		expect(endErr).toBe("oops");
	});
});

// ===========================================================================
// 12. take: error forwarding
// ===========================================================================

describe("take: error forwarding", () => {
	it("take forwards error from upstream", () => {
		const s = errorableProducer(1);
		const t = pipe(s.store, take(5));

		let ended = false;
		let endErr: unknown;
		t.source(START, (type: number, d: any) => {
			if (type === START) return;
			if (type === END) {
				ended = true;
				endErr = d;
			}
		});

		s.error("take-err");
		expect(ended).toBe(true);
		expect(endErr).toBe("take-err");
	});
});

// ===========================================================================
// 13. Completed store rejects new subscriptions with END
// ===========================================================================

describe("completed store rejects new subscriptions with END", () => {
	it("take: subscribing after completion receives immediate END", () => {
		const s = state(0);
		const t = pipe(s, take(1));
		subscribe(t, () => {});

		s.set(1); // take(1) completes

		const obs = observeRaw(t);
		expect(obs.ended).toBe(true);
		expect(obs.data).toEqual([]);
	});

	it("producer: subscribing after completion receives immediate END", () => {
		const s = errorableProducer(1);
		subscribe(s.store, () => {});
		s.complete();

		const obs = observeRaw(s.store);
		expect(obs.ended).toBe(true);
	});
});

// ===========================================================================
// 14. rapid switchMap inner switches
// ===========================================================================

describe("rapid switchMap inner switches", () => {
	it("only the last inner subscription survives after rapid switches", () => {
		const outer = state(1);
		const inners: Record<number, ReturnType<typeof state<number>>> = {};

		const sm = pipe(
			outer,
			switchMap((v) => {
				const inner = state(v * 10);
				inners[v] = inner;
				return inner;
			}),
		);

		subscribe(sm, () => {});

		// Rapid switches
		outer.set(2); // switch to inner2
		outer.set(3); // switch to inner3
		outer.set(4); // switch to inner4

		const values: number[] = [];
		subscribe(sm, (v) => values.push(v));

		// Only inner4 should be connected
		inners[2]?.set(999);
		inners[3]?.set(888);
		inners[4]?.set(777);

		// Only inner4's change should propagate
		expect(values).toEqual([777]);
	});
});

// ===========================================================================
// 15. concatMap: queue and sequential processing
// ===========================================================================

describe("concatMap: queue and sequential processing", () => {
	it("queues outer values while inner is active", () => {
		const outer = state("a");

		const processed: string[] = [];
		const cm = pipe(
			outer,
			concatMap((v) => {
				processed.push(v);
				return state(`inner-${v}`);
			}),
		);

		subscribe(cm, () => {});

		// Initial inner is created for "a".
		// State-based inners never complete (no END), so all subsequent
		// outer values get queued but never processed.
		outer.set("b");
		outer.set("c");

		// Only the initial inner was processed
		expect(processed).toEqual(["a"]);
		expect(cm.get()).toBe("inner-a");
	});
});

// ===========================================================================
// 16. exhaustMap: ignores outer while inner active
// ===========================================================================

describe("exhaustMap: ignores outer values while inner active", () => {
	it("drops outer values emitted while inner is active", () => {
		const outer = state("a");

		const processed: string[] = [];
		const em = pipe(
			outer,
			exhaustMap((v) => {
				processed.push(v);
				return state(`inner-${v}`);
			}),
		);

		subscribe(em, () => {});

		// Initial inner for "a" is active (never completes).
		// All subsequent outer values are dropped.
		outer.set("b");
		outer.set("c");

		expect(processed).toEqual(["a"]);
		expect(em.get()).toBe("inner-a");
	});
});

// ===========================================================================
// 17. Miscellaneous edge cases
// ===========================================================================

describe("batch: multiple state changes in diamond", () => {
	it("batch coalesces multiple state changes to single derived update", () => {
		const a = state(1);
		const b = state(10);
		const c = derived([a, b], () => a.get() + b.get());
		const values: number[] = [];
		subscribe(c, (v) => values.push(v));

		batch(() => {
			a.set(2);
			b.set(20);
			a.set(3);
			b.set(30);
		});

		// Batch coalesces: only the final values (a=3, b=30) produce one emission
		expect(values).toEqual([33]);
	});
});

describe("derived: diamond with three levels", () => {
	it("deeply nested diamond resolves correctly", () => {
		const s = state(1);
		const a = derived([s], () => s.get() * 2);
		const b = derived([s], () => s.get() * 3);
		const c = derived([a, b], () => a.get() + b.get());
		const d = derived([s, c], () => s.get() + c.get());

		const values: number[] = [];
		subscribe(d, (v) => values.push(v));

		s.set(2);
		// a = 4, b = 6, c = 10, d = 2 + 10 = 12
		expect(d.get()).toBe(12);
		// Should only emit once (no glitch)
		expect(values).toEqual([12]);
	});
});

describe("filter + distinctUntilChanged equivalence", () => {
	it("filter does not deduplicate by default", () => {
		const s = state(1);
		const f = pipe(
			s,
			filter(() => true),
		);
		const obs = observeRaw(f);

		s.set(1); // same value but state deduplicates...
		// state uses Object.is, so set(1) when value is already 1 is a no-op
		expect(obs.data).toEqual([]);

		s.set(2);
		s.set(3);
		expect(obs.data).toEqual([2, 3]);
	});
});

describe("map: error forwarding", () => {
	it("map forwards error from upstream", () => {
		const s = errorableProducer(1);
		const m = pipe(
			s.store,
			map((v: number) => v * 2),
		);

		let ended = false;
		let endErr: unknown;
		m.source(START, (type: number, d: any) => {
			if (type === START) return;
			if (type === END) {
				ended = true;
				endErr = d;
			}
		});

		s.error("map-err");
		expect(ended).toBe(true);
		expect(endErr).toBe("map-err");
	});
});

// ===========================================================================
// 18. concat: error forwarding
//
// concat should forward errors from intermediate sources immediately,
// not silently move to the next source.
// ===========================================================================

describe("concat: error forwarding", () => {
	it("forwards error from intermediate source", () => {
		const a = errorableProducer(1);
		const b = state(2);
		const c = concat(a.store, b);
		const obs = observeRaw(c);

		a.error("concat-err");

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBe("concat-err");
		// Should NOT have subscribed to b
		expect(obs.data).toEqual([]);
	});

	it("completes after all sources complete cleanly", () => {
		const a = errorableProducer(1);
		const b = errorableProducer(2);
		const c = concat(a.store, b.store);
		const obs = observeRaw(c);
		const values: unknown[] = [];
		subscribe(c, (v) => values.push(v));

		a.emit(10);
		a.complete(); // moves to b
		b.emit(20);
		b.complete(); // all done

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});

	it("error from second source after first completes is forwarded", () => {
		const a = errorableProducer(1);
		const b = errorableProducer(2);
		const c = concat(a.store, b.store);
		const obs = observeRaw(c);
		subscribe(c, () => {});

		a.complete(); // moves to b
		b.error("second-err");

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBe("second-err");
	});
});

// ===========================================================================
// 19. bufferTime: upstream error/completion forwarding
//
// bufferTime should forward upstream errors (canceling timer) and flush
// remaining buffer on upstream completion before completing.
// ===========================================================================

describe("bufferTime: error/completion forwarding", () => {
	it("forwards upstream error and cancels timer", () => {
		const s = errorableProducer(0);
		const bt = pipe(s.store, bufferTime(1000));
		const obs = observeRaw(bt);
		subscribe(bt, () => {});

		s.emit(1);
		s.emit(2);
		s.error("buf-err");

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBe("buf-err");
		// Buffer was NOT flushed on error
		expect(obs.data).toEqual([]);
	});

	it("flushes remaining buffer on upstream completion", () => {
		const s = errorableProducer(0);
		const bt = pipe(s.store, bufferTime(1000));
		const values: unknown[] = [];
		const obs = observeRaw(bt);
		subscribe(bt, (v) => values.push(v));

		s.emit(1);
		s.emit(2);
		s.complete();

		// Buffer should be flushed synchronously on completion
		expect(values).toEqual([[1, 2]]);
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});

	it("completes immediately if buffer is empty on upstream completion", () => {
		const s = errorableProducer(0);
		const bt = pipe(s.store, bufferTime(1000));
		const obs = observeRaw(bt);
		subscribe(bt, () => {});

		s.complete();

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
		expect(obs.data).toEqual([]);
	});
});

// ===========================================================================
// 20. delay: upstream error/completion forwarding
//
// delay should cancel all pending timers on error, and wait for pending
// timers to flush on completion before completing.
// ===========================================================================

describe("delay: error/completion forwarding", () => {
	it("forwards upstream error and cancels pending timers", () => {
		const s = errorableProducer(0);
		const d = pipe(s.store, delay(100));
		const obs = observeRaw(d);
		const values: unknown[] = [];
		subscribe(d, (v) => values.push(v));

		s.emit(1);
		s.emit(2);
		s.error("delay-err");

		// Error cancels pending timers — values are NOT emitted
		vi.advanceTimersByTime(200);
		expect(values).toEqual([]);
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBe("delay-err");
	});

	it("completes after all pending delayed values are flushed", () => {
		const s = errorableProducer(0);
		const d = pipe(s.store, delay(100));
		const obs = observeRaw(d);
		const values: unknown[] = [];
		subscribe(d, (v) => values.push(v));

		s.emit(1);
		s.emit(2);
		s.complete();

		// Values are still pending
		expect(values).toEqual([]);
		expect(obs.ended).toBe(false);

		// After delay, values flush and then completion fires
		vi.advanceTimersByTime(100);
		expect(values).toEqual([1, 2]);
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});

	it("completes immediately if no pending timers on upstream completion", () => {
		const s = errorableProducer(0);
		const d = pipe(s.store, delay(100));
		const obs = observeRaw(d);
		subscribe(d, () => {});

		s.complete();

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});
});

// ===========================================================================
// 21. timeout: upstream error/completion forwarding
//
// timeout should clear its timer and forward upstream completion/error.
// ===========================================================================

describe("timeout: upstream error/completion forwarding", () => {
	it("forwards upstream completion and clears timeout timer", () => {
		const s = errorableProducer(1);
		const t = pipe(s.store, timeout(500));
		const obs = observeRaw(t);
		subscribe(t, () => {});

		s.complete();

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();

		// Timeout timer should be cleared — advancing time should NOT error
		vi.advanceTimersByTime(1000);
		// No additional END should fire
	});

	it("forwards upstream error and clears timeout timer", () => {
		const s = errorableProducer(1);
		const t = pipe(s.store, timeout(500));
		const obs = observeRaw(t);
		subscribe(t, () => {});

		s.error("upstream-err");

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBe("upstream-err");
	});

	it("still fires TimeoutError when source is too slow", () => {
		const s = errorableProducer(1);
		const t = pipe(s.store, timeout(100));
		const obs = observeRaw(t);
		subscribe(t, () => {});

		vi.advanceTimersByTime(101);

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeInstanceOf(TimeoutError);
	});

	it("resets timer on each emission", () => {
		const s = errorableProducer(1);
		const t = pipe(s.store, timeout(100));
		const obs = observeRaw(t);
		subscribe(t, () => {});

		vi.advanceTimersByTime(80);
		s.emit(2); // resets timer
		vi.advanceTimersByTime(80);
		// 80ms since last emit — still within window
		expect(obs.ended).toBe(false);

		vi.advanceTimersByTime(30);
		// 110ms since last emit — timeout fires
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeInstanceOf(TimeoutError);
	});
});

// ===========================================================================
// 22. sample: notifier error/completion forwarding
//
// sample should forward errors from notifier and complete when notifier
// completes.
// ===========================================================================

describe("sample: notifier error/completion forwarding", () => {
	it("forwards error from notifier", () => {
		const input = state(1);
		const notifier = errorableProducer(0);
		const s = pipe(input, sample(notifier.store));
		const obs = observeRaw(s);
		subscribe(s, () => {});

		notifier.error("notifier-err");

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBe("notifier-err");
	});

	it("completes when notifier completes", () => {
		const input = state(1);
		const notifier = errorableProducer(0);
		const s = pipe(input, sample(notifier.store));
		const obs = observeRaw(s);
		subscribe(s, () => {});

		notifier.complete();

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});

	it("forwards error from input source", () => {
		const input = errorableProducer(1);
		const notifier = state(0);
		const s = pipe(input.store, sample(notifier));
		const obs = observeRaw(s);
		subscribe(s, () => {});

		input.error("input-err");

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBe("input-err");
	});

	it("emits sampled value when notifier fires", () => {
		const input = state(1);
		const notifier = state(0);
		const s = pipe(input, sample(notifier));
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		input.set(10);
		notifier.set(1); // sample fires → emit 10

		input.set(20);
		input.set(30);
		notifier.set(2); // sample fires → emit 30

		expect(values).toEqual([10, 30]);
	});
});
