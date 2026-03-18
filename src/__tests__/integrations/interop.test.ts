// ---------------------------------------------------------------------------
// Callbag interop tests — verify external callbag operators work with stores
// ---------------------------------------------------------------------------
// v3 guarantee: type 1 DATA carries only real values, never sentinels.
// Type 3 signals forward through operators via the transparent convention:
//   if (type !== 0 && type !== 1 && type !== 2) sink(type, data);
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from "vitest";
import { subscribe } from "../../extra/subscribe";
import { wrap } from "../../extra/wrap";
import {
	batch,
	DIRTY,
	derived,
	effect,
	Inspector,
	producer,
	RESOLVED,
	START,
	STATE,
	state,
} from "../../index";

beforeEach(() => {
	Inspector._reset();
});

// ---------------------------------------------------------------------------
// Simulated raw callbag operators (mimic external callbag ecosystem)
// These follow the standard callbag convention: forward unknown types.
// ---------------------------------------------------------------------------

/** Raw callbag map — transforms type 1, forwards everything else */
function rawCbMap<A, B>(fn: (a: A) => B) {
	return (source: (type: number, payload?: any) => void) =>
		(start: number, sink: (type: number, data?: any) => void) => {
			if (start !== 0) return;
			source(0, (type: number, data: any) => {
				if (type === 0) {
					const talkback = data;
					sink(0, (t: number, d?: any) => talkback(t, d));
				} else if (type === 1) {
					sink(1, fn(data));
				} else if (type === 2) {
					sink(2, data);
				} else {
					// Transparent forwarding — type 3 and any future types
					sink(type, data);
				}
			});
		};
}

/** Raw callbag filter — filters type 1, forwards everything else */
function rawCbFilter<A>(pred: (a: A) => boolean) {
	return (source: (type: number, payload?: any) => void) =>
		(start: number, sink: (type: number, data?: any) => void) => {
			if (start !== 0) return;
			source(0, (type: number, data: any) => {
				if (type === 0) {
					const talkback = data;
					sink(0, (t: number, d?: any) => talkback(t, d));
				} else if (type === 1) {
					if (pred(data)) sink(1, data);
				} else if (type === 2) {
					sink(2, data);
				} else {
					sink(type, data);
				}
			});
		};
}

/** Raw callbag subscribe — only listens to type 1 */
function rawCbSubscribe<A>(cb: (a: A) => void) {
	return (source: (type: number, payload?: any) => void) => {
		let talkback: ((type: number) => void) | null = null;
		source(0, (type: number, data: any) => {
			if (type === 0) talkback = data;
			if (type === 1) cb(data);
		});
		return () => talkback?.(2);
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Raw callbag interop — type 1 is pure values", () => {
	it("raw callbag subscribe receives only real values from state", () => {
		const s = state(0);
		const values: number[] = [];

		const unsub = rawCbSubscribe<number>((v) => values.push(v))(s.source);

		s.set(1);
		s.set(2);
		s.set(3);

		expect(values).toEqual([1, 2, 3]);
		// No DIRTY sentinel in values
		expect(values.every((v) => typeof v === "number")).toBe(true);

		unsub();
	});

	it("raw callbag map transforms state values", () => {
		const s = state(5);
		const values: number[] = [];

		const mapped = rawCbMap<number, number>((n) => n * 10)(s.source);
		const unsub = rawCbSubscribe<number>((v) => values.push(v))(mapped);

		s.set(3);
		s.set(7);

		expect(values).toEqual([30, 70]);

		unsub();
	});

	it("raw callbag filter works with state values", () => {
		const s = state(0);
		const values: number[] = [];

		const filtered = rawCbFilter<number>((n) => n > 2)(s.source);
		const unsub = rawCbSubscribe<number>((v) => values.push(v))(filtered);

		s.set(1);
		s.set(3);
		s.set(2);
		s.set(5);

		expect(values).toEqual([3, 5]);

		unsub();
	});

	it("chained raw callbag operators: map → filter → subscribe", () => {
		const s = state(0);
		const values: number[] = [];

		const chain = rawCbFilter<number>((n) => n > 5)(
			rawCbMap<number, number>((n) => n * 2)(s.source),
		);
		const unsub = rawCbSubscribe<number>((v) => values.push(v))(chain);

		s.set(1); // *2=2, filtered
		s.set(3); // *2=6, passes
		s.set(2); // *2=4, filtered
		s.set(5); // *2=10, passes

		expect(values).toEqual([6, 10]);

		unsub();
	});

	it("raw callbag subscribe on derived receives only computed values", () => {
		const a = state(1);
		const b = state(2);
		const sum = derived([a, b], () => a.get() + b.get());
		const values: number[] = [];

		const unsub = rawCbSubscribe<number>((v) => values.push(v))(sum.source);

		a.set(10);
		b.set(20);

		expect(values).toEqual([12, 30]);

		unsub();
	});

	it("raw callbag subscribe on producer receives emitted values", () => {
		const p = producer<string>();
		const values: string[] = [];

		const unsub = rawCbSubscribe<string>((v) => values.push(v))(p.source);

		p.emit("hello");
		p.emit("world");

		expect(values).toEqual(["hello", "world"]);

		unsub();
	});
});

describe("Type 3 transparent forwarding through raw callbag operators", () => {
	it("DIRTY/RESOLVED signals pass through raw callbag map", () => {
		const s = state(0);
		const signals: Array<{ type: number; data: unknown }> = [];

		// Wire: state → rawCbMap → sink that logs type 3
		const mapped = rawCbMap<number, number>((n) => n * 2)(s.source);
		mapped(0, (type: number, data: any) => {
			if (type === STATE) signals.push({ type: STATE, data });
			if (type === 1) signals.push({ type: 1, data });
		});

		s.set(5);

		expect(signals).toEqual([
			{ type: STATE, data: DIRTY },
			{ type: 1, data: 10 },
		]);
	});

	it("DIRTY signals forward through chained raw operators", () => {
		const s = state(1);
		const signals: Array<{ type: number; data: unknown }> = [];

		const chain = rawCbFilter<number>((n) => n > 0)(
			rawCbMap<number, number>((n) => n * 3)(s.source),
		);
		chain(0, (type: number, data: any) => {
			if (type === STATE) signals.push({ type: STATE, data });
			if (type === 1) signals.push({ type: 1, data });
		});

		s.set(2);

		// DIRTY propagates through both operators
		expect(signals).toEqual([
			{ type: STATE, data: DIRTY },
			{ type: 1, data: 6 },
		]);
	});

	it("derived with equals sends RESOLVED through raw operator chain", () => {
		const s = state(1);
		const parity = derived([s], () => s.get() % 2, {
			equals: (a, b) => a === b,
		});
		const signals: Array<{ type: number; data: unknown }> = [];

		// Wire parity through a raw map
		const mapped = rawCbMap<number, number>((n) => n * 10)(parity.source);
		mapped(0, (type: number, data: any) => {
			if (type === STATE) signals.push({ type: STATE, data });
			if (type === 1) signals.push({ type: 1, data });
		});

		s.set(3); // parity still 1 → RESOLVED, no value

		expect(signals).toEqual([
			{ type: STATE, data: DIRTY },
			{ type: STATE, data: RESOLVED },
		]);
	});
});

describe("Diamond resolution with raw callbag operators in the chain", () => {
	it("diamond through raw operator: derived computes once", () => {
		const s = state(1);
		// Branch A: state → derived (raw callbag map wouldn't give us get())
		const a = derived([s], () => s.get() + 1);
		// Branch B: state → derived
		const b = derived([s], () => s.get() * 10);
		// Join: diamond node
		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return a.get() + b.get();
		});

		const values: number[] = [];
		subscribe(c, (v) => values.push(v));
		computeCount = 0;

		s.set(2);
		expect(values).toEqual([23]); // (2+1) + (2*10) = 23
		expect(computeCount).toBe(1);
	});

	it("effect fires once even when upstream uses raw callbag wiring", () => {
		const s = state(0);
		const d = derived([s], () => s.get() * 2);

		let effectCount = 0;
		const dispose = effect([d], () => {
			effectCount++;
			d.get();
		});
		effectCount = 0;

		s.set(5);
		expect(effectCount).toBe(1);

		dispose();
	});
});

// ---------------------------------------------------------------------------
// Raw callbag source helper — creates a pushable raw callbag source
// ---------------------------------------------------------------------------

function rawCbSource<T>() {
	let sink: ((type: number, data?: any) => void) | null = null;
	const source = (type: number, payload: any) => {
		if (type !== 0) return;
		sink = payload;
		sink!(0, (t: number) => {
			if (t === 2) sink = null;
		});
	};
	return {
		source,
		push: (v: T) => sink?.(1, v),
		end: (err?: unknown) => sink?.(2, err),
	};
}

// ---------------------------------------------------------------------------
// wrap() — source wrapping (tier 2)
// ---------------------------------------------------------------------------

describe("wrap() — source wrapping (tier 2)", () => {
	it("wraps a raw callbag source into a Store", () => {
		const raw = rawCbSource<number>();
		const store = wrap<number>(raw.source);

		const values: number[] = [];
		const unsub = subscribe(store, (v) => values.push(v));

		raw.push(1);
		raw.push(2);
		raw.push(3);

		expect(values).toEqual([1, 2, 3]);
		unsub();
	});

	it("get() returns the last emitted value", () => {
		const raw = rawCbSource<number>();
		const store = wrap<number>(raw.source);

		const unsub = subscribe(store, () => {});
		raw.push(42);
		expect(store.get()).toBe(42);

		raw.push(99);
		expect(store.get()).toBe(99);
		unsub();
	});

	it("supports multicast — multiple subscribers", () => {
		const raw = rawCbSource<number>();
		const store = wrap<number>(raw.source);

		const v1: number[] = [];
		const v2: number[] = [];
		const unsub1 = subscribe(store, (v) => v1.push(v));
		const unsub2 = subscribe(store, (v) => v2.push(v));

		raw.push(10);
		expect(v1).toEqual([10]);
		expect(v2).toEqual([10]);

		unsub1();
		raw.push(20);
		expect(v1).toEqual([10]); // unsubscribed
		expect(v2).toEqual([10, 20]);

		unsub2();
	});

	it("forwards completion to subscribers", () => {
		const raw = rawCbSource<number>();
		const store = wrap<number>(raw.source);

		let ended = false;
		subscribe(store, () => {}, {
			onEnd: () => {
				ended = true;
			},
		});

		raw.push(1);
		raw.end();
		expect(ended).toBe(true);
	});

	it("forwards errors to subscribers", () => {
		const raw = rawCbSource<number>();
		const store = wrap<number>(raw.source);

		let receivedError: unknown;
		subscribe(store, () => {}, {
			onEnd: (err) => {
				receivedError = err;
			},
		});

		raw.end(new Error("boom"));
		expect(receivedError).toBeInstanceOf(Error);
		expect((receivedError as Error).message).toBe("boom");
	});

	it("sends DIRTY before each DATA (tier 2 cycle)", () => {
		const raw = rawCbSource<number>();
		const store = wrap<number>(raw.source);

		const signals: Array<{ type: number; data: unknown }> = [];
		store.source(START, (type: number, data: any) => {
			if (type === STATE) signals.push({ type: STATE, data });
			if (type === 1) signals.push({ type: 1, data });
		});

		raw.push(5);
		expect(signals).toEqual([
			{ type: STATE, data: DIRTY },
			{ type: 1, data: 5 },
		]);
	});

	it("cleans up raw source on last subscriber disconnect", () => {
		let cleaned = false;
		const rawSource = (type: number, payload: any) => {
			if (type !== 0) return;
			const sink = payload;
			sink(0, (t: number) => {
				if (t === 2) cleaned = true;
			});
		};
		const store = wrap<number>(rawSource);

		const unsub = subscribe(store, () => {});
		expect(cleaned).toBe(false);
		unsub();
		expect(cleaned).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// wrap() — operator wrapping (tier 1, STATE bypass)
// ---------------------------------------------------------------------------

describe("wrap() — operator wrapping (tier 1)", () => {
	it("transforms values through raw callbag map", () => {
		const s = state(5);
		const wrapped = wrap<number, number>(
			s,
			rawCbMap((n) => n * 10),
		);

		const values: number[] = [];
		const unsub = subscribe(wrapped, (v) => values.push(v));

		s.set(3);
		s.set(7);

		expect(values).toEqual([30, 70]);
		unsub();
	});

	it("get() returns the initial transformed value before any changes", () => {
		const s = state(5);
		const wrapped = wrap<number, number>(
			s,
			rawCbMap((n) => n * 10),
		);

		// Before subscription, get() pulls through rawOp via getter
		expect(wrapped.get()).toBe(50);
	});

	it("get() returns the last transformed value after changes", () => {
		const s = state(5);
		const wrapped = wrap<number, number>(
			s,
			rawCbMap((n) => n * 10),
		);

		const unsub = subscribe(wrapped, () => {});
		s.set(3);
		expect(wrapped.get()).toBe(30);
		unsub();
	});

	it("forwards STATE signals (DIRTY/RESOLVED) — STATE bypass", () => {
		const s = state(0);
		const wrapped = wrap<number, number>(
			s,
			rawCbMap((n) => n * 2),
		);

		const signals: Array<{ type: number; data: unknown }> = [];
		wrapped.source(START, (type: number, data: any) => {
			if (type === STATE) signals.push({ type: STATE, data });
			if (type === 1) signals.push({ type: 1, data });
		});

		// Use batch() so DIRTY is dispatched (Skip DIRTY optimization
		// skips DIRTY for single-dep subscribers in unbatched paths)
		batch(() => s.set(5));
		expect(signals).toEqual([
			{ type: STATE, data: DIRTY },
			{ type: 1, data: 10 },
		]);
	});

	it("supports multicast — multiple subscribers", () => {
		const s = state(1);
		const wrapped = wrap<number, number>(
			s,
			rawCbMap((n) => n + 100),
		);

		const v1: number[] = [];
		const v2: number[] = [];
		const unsub1 = subscribe(wrapped, (v) => v1.push(v));
		const unsub2 = subscribe(wrapped, (v) => v2.push(v));

		s.set(5);
		expect(v1).toEqual([105]);
		expect(v2).toEqual([105]);

		unsub1();
		s.set(10);
		expect(v1).toEqual([105]); // unsubscribed
		expect(v2).toEqual([105, 110]);

		unsub2();
	});

	it("diamond resolution: wrapped operator in one branch", () => {
		const s = state(1);
		// Branch A: through raw map wrapper (tier 1)
		const a = wrap<number, number>(
			s,
			rawCbMap((n) => n + 1),
		);
		// Branch B: through derived
		const b = derived([s], () => s.get() * 10);
		// Join: diamond node
		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return a.get() + b.get();
		});

		const values: number[] = [];
		subscribe(c, (v) => values.push(v));
		computeCount = 0;

		s.set(2);
		expect(values).toEqual([23]); // (2+1) + (2*10) = 3 + 20 = 23
		expect(computeCount).toBe(1); // computed exactly once
	});

	it("diamond resolution: both branches are wrapped operators", () => {
		const s = state(1);
		const a = wrap<number, number>(
			s,
			rawCbMap((n) => n + 1),
		);
		const b = wrap<number, number>(
			s,
			rawCbMap((n) => n * 10),
		);

		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return a.get() + b.get();
		});

		const values: number[] = [];
		subscribe(c, (v) => values.push(v));
		computeCount = 0;

		s.set(2);
		expect(values).toEqual([23]); // (2+1) + (2*10) = 23
		expect(computeCount).toBe(1);
	});

	it("RESOLVED propagation: derived with equals → wrap → downstream skips", () => {
		const s = state(1);
		const parity = derived([s], () => s.get() % 2, {
			equals: (a, b) => a === b,
		});
		// Wrap parity through a raw map (tier 1 — STATE bypass)
		const wrapped = wrap<number, number>(
			parity,
			rawCbMap((n) => n * 10),
		);

		let effectCount = 0;
		const dispose = effect([wrapped], () => {
			effectCount++;
			wrapped.get();
		});
		effectCount = 0;

		// s: 1 → 3, parity stays 1 → RESOLVED → wrap forwards RESOLVED → effect skips
		s.set(3);
		expect(effectCount).toBe(0);

		// s: 3 → 4, parity changes 1 → 0 → DATA flows through → effect fires
		s.set(4);
		expect(effectCount).toBe(1);

		dispose();
	});

	it("upstream error propagates through wrapped operator", () => {
		const p = producer<number>(undefined, { initial: 0 });
		const wrapped = wrap<number, number>(
			p,
			rawCbMap((n) => n * 2),
		);

		let receivedError: unknown;
		subscribe(wrapped, () => {}, {
			onEnd: (err) => {
				receivedError = err;
			},
		});

		p.error(new Error("upstream fail"));
		expect(receivedError).toBeInstanceOf(Error);
		expect((receivedError as Error).message).toBe("upstream fail");
	});

	it("upstream completion propagates through wrapped operator", () => {
		const p = producer<number>(undefined, { initial: 0 });
		const wrapped = wrap<number, number>(
			p,
			rawCbMap((n) => n * 2),
		);

		let ended = false;
		subscribe(wrapped, () => {}, {
			onEnd: () => {
				ended = true;
			},
		});

		p.complete();
		expect(ended).toBe(true);
	});

	it("reconnect: handler-local state resets on disconnect→reconnect", () => {
		const s = state(0);
		const wrapped = wrap<number, number>(
			s,
			rawCbMap((n) => n * 3),
		);

		const values1: number[] = [];
		const unsub1 = subscribe(wrapped, (v) => values1.push(v));
		s.set(1);
		s.set(2);
		expect(values1).toEqual([3, 6]);
		unsub1();

		// Reconnect — fresh pipeline
		const values2: number[] = [];
		const unsub2 = subscribe(wrapped, (v) => values2.push(v));
		s.set(3);
		expect(values2).toEqual([9]);
		unsub2();
	});

	it("chained raw callbag operators through wrap", () => {
		const s = state(1);
		// Chain two raw maps: *2, then +100
		const doubleMap = (source: any) =>
			rawCbMap<number, number>((n) => n + 100)(rawCbMap<number, number>((n) => n * 2)(source));
		const wrapped = wrap<number, number>(s, doubleMap);

		const values: number[] = [];
		const unsub = subscribe(wrapped, (v) => values.push(v));

		s.set(5);
		expect(values).toEqual([110]); // (5*2) + 100 = 110

		s.set(10);
		expect(values).toEqual([110, 120]); // (10*2) + 100 = 120
		unsub();
	});
});
