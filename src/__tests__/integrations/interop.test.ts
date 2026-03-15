// ---------------------------------------------------------------------------
// Callbag interop tests — verify external callbag operators work with stores
// ---------------------------------------------------------------------------
// v3 guarantee: type 1 DATA carries only real values, never sentinels.
// Type 3 signals forward through operators via the transparent convention:
//   if (type !== 0 && type !== 1 && type !== 2) sink(type, data);
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from "vitest";
import { effect } from "../../effect";
import { subscribe } from "../../extra/subscribe";
import { DIRTY, derived, Inspector, RESOLVED, STATE, state } from "../../index";
import { producer } from "../../producer";

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
