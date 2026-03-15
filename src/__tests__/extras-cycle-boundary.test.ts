import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { concatMap } from "../extra/concatMap";
import { debounce } from "../extra/debounce";
import { delay } from "../extra/delay";
import { exhaustMap } from "../extra/exhaustMap";
import { flat } from "../extra/flat";
import { rescue } from "../extra/rescue";
import { retry } from "../extra/retry";
import { sample } from "../extra/sample";
import { subscribe } from "../extra/subscribe";
import { switchMap } from "../extra/switchMap";
import { throttle } from "../extra/throttle";
import { derived, Inspector, pipe, state } from "../index";

beforeEach(() => {
	Inspector._reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tier 2 operators are cycle boundaries: each emission starts a new
// DIRTY+value cycle. They do NOT passthrough type 3 signals from upstream.
// In diamond topologies downstream of a tier 2 operator, the operator itself
// is the "source" of the cycle — one DIRTY, one value per emission.
// ---------------------------------------------------------------------------

describe("time-based operators are cycle boundaries", () => {
	it("debounce starts a fresh cycle per emission", () => {
		const s = state(0);
		const d = pipe(s, debounce(50));
		let computeCount = 0;
		const doubled = derived([d], () => {
			computeCount++;
			return (d.get() ?? 0) * 2;
		});
		subscribe(doubled, () => {});

		s.set(1);
		s.set(2);
		s.set(3);
		computeCount = 0;

		vi.advanceTimersByTime(50);
		// Only the debounced value (3) triggers one cycle → one compute
		expect(computeCount).toBe(1);
		expect(doubled.get()).toBe(6);
	});

	it("throttle starts a fresh cycle per emission", () => {
		const s = state(0);
		const t = pipe(s, throttle(100));
		let computeCount = 0;
		const doubled = derived([t], () => {
			computeCount++;
			return (t.get() ?? 0) * 2;
		});
		subscribe(doubled, () => {});
		computeCount = 0;

		s.set(1); // passes through (leading edge)
		expect(computeCount).toBe(1);
		expect(doubled.get()).toBe(2);

		s.set(2); // throttled
		s.set(3); // throttled
		expect(computeCount).toBe(1); // no additional computes
	});

	it("delay starts a fresh cycle per emission", () => {
		const s = state(0);
		const d = pipe(s, delay(100));
		let computeCount = 0;
		const doubled = derived([d], () => {
			computeCount++;
			return (d.get() ?? 0) * 2;
		});
		subscribe(doubled, () => {});
		computeCount = 0;

		s.set(1);
		s.set(2);
		expect(computeCount).toBe(0); // nothing emitted yet

		vi.advanceTimersByTime(100);
		expect(computeCount).toBe(2); // each delayed value triggers one cycle
		expect(doubled.get()).toBe(4);
	});

	it("sample starts a fresh cycle per emission", () => {
		vi.useRealTimers();
		const s = state(0);
		const notifier = state(false);
		const sampled = pipe(s, sample(notifier));
		let computeCount = 0;
		const doubled = derived([sampled], () => {
			computeCount++;
			return sampled.get() * 2;
		});
		subscribe(doubled, () => {});
		computeCount = 0;

		s.set(1);
		s.set(2);
		s.set(3);
		expect(computeCount).toBe(0); // sample hasn't fired

		notifier.set(true);
		expect(computeCount).toBe(1); // one cycle from sample
		expect(doubled.get()).toBe(6);
	});
});

describe("dynamic subscription operators are cycle boundaries", () => {
	it("switchMap does not passthrough upstream type 3 signals", () => {
		const a = state(1);
		const b = state(10);
		// switchMap subscribes to inner — it's a cycle boundary
		const mapped = pipe(
			a,
			switchMap(() => b),
		);
		let computeCount = 0;
		const result = derived([mapped], () => {
			computeCount++;
			return (mapped.get() ?? 0) + 1;
		});
		subscribe(result, () => {});
		computeCount = 0;

		b.set(20);
		expect(computeCount).toBe(1);
		expect(result.get()).toBe(21);
	});

	it("flat does not passthrough upstream type 3 signals", () => {
		const inner = state(1);
		const outer = state<typeof inner | undefined>(inner);
		const f = pipe(outer, flat());

		let computeCount = 0;
		const result = derived([f], () => {
			computeCount++;
			return (f.get() ?? 0) + 1;
		});
		subscribe(result, () => {});
		computeCount = 0;

		inner.set(2);
		expect(computeCount).toBe(1);
		expect(result.get()).toBe(3);
	});

	it("concatMap does not passthrough upstream type 3 signals", () => {
		const a = state(1);
		const inner = state(10);
		const mapped = pipe(
			a,
			concatMap(() => inner),
		);

		let computeCount = 0;
		const result = derived([mapped], () => {
			computeCount++;
			return (mapped.get() ?? 0) + 1;
		});
		subscribe(result, () => {});
		computeCount = 0;

		inner.set(20);
		expect(computeCount).toBe(1);
		expect(result.get()).toBe(21);
	});

	it("exhaustMap does not passthrough upstream type 3 signals", () => {
		const a = state(1);
		const inner = state(10);
		const mapped = pipe(
			a,
			exhaustMap(() => inner),
		);

		let computeCount = 0;
		const result = derived([mapped], () => {
			computeCount++;
			return (mapped.get() ?? 0) + 1;
		});
		subscribe(result, () => {});
		computeCount = 0;

		inner.set(20);
		expect(computeCount).toBe(1);
		expect(result.get()).toBe(21);
	});
});

describe("diamond topology through tier 2 operator", () => {
	it("debounce in diamond — downstream computes once per debounced emission", () => {
		const s = state(0);
		const d = pipe(s, debounce(50));

		// Diamond: d -> a, d -> b, both -> c
		const a = derived([d], () => (d.get() ?? 0) + 1);
		const b = derived([d], () => (d.get() ?? 0) * 2);
		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return a.get() + b.get();
		});
		subscribe(c, () => {});
		computeCount = 0;

		s.set(5);
		vi.advanceTimersByTime(50);

		// d emits once (5), a=6, b=10, c computes once → 16
		expect(computeCount).toBe(1);
		expect(c.get()).toBe(16);
	});

	it("switchMap in diamond — downstream computes once per inner change", () => {
		const outer = state(1);
		const inner = state(10);
		const mapped = pipe(
			outer,
			switchMap(() => inner),
		);

		const a = derived([mapped], () => (mapped.get() ?? 0) + 1);
		const b = derived([mapped], () => (mapped.get() ?? 0) * 2);
		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return a.get() + b.get();
		});
		subscribe(c, () => {});
		computeCount = 0;

		inner.set(20);
		// mapped emits once (20), a=21, b=40, c=61
		expect(computeCount).toBe(1);
		expect(c.get()).toBe(61);
	});
});

describe("error handling operators are cycle boundaries", () => {
	it("rescue switches cleanly without upstream type 3 leaking", () => {
		let errorSink: ((type: number, data?: unknown) => void) | null = null;
		const src = {
			get() {
				return 1;
			},
			source(type: number, payload?: unknown) {
				if (type === 0) {
					const sink = payload as (type: number, data?: unknown) => void;
					errorSink = sink;
					sink(0, (t: number) => {
						if (t === 2) errorSink = null;
					});
				}
			},
		};

		const fallback = state(99);
		const r = pipe(
			src,
			rescue(() => fallback),
		);

		let computeCount = 0;
		const result = derived([r], () => {
			computeCount++;
			return r.get() + 1;
		});
		subscribe(result, () => {});
		computeCount = 0;

		// Error triggers switch to fallback
		(errorSink as NonNullable<typeof errorSink>)(2, new Error("boom"));
		expect(result.get()).toBe(100);

		// Fallback changes → one compute
		fallback.set(200);
		expect(computeCount).toBe(2); // one for rescue switch, one for fallback change
		expect(result.get()).toBe(201);
	});

	it("retry re-subscribes without upstream type 3 leaking", () => {
		let producerCount = 0;
		let errorSink: ((type: number, data?: unknown) => void) | null = null;
		const src = {
			get() {
				return producerCount;
			},
			source(type: number, payload?: unknown) {
				if (type === 0) {
					producerCount++;
					const sink = payload as (type: number, data?: unknown) => void;
					errorSink = sink;
					sink(0, (t: number) => {
						if (t === 2) errorSink = null;
					});
				}
			},
		};

		const r = pipe(src, retry(2));
		subscribe(r, () => {});

		// First error — retries
		(errorSink as NonNullable<typeof errorSink>)(2, new Error("fail"));
		expect(producerCount).toBe(2);

		// Second error — retries (last)
		(errorSink as NonNullable<typeof errorSink>)(2, new Error("fail"));
		expect(producerCount).toBe(3);
	});
});
