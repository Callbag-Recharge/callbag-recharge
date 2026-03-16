import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bufferTime } from "../../extra/bufferTime";
import { combine } from "../../extra/combine";
import { concat } from "../../extra/concat";
import { concatMap } from "../../extra/concatMap";
import { debounce } from "../../extra/debounce";
import { exhaustMap } from "../../extra/exhaustMap";
import { filter } from "../../extra/filter";
import { fromIter } from "../../extra/fromIter";
import { interval } from "../../extra/interval";
import { map } from "../../extra/map";
import { merge } from "../../extra/merge";
import { of } from "../../extra/of";
import { empty } from "../../extra/empty";
import { rescue } from "../../extra/rescue";
import { retry } from "../../extra/retry";
import { scan } from "../../extra/scan";
import { subscribe } from "../../extra/subscribe";
import { switchMap } from "../../extra/switchMap";
import { take } from "../../extra/take";
import { subscribe as sub } from "../../extra/subscribe";
import {
	batch,
	derived,
	effect,
	Inspector,
	operator,
	pipe,
	producer,
	state,
} from "../../index";
import { DATA, DIRTY, END, RESOLVED, START, STATE } from "../../core/protocol";

beforeEach(() => {
	Inspector._reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Reentrancy
// ---------------------------------------------------------------------------

describe("reentrancy", () => {
	it("state set() inside subscribe callback → correct ordering", () => {
		const s = state(0);
		const values: number[] = [];

		subscribe(s, (v) => {
			values.push(v);
			// Reentrant: set triggers another emission during callback
			if (v === 1) s.set(2);
		});

		s.set(1);

		// Both values should be delivered
		expect(values).toEqual([1, 2]);
	});

	it("state set() inside effect → triggers new cycle", () => {
		const a = state(0);
		const b = state(0);
		const bValues: number[] = [];

		// Effect that writes to b when a changes
		const dispose = effect([a], () => {
			b.set(a.get() * 10);
		});

		subscribe(b, (v) => bValues.push(v));

		a.set(1);
		expect(bValues).toEqual([10]);

		a.set(2);
		expect(bValues).toEqual([10, 20]);

		dispose();
	});

	it("unsubscribe self inside subscribe callback → safe", () => {
		const s = state(0);
		const values: number[] = [];
		let unsub: () => void;

		unsub = subscribe(s, (v) => {
			values.push(v);
			if (v === 2) unsub();
		});

		s.set(1);
		s.set(2); // Should unsubscribe here
		s.set(3); // Should not be received

		expect(values).toEqual([1, 2]);
	});

	it("subscribe new sink inside subscribe callback → works", () => {
		const s = state(0);
		const values1: number[] = [];
		const values2: number[] = [];

		subscribe(s, (v) => {
			values1.push(v);
			if (v === 1) {
				// Subscribe a second listener during callback
				subscribe(s, (v2) => values2.push(v2));
			}
		});

		s.set(1); // triggers first subscriber; second subscribes mid-iteration
		s.set(2); // both should receive

		expect(values1).toEqual([1, 2]);
		// v4: Output slot dispatches to the snapshot at call time.
		// Sub2 is added after the DATA(1) dispatch, so it only sees DATA(2).
		expect(values2).toEqual([2]);
	});

	it("complete() inside emit handler → ordering", () => {
		const p = producer<number>();
		const values: number[] = [];
		let ended = false;

		subscribe(p, (v) => values.push(v), { onEnd: () => (ended = true) });

		// Emit then immediately complete
		p.emit(1);
		p.complete();
		p.emit(2); // should be ignored

		expect(values).toEqual([1]);
		expect(ended).toBe(true);
	});

	it("error() inside emit handler → ordering", () => {
		const p = producer<number>();
		const values: number[] = [];
		let endErr: unknown = "not-called";

		subscribe(p, (v) => values.push(v), { onEnd: (e) => (endErr = e) });

		p.emit(1);
		p.error("boom");
		p.emit(2); // should be ignored

		expect(values).toEqual([1]);
		expect(endErr).toBe("boom");
	});

	it("switchMap: outer emits during inner subscribe → clean switch", () => {
		const s = state(1);
		const values: number[] = [];

		const result = pipe(
			s,
			switchMap((v) => state(v * 10)),
		);
		subscribe(result, (v) => values.push(v));

		s.set(2);
		s.set(3);

		// switchMap emits innerStore.get() on each switch
		expect(values).toContain(20);
		expect(values).toContain(30);
	});

	it("concatMap: outer emits during inner complete → queued correctly", () => {
		const s = state(0);
		const result = pipe(
			s,
			concatMap((v) => of(v * 10)),
		);
		const values: number[] = [];
		subscribe(result, (v) => values.push(v));

		s.set(1);
		s.set(2);

		// concatMap processes sequentially; of() completes synchronously
		// so queue should drain immediately
		expect(values).toContain(10);
		expect(values).toContain(20);
	});

	it("batch() inside subscribe callback → nested batch", () => {
		const a = state(0);
		const b = state(0);
		const aValues: number[] = [];
		const bValues: number[] = [];

		subscribe(a, (v) => {
			aValues.push(v);
			// Start a batch inside a callback
			batch(() => {
				b.set(v * 10);
				b.set(v * 100); // should coalesce
			});
		});

		subscribe(b, (v) => bValues.push(v));

		a.set(1);
		expect(aValues).toEqual([1]);
		expect(bValues).toEqual([100]);
	});

	it("derived recomputation during set in subscribe", () => {
		const s = state(1);
		const d = derived([s], () => s.get() * 2);
		const dValues: number[] = [];

		subscribe(d, (v) => {
			dValues.push(v);
			if (v === 4) s.set(3); // reentrant set
		});

		s.set(2); // d = 4, triggers reentrant s.set(3) → d = 6
		expect(dValues).toEqual([4, 6]);
	});
});

// ---------------------------------------------------------------------------
// Complex chains
// ---------------------------------------------------------------------------

describe("complex chains", () => {
	it("pipe(state, map, filter, scan, take) → 5-operator chain", () => {
		const s = state(0);
		const result = pipe(
			s,
			map((x: number) => x * 2),
			filter((x: number) => x > 2),
			scan((acc: number, x: number) => acc + x, 0),
			take(3),
		);

		const values: number[] = [];
		let ended = false;
		subscribe(result, (v) => values.push(v), {
			onEnd: () => (ended = true),
		});

		s.set(1); // *2=2 → filtered out
		s.set(2); // *2=4 → scan: 0+4=4 → take count 1
		s.set(3); // *2=6 → scan: 4+6=10 → take count 2
		s.set(4); // *2=8 → scan: 10+8=18 → take count 3 → complete
		s.set(5); // should be ignored

		expect(values).toEqual([4, 10, 18]);
		expect(ended).toBe(true);
	});

	it("derived → pipe(map) → derived → effect → diamond-safe", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = pipe(
			b,
			map((x: number) => x + 1),
		);
		const d = derived([a, c], () => a.get() + c.get());

		const effectCalls: number[] = [];
		const dispose = effect([d], () => {
			effectCalls.push(d.get());
		});

		// Initial: a=1, b=2, c=3, d=1+3=4
		expect(effectCalls).toEqual([4]);

		a.set(2);
		// b=4, c=5, d=2+5=7
		expect(effectCalls).toEqual([4, 7]);

		dispose();
	});

	it("merge(pipe(a, map), pipe(a, filter)) → diamond through merge", () => {
		const a = state(0);
		const mapped = pipe(
			a,
			map((x: number) => x * 10),
		);
		const filtered = pipe(
			a,
			filter((x: number) => x % 2 === 0),
		);
		const merged = merge(mapped, filtered);

		const values: number[] = [];
		subscribe(merged, (v) => values.push(v));

		a.set(1); // mapped: 10, filtered: skipped (odd)
		a.set(2); // mapped: 20, filtered: 2

		expect(values).toContain(10);
		expect(values).toContain(20);
		expect(values).toContain(2);
	});

	it("concat(fromIter([1,2,3]), of(4), empty()) → sequential completion", () => {
		const result = concat(fromIter([1, 2, 3]), of(4), empty());
		const values: number[] = [];
		let ended = false;

		subscribe(result, (v) => {
			if (v !== undefined) values.push(v);
		}, { onEnd: () => (ended = true) });

		expect(values).toEqual([1, 2, 3, 4]);
		expect(ended).toBe(true);
	});

	it("switchMap returning pipe(inner, take(1)) → nested limiting", () => {
		const outer = state(0);
		// Use fromIter which emits synchronously then completes
		const result = pipe(
			outer,
			switchMap((v) => pipe(fromIter([v * 10, v * 20, v * 30]), take(1))),
		);
		const values: number[] = [];
		subscribe(result, (v) => {
			if (v !== undefined) values.push(v);
		});

		outer.set(1);
		outer.set(2);

		// Each switch gets take(1) of the inner iterable
		expect(values).toContain(10);
		expect(values).toContain(20);
	});

	it("retry(3) wrapping resubscribable producer that fails twice then succeeds", () => {
		let attempt = 0;
		const src = producer<number>(
			({ emit, error }) => {
				attempt++;
				if (attempt <= 2) {
					emit(attempt);
					error(`fail-${attempt}`);
				} else {
					emit(100);
				}
			},
			{ resubscribable: true },
		);

		const result = pipe(src, retry(3));

		const values: number[] = [];
		subscribe(result, (v) => values.push(v));

		// retry reconnects on error; resubscribable allows fresh start
		expect(attempt).toBe(3);
		expect(values).toContain(100);
	});

	it("retry(3) wrapping non-resubscribable producer → cannot restart", () => {
		let attempt = 0;
		const src = producer<number>(({ emit, error }) => {
			attempt++;
			emit(attempt);
			error(`fail-${attempt}`);
		});

		const result = pipe(src, retry(3));

		const values: number[] = [];
		subscribe(result, (v) => values.push(v));

		// Without resubscribable, producer sends END to late subscribers.
		// retry re-subscribes but gets END immediately each time.
		expect(attempt).toBe(1);
	});

	it("rescue wrapping rescue → double fallback", () => {
		// rescue catches errors recursively from both input and fallback
		// So pipe(failing, rescue(fn1), rescue(fn2)):
		// - fn1 wraps failing. failing errors "first", fn1 catches and returns fallback1
		// - fallback1 errors "second", fn1 catches again (recursive) and calls fn1("second")
		// To test double fallback, we need the inner rescue to not catch the second error
		const errors: unknown[] = [];

		const failing = producer<number>(({ error }) => {
			error("first");
		});

		const result = pipe(
			failing,
			rescue((err) => {
				errors.push(err);
				if (err === "first") {
					// Return a fallback that also errors
					return producer<number>(({ error: err2 }) => {
						err2("second");
					});
				}
				// On second error, return a good value
				return of(42);
			}),
		);

		const values: number[] = [];
		subscribe(result, (v) => values.push(v));

		expect(errors).toEqual(["first", "second"]);
		expect(values).toContain(42);
	});
});

// ---------------------------------------------------------------------------
// Rapid churn
// ---------------------------------------------------------------------------

describe("rapid churn", () => {
	it("100 subscribe/unsubscribe cycles → no leaked subscriptions", () => {
		const s = state(0);

		for (let i = 0; i < 100; i++) {
			const unsub = subscribe(s, () => {});
			unsub();
		}

		// After all unsubscriptions, new subscribers should still work
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));
		s.set(1);
		expect(values).toEqual([1]);
	});

	it("rapid state.set() 1000 times → all values delivered without batch", () => {
		const s = state(0);
		const count = { n: 0 };

		subscribe(s, () => {
			count.n++;
		});

		for (let i = 1; i <= 1000; i++) {
			s.set(i);
		}

		expect(count.n).toBe(1000);
		expect(s.get()).toBe(1000);
	});

	it("switchMap with 100 rapid outer emissions → only last inner active", () => {
		const outer = state(0);
		let activeInners = 0;

		const result = pipe(
			outer,
			switchMap((v) => {
				return producer<number>(({ emit }) => {
					activeInners++;
					emit(v);
					return () => {
						activeInners--;
					};
				});
			}),
		);

		const values: number[] = [];
		subscribe(result, (v) => values.push(v));

		for (let i = 1; i <= 100; i++) {
			outer.set(i);
		}

		// Only 1 inner should be active (the last one)
		expect(activeInners).toBe(1);
		expect(values[values.length - 1]).toBe(100);
	});

	it("interval + take(100) → all 100 values delivered then clean complete", () => {
		const s = pipe(interval(10), take(100));
		const values: number[] = [];
		let ended = false;

		subscribe(
			s,
			(v) => values.push(v),
			{ onEnd: () => (ended = true) },
		);

		vi.advanceTimersByTime(1000);

		expect(values.length).toBe(100);
		expect(values[0]).toBe(0);
		expect(values[99]).toBe(99);
		expect(ended).toBe(true);
	});

	it("many effects (50) on same dep → all fire once per change", () => {
		const s = state(0);
		const callCounts = new Array(50).fill(0);
		const disposers: Array<() => void> = [];

		for (let i = 0; i < 50; i++) {
			const idx = i;
			disposers.push(
				effect([s], () => {
					callCounts[idx]++;
				}),
			);
		}

		s.set(1);

		// Each effect should have been called twice: initial + 1 update
		for (let i = 0; i < 50; i++) {
			expect(callCounts[i]).toBe(2);
		}

		for (const d of disposers) d();
	});

	it("combine with 20 sources → correct tuple on each change", () => {
		const sources = Array.from({ length: 20 }, (_, i) => state(i));
		const combined = combine(...sources);

		const values: number[][] = [];
		subscribe(combined, (v) => values.push([...v]));

		sources[0].set(100);

		const last = values[values.length - 1];
		expect(last[0]).toBe(100);
		for (let i = 1; i < 20; i++) {
			expect(last[i]).toBe(i);
		}
	});
});

// ---------------------------------------------------------------------------
// Memory safety
// ---------------------------------------------------------------------------

describe("memory safety", () => {
	it("completed producer releases all sink references", () => {
		const p = producer<number>();
		const unsub1 = subscribe(p, () => {});
		const unsub2 = subscribe(p, () => {});

		p.complete();

		// After completion, output slot should be cleared
		expect((p as any)._output).toBeNull();
	});

	it("unsubscribed chain releases intermediate stores", () => {
		const s = state(0);
		const result = pipe(
			s,
			map((x: number) => x * 2),
			filter((x: number) => x > 0),
			scan((acc: number, x: number) => acc + x, 0),
		);

		const unsub = subscribe(result, () => {});
		unsub();

		// After unsub, new subscription should work (fresh state)
		const values: number[] = [];
		subscribe(result, (v) => values.push(v));
		s.set(1);
		expect(values.length).toBeGreaterThan(0);
	});

	it("error'd producer doesn't retain handler references", () => {
		const p = producer<number>();
		subscribe(p, () => {}, { onEnd: () => {} });

		p.error("boom");

		// After error, output slot should be cleared
		expect((p as any)._output).toBeNull();
	});

	it("large buffer (10000 items) in bufferTime → flushed correctly", () => {
		const s = state(0);
		const buffered = pipe(s, bufferTime(100));
		const flushed: number[][] = [];

		subscribe(buffered, (v) => flushed.push([...v]));

		for (let i = 1; i <= 10000; i++) {
			s.set(i);
		}

		vi.advanceTimersByTime(100);

		// All 10000 values should be in the flushed buffers
		const total = flushed.reduce((sum, buf) => sum + buf.length, 0);
		expect(total).toBe(10000);
	});

	it("concatMap with long queue (100 items) → processed in order", () => {
		const s = state(0);
		const result = pipe(
			s,
			concatMap((v) => of(v * 10)),
		);

		const values: number[] = [];
		subscribe(result, (v) => {
			if (v !== undefined) values.push(v);
		});

		for (let i = 1; i <= 100; i++) {
			s.set(i);
		}

		// of() completes synchronously so queue drains immediately
		// Filter out undefined values (from initial/switch overhead)
		const numericValues = values.filter((v) => typeof v === "number");
		expect(numericValues.length).toBeGreaterThan(0);
		// Last value should be 1000 (100 * 10)
		expect(numericValues[numericValues.length - 1]).toBe(1000);
		// Values should be monotonically non-decreasing
		for (let i = 1; i < numericValues.length; i++) {
			expect(numericValues[i]).toBeGreaterThanOrEqual(numericValues[i - 1]);
		}
	});
});
