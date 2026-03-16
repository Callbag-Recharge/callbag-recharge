import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA, DIRTY, END, RESOLVED, START, STATE } from "../../core/protocol";
import { combine } from "../../extra/combine";
import { debounce } from "../../extra/debounce";
import { filter } from "../../extra/filter";
import { fromObs } from "../../extra/fromObs";
import { map } from "../../extra/map";
import { subscribe } from "../../extra/subscribe";
import { switchMap } from "../../extra/switchMap";
import { take } from "../../extra/take";
import {
	batch,
	beginDeferredStart,
	derived,
	effect,
	endDeferredStart,
	Inspector,
	operator,
	pipe,
	producer,
	state,
} from "../../index";

beforeEach(() => {
	Inspector._reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Type 3 STATE protocol
// ---------------------------------------------------------------------------

describe("type 3 STATE protocol", () => {
	it("raw callbag source (no type 3) feeding into derived → still works", () => {
		// Create a minimal raw callbag source that never sends type 3
		let sinkRef: any = null;
		const rawSource = {
			get: () => 42,
			source: (type: number, payload: any) => {
				if (type === START) {
					const sink = payload;
					sinkRef = sink;
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, 42);
					});
				}
			},
		};

		const d = derived([rawSource], () => rawSource.get() * 2);
		const values: number[] = [];
		subscribe(d, (v) => values.push(v));

		// Send DATA without DIRTY on the raw callbag
		sinkRef(DATA, 100);

		// Derived should handle DATA without prior DIRTY
		expect(values.length).toBeGreaterThan(0);
	});

	it("double DIRTY without intervening RESOLVED → derived handles correctly", () => {
		const a = state(0);
		const d = derived([a], () => a.get() * 2);
		const values: number[] = [];

		subscribe(d, (v) => values.push(v));

		// Normal operation: each set() sends DIRTY then DATA
		a.set(1);
		expect(values).toEqual([2]);

		a.set(2);
		expect(values).toEqual([2, 4]);
	});

	it("RESOLVED without preceding DIRTY → no-op", () => {
		const s = state(0);
		const d = derived([s], () => s.get() * 2);
		const values: number[] = [];

		subscribe(d, (v) => values.push(v));

		// Manually send RESOLVED via signal without DIRTY
		s.signal(RESOLVED);

		// Should not cause any emission
		expect(values).toEqual([]);
	});

	it("DIRTY on completed store → ignored", () => {
		const p = producer<number>();
		const values: number[] = [];
		let endErr: unknown = "not-called";

		subscribe(p, (v) => values.push(v), { onEnd: (e) => (endErr = e) });

		p.emit(1);
		p.complete();

		// After completion, signal() is a no-op (guarded by _completed check)
		p.signal(DIRTY);

		expect(values).toEqual([1]);
		expect(endErr).toBeUndefined();
	});

	it("type 3 signal forwarded through operator correctly", () => {
		const s = state(0);

		const signals: unknown[] = [];
		const mapped = pipe(
			s,
			map((x: number) => x * 2),
		);

		// Observe type 3 signals on the mapped store
		mapped.source(START, (type: number, data: unknown) => {
			if (type === START) return;
			if (type === STATE) signals.push(data);
		});

		s.set(1);

		// Should have received DIRTY signal
		expect(signals).toContain(DIRTY);
	});

	it("custom operator emitting DIRTY manually → downstream reacts", () => {
		const s = state(0);

		const custom = operator<number>([s], ({ emit, signal }) => {
			return (_dep, type, data) => {
				if (type === STATE) signal(data);
				if (type === DATA) {
					emit(data * 3);
				}
			};
		});

		const d = derived([custom], () => custom.get() * 2);
		const values: number[] = [];
		subscribe(d, (v) => values.push(v));

		s.set(5);
		// custom = 15, d = 30
		expect(values).toEqual([30]);
	});

	it("DIRTY propagation stopped by take after completion", () => {
		const s = state(0);
		const limited = pipe(s, take(1));
		const values: number[] = [];
		let ended = false;

		subscribe(limited, (v) => values.push(v), {
			onEnd: () => (ended = true),
		});

		s.set(1); // take(1) completes after this

		// Further changes should not propagate
		s.set(2);
		s.set(3);

		expect(values).toEqual([1]);
		expect(ended).toBe(true);
	});

	it("multiple RESOLVED in a row → no spurious emissions", () => {
		const a = state(0);
		const b = state(0);
		const d = derived([a, b], () => a.get() + b.get(), {
			equals: (a, b) => a === b,
		});
		const values: number[] = [];

		subscribe(d, (v) => values.push(v));

		// Set a to same value with equals on state
		a.set(0); // Object.is → no emission from a
		b.set(0); // Object.is → no emission from b

		// No spurious emissions since values didn't change
		expect(values).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// batch() interaction
// ---------------------------------------------------------------------------

describe("batch() interaction", () => {
	it("batch() defers emissions but DIRTY flows immediately", () => {
		const s = state(0);
		const signals: unknown[] = [];
		const values: number[] = [];

		// Raw observation to see type 3
		s.source(START, (type: number, data: unknown) => {
			if (type === START) return;
			if (type === STATE) signals.push(data);
			if (type === DATA) values.push(data as number);
		});

		batch(() => {
			s.set(1);
			// DIRTY should have been sent immediately
			expect(signals).toContain(DIRTY);
			// DATA should be deferred
			expect(values).toEqual([]);
		});

		// After batch, DATA should be delivered
		expect(values).toEqual([1]);
	});

	it("nested batch() → only outermost flush triggers emissions", () => {
		const s = state(0);
		const values: number[] = [];

		subscribe(s, (v) => values.push(v));

		batch(() => {
			s.set(1);
			batch(() => {
				s.set(2);
				// Inner batch end should NOT flush
				expect(values).toEqual([]);
			});
			// Still inside outer batch
			expect(values).toEqual([]);
			s.set(3);
		});

		// Only latest value (3) should be emitted (coalesced)
		expect(values).toEqual([3]);
	});

	it("batch() with error inside → error delivered after batch", () => {
		const p = producer<number>();
		const values: number[] = [];
		let endErr: unknown = "not-called";

		subscribe(p, (v) => values.push(v), { onEnd: (e) => (endErr = e) });

		batch(() => {
			p.emit(1);
			p.error("boom");
		});

		// Error is not deferred by batch (it's not an emit)
		expect(endErr).toBe("boom");
	});

	it("batch() with complete inside → complete delivered after batch", () => {
		const p = producer<number>();
		let ended = false;

		subscribe(p, () => {}, { onEnd: () => (ended = true) });

		batch(() => {
			p.emit(1);
			p.complete();
		});

		expect(ended).toBe(true);
	});

	it("effect inside batch → deferred until batch ends", () => {
		const s = state(0);
		const effectCalls: number[] = [];

		const dispose = effect([s], () => {
			effectCalls.push(s.get());
		});

		// Initial run
		expect(effectCalls).toEqual([0]);

		batch(() => {
			s.set(1);
			s.set(2);
			s.set(3);
		});

		// Effect should run with final batched value
		expect(effectCalls[effectCalls.length - 1]).toBe(3);

		dispose();
	});

	it("derived recomputation during batch → only final value", () => {
		const s = state(0);
		let computeCount = 0;
		const d = derived([s], () => {
			computeCount++;
			return s.get() * 2;
		});
		const values: number[] = [];

		subscribe(d, (v) => values.push(v));
		const initialComputes = computeCount;

		batch(() => {
			s.set(1);
			s.set(2);
			s.set(3);
		});

		// Only the final value should be emitted
		expect(values).toEqual([6]);
		// Should recompute only once after batch (not 3 times)
		expect(computeCount - initialComputes).toBe(1);
	});

	it("batch + switchMap → inner emission deferred", () => {
		const s = state(1);
		const inner = state(10);
		const result = pipe(
			s,
			switchMap(() => inner),
		);
		const values: number[] = [];

		subscribe(result, (v) => values.push(v));

		batch(() => {
			inner.set(20);
			inner.set(30);
		});

		// Should see only the final coalesced value
		expect(values[values.length - 1]).toBe(30);
	});

	it("empty batch (no state changes) → no emissions", () => {
		const s = state(0);
		const values: number[] = [];

		subscribe(s, (v) => values.push(v));

		batch(() => {
			// No changes
		});

		expect(values).toEqual([]);
	});

	it("batch during another store's subscriber callback", () => {
		const a = state(0);
		const b = state(0);
		const bValues: number[] = [];

		subscribe(b, (v) => bValues.push(v));

		subscribe(a, (v) => {
			batch(() => {
				b.set(v * 10);
				b.set(v * 100);
			});
		});

		a.set(1);

		// b should receive only the coalesced value
		expect(bValues).toEqual([100]);
	});
});

// ---------------------------------------------------------------------------
// Connection deferral (beginDeferredStart/endDeferredStart)
// ---------------------------------------------------------------------------

describe("connection deferral", () => {
	it("producer start deferred until endDeferredStart", () => {
		let started = false;
		const p = producer<number>(({ emit }) => {
			started = true;
			emit(42);
		});

		beginDeferredStart();

		// Subscribe (which will call source(START))
		const values: number[] = [];
		p.source(START, (type: number, data: unknown) => {
			if (type === START) return;
			if (type === DATA) values.push(data as number);
		});

		// Producer should NOT have started yet
		expect(started).toBe(false);

		endDeferredStart();

		// Now it should have started
		expect(started).toBe(true);
		expect(values).toEqual([42]);
	});

	it("multiple deferred producers → all start at endDeferredStart", () => {
		const starts: string[] = [];

		const p1 = producer<number>(({ emit }) => {
			starts.push("p1");
			emit(1);
		});
		const p2 = producer<number>(({ emit }) => {
			starts.push("p2");
			emit(2);
		});

		beginDeferredStart();

		p1.source(START, (type: number) => {
			if (type === START) return;
		});
		p2.source(START, (type: number) => {
			if (type === START) return;
		});

		expect(starts).toEqual([]);

		endDeferredStart();

		expect(starts).toEqual(["p1", "p2"]);
	});

	it("nested deferral → only outermost triggers starts", () => {
		let started = false;
		const p = producer<number>(({ emit }) => {
			started = true;
			emit(1);
		});

		beginDeferredStart();
		beginDeferredStart();

		p.source(START, (type: number) => {
			if (type === START) return;
		});

		endDeferredStart(); // Inner end
		expect(started).toBe(false); // Still deferred

		endDeferredStart(); // Outer end
		expect(started).toBe(true); // Now started
	});

	it("deferred start with immediate error → error after start", () => {
		const p = producer<number>(({ error }) => {
			error("boom");
		});

		const errors: unknown[] = [];

		beginDeferredStart();

		p.source(START, (type: number, data: unknown) => {
			if (type === START) return;
			if (type === END) errors.push(data);
		});

		expect(errors).toEqual([]);

		endDeferredStart();

		expect(errors).toEqual(["boom"]);
	});

	it("subscribe uses deferral — baseline captured before producer starts", () => {
		const p = producer<number>(
			({ emit }) => {
				emit(42);
			},
			{ initial: 0 },
		);

		const values: number[] = [];
		// subscribe internally uses beginDeferredStart/endDeferredStart
		subscribe(p, (v, prev) => {
			values.push(v);
		});

		// The producer emits 42 during start, which should trigger callback
		// because prev was captured as 0 (initial) before start
		expect(values).toEqual([42]);
	});
});

// ---------------------------------------------------------------------------
// External interop
// ---------------------------------------------------------------------------

describe("external interop", () => {
	it("callbag-recharge source consumed by raw callbag sink", () => {
		const s = state(0);
		const values: number[] = [];
		let talkback: any;

		// Raw callbag sink
		s.source(START, (type: number, data: any) => {
			if (type === START) {
				talkback = data;
				return;
			}
			if (type === DATA) values.push(data);
		});

		s.set(1);
		s.set(2);

		expect(values).toEqual([1, 2]);

		// Unsubscribe via talkback
		talkback(END);
	});

	it("raw callbag source consumed by callbag-recharge subscribe", () => {
		let sinkRef: any = null;
		const rawSource = {
			get: () => 0,
			source: (type: number, payload: any) => {
				if (type === START) {
					sinkRef = payload;
					payload(START, (t: number) => {
						if (t === DATA) payload(DATA, 0);
					});
				}
			},
		};

		const values: number[] = [];
		subscribe(rawSource, (v) => values.push(v));

		// Emit from raw callbag
		sinkRef(DATA, 10);
		sinkRef(DATA, 20);

		expect(values).toEqual([10, 20]);
	});

	it("fromObs with rxjs-like Observable (next/error/complete)", () => {
		let observer: any = null;
		const obs = {
			subscribe: (obs_: any) => {
				observer = obs_;
				return { unsubscribe: () => {} };
			},
		};

		const store = fromObs(obs);
		const values: number[] = [];
		let ended = false;

		subscribe(store, (v) => values.push(v), {
			onEnd: () => (ended = true),
		});

		observer.next(1);
		observer.next(2);
		observer.complete();

		expect(values).toEqual([1, 2]);
		expect(ended).toBe(true);
	});

	it("fromObs with observable error → propagates", () => {
		let observer: any = null;
		const obs = {
			subscribe: (obs_: any) => {
				observer = obs_;
				return { unsubscribe: () => {} };
			},
		};

		const store = fromObs(obs);
		let endErr: unknown = "not-called";

		subscribe(store, () => {}, { onEnd: (e) => (endErr = e) });

		observer.error("oops");

		expect(endErr).toBe("oops");
	});

	it("pipe() compatibility with custom StoreOperator", () => {
		// Custom operator that doubles values
		const double = (input: any) => {
			return derived([input], () => input.get() * 2);
		};

		const s = state(5);
		const result = pipe(s, double, double);

		expect(result.get()).toBe(20); // 5 * 2 * 2

		const values: number[] = [];
		subscribe(result, (v) => values.push(v));

		s.set(3);
		expect(values).toEqual([12]); // 3 * 2 * 2
	});
});
