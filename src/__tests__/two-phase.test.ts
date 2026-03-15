// ---------------------------------------------------------------------------
// Type 3 control channel: correctness, ordering, and emission count tests
// ---------------------------------------------------------------------------
// v3: DIRTY/RESOLVED signals flow on type 3 (STATE channel).
//     Type 1 (DATA) carries only real values.
// These tests verify:
// 1. Type 3 DIRTY/RESOLVED signal flow
// 2. Type 1 is pure values (no sentinels)
// 3. Diamond topology — glitch-free for core
// 4. RESOLVED subtree skipping
// 5. Re-entrancy and batch interaction
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from "vitest";
import { effect } from "../effect";
import { subscribe } from "../extra/subscribe";
import { batch, DIRTY, derived, Inspector, producer, RESOLVED, STATE, state } from "../index";

beforeEach(() => {
	Inspector._reset();
});

// ===========================================================================
// Section 1: Type 3 protocol verification at raw callbag level
// ===========================================================================

describe("Type 3 protocol — raw callbag signals", () => {
	it("state sends DIRTY on type 3, value on type 1 per set()", () => {
		const s = state(0);
		const signals: Array<{ type: number; data: unknown }> = [];

		s.source(0, (type: number, data: unknown) => {
			if (type === STATE) signals.push({ type: STATE, data });
			if (type === 1) signals.push({ type: 1, data });
		});

		s.set(1);
		expect(signals).toEqual([
			{ type: STATE, data: DIRTY },
			{ type: 1, data: 1 },
		]);

		s.set(2);
		expect(signals).toEqual([
			{ type: STATE, data: DIRTY },
			{ type: 1, data: 1 },
			{ type: STATE, data: DIRTY },
			{ type: 1, data: 2 },
		]);
	});

	it("derived forwards DIRTY on type 3, value on type 1", () => {
		const a = state(0);
		const d = derived([a], () => a.get() * 2);
		const signals: Array<{ type: number; data: unknown }> = [];

		d.source(0, (type: number, data: unknown) => {
			if (type === STATE) signals.push({ type: STATE, data });
			if (type === 1) signals.push({ type: 1, data });
		});

		a.set(5);
		expect(signals).toEqual([
			{ type: STATE, data: DIRTY },
			{ type: 1, data: 10 },
		]);
	});

	it("derived with multiple deps emits DIRTY once (first dirty dep)", () => {
		const a = state(1);
		const b = state(2);
		const d = derived([a, b], () => a.get() + b.get());
		const signals: Array<{ type: number; data: unknown }> = [];

		d.source(0, (type: number, data: unknown) => {
			if (type === STATE) signals.push({ type: STATE, data });
			if (type === 1) signals.push({ type: 1, data });
		});

		batch(() => {
			a.set(10);
			b.set(20);
		});

		// Single DIRTY on type 3, single value on type 1
		expect(signals).toEqual([
			{ type: STATE, data: DIRTY },
			{ type: 1, data: 30 },
		]);
	});

	it("producer sends DIRTY on type 3, value on type 1 per emit()", () => {
		const s = producer<number>();
		const signals: Array<{ type: number; data: unknown }> = [];

		s.source(0, (type: number, data: unknown) => {
			if (type === STATE) signals.push({ type: STATE, data });
			if (type === 1) signals.push({ type: 1, data });
		});

		s.emit(42);
		expect(signals).toEqual([
			{ type: STATE, data: DIRTY },
			{ type: 1, data: 42 },
		]);
	});

	it("type 1 DATA never contains DIRTY sentinel", () => {
		const s = state(0);
		const dataValues: unknown[] = [];

		s.source(0, (type: number, data: unknown) => {
			if (type === 1) dataValues.push(data);
		});

		s.set(1);
		s.set(2);
		s.set(3);

		expect(dataValues).toEqual([1, 2, 3]);
		expect(dataValues.every((v) => v !== DIRTY)).toBe(true);
	});
});

// ===========================================================================
// Section 2: RESOLVED signal and subtree skipping
// ===========================================================================

describe("RESOLVED signal — subtree skipping", () => {
	it("derived with equals sends RESOLVED when value unchanged", () => {
		const s = state(1);
		const parity = derived([s], () => s.get() % 2, {
			equals: (a, b) => a === b,
		});
		const signals: Array<{ type: number; data: unknown }> = [];

		parity.source(0, (type: number, data: unknown) => {
			if (type === STATE) signals.push({ type: STATE, data });
			if (type === 1) signals.push({ type: 1, data });
		});

		s.set(3); // parity: 1 % 2 = 1, same as cached
		expect(signals).toEqual([
			{ type: STATE, data: DIRTY },
			{ type: STATE, data: RESOLVED },
		]);
	});

	it("RESOLVED propagates through chain — skips downstream fn()", () => {
		const s = state(1);
		const parity = derived([s], () => s.get() % 2, {
			equals: (a, b) => a === b,
		});
		let downstreamComputed = 0;
		const downstream = derived([parity], () => {
			downstreamComputed++;
			return parity.get() * 10;
		});

		// Connect downstream
		subscribe(downstream, () => {});
		downstreamComputed = 0;

		s.set(3); // parity unchanged → RESOLVED → downstream skips fn()
		expect(downstreamComputed).toBe(0);
	});

	it("RESOLVED in diamond: all-RESOLVED skips downstream entirely", () => {
		const s = state(1);
		const a = derived([s], () => s.get() % 2, {
			equals: (a, b) => a === b,
		});
		const b = derived([s], () => s.get() % 3, {
			equals: (a, b) => a === b,
		});
		let cComputed = 0;
		const c = derived([a, b], () => {
			cComputed++;
			return `${a.get()},${b.get()}`;
		});

		subscribe(c, () => {});
		cComputed = 0;

		// s=1→7: a: 7%2=1 (same as 1%2=1), b: 7%3=1 (same as 1%3=1) → both RESOLVED
		s.set(7);
		expect(cComputed).toBe(0); // c skipped entirely!
	});

	it("mixed RESOLVED + DATA: downstream still recomputes", () => {
		const s = state(1);
		const parity = derived([s], () => s.get() % 2, {
			equals: (a, b) => a === b,
		});
		const doubled = derived([s], () => s.get() * 2);
		let combinedComputed = 0;
		const combined = derived([parity, doubled], () => {
			combinedComputed++;
			return `${parity.get()},${doubled.get()}`;
		});

		const values: string[] = [];
		subscribe(combined, (v) => values.push(v));
		combinedComputed = 0;

		s.set(3); // parity: RESOLVED, doubled: DATA 6
		expect(combinedComputed).toBe(1);
		expect(values).toEqual(["1,6"]);
	});

	it("effect skips when all deps send RESOLVED", () => {
		const s = state(1);
		const parity = derived([s], () => s.get() % 2, {
			equals: (a, b) => a === b,
		});

		let effectCount = 0;
		const dispose = effect([parity], () => {
			effectCount++;
		});
		effectCount = 0;

		s.set(3); // parity unchanged → RESOLVED → effect skips
		expect(effectCount).toBe(0);

		s.set(2); // parity changes 1→0 → DATA → effect runs
		expect(effectCount).toBe(1);

		dispose();
	});
});

// ===========================================================================
// Section 3: Diamond topology — core primitives (glitch-free)
// ===========================================================================

describe("Diamond topology — core (glitch-free)", () => {
	it("derived computes exactly once in a diamond", () => {
		const s = state(1);
		const a = derived([s], () => s.get() + 1);
		const b = derived([s], () => s.get() * 10);
		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return a.get() + b.get();
		});

		const values: number[] = [];
		subscribe(c, (v) => values.push(v));
		computeCount = 0;

		s.set(2);
		expect(values).toEqual([23]);
		expect(computeCount).toBe(1);
	});

	it("diamond with batch: single computation", () => {
		const x = state(0);
		const y = state(0);
		const a = derived([x, y], () => x.get() + y.get());
		const b = derived([x, y], () => x.get() * y.get());
		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return `${a.get()},${b.get()}`;
		});

		const values: string[] = [];
		subscribe(c, (v) => values.push(v));
		computeCount = 0;

		batch(() => {
			x.set(3);
			y.set(4);
		});

		expect(values).toEqual(["7,12"]);
		expect(computeCount).toBe(1);
	});

	it("deep diamond chain: no intermediate glitches", () => {
		const s = state(1);
		const d1 = derived([s], () => s.get() + 1);
		const d2 = derived([s], () => s.get() * 2);
		const d3 = derived([d1, d2], () => d1.get() + d2.get());
		const d4 = derived([d3], () => d3.get() * 10);

		const values: number[] = [];
		subscribe(d4, (v) => values.push(v));

		s.set(5);
		expect(values).toEqual([160]);
	});

	it("effect fires exactly once per change in diamond", () => {
		const s = state(1);
		const a = derived([s], () => s.get() + 1);
		const b = derived([s], () => s.get() * 2);

		let effectCount = 0;
		const dispose = effect([a, b], () => {
			effectCount++;
		});
		effectCount = 0;

		s.set(5);
		expect(effectCount).toBe(1);

		s.set(10);
		expect(effectCount).toBe(2);

		dispose();
	});

	it("subscribe fires exactly once per change in diamond", () => {
		const s = state(0);
		const a = derived([s], () => s.get() + 1);
		const b = derived([s], () => s.get() - 1);
		const c = derived([a, b], () => a.get() + b.get());

		let fireCount = 0;
		const unsub = subscribe(c, () => {
			fireCount++;
		});

		s.set(5);
		expect(fireCount).toBe(1);

		s.set(10);
		expect(fireCount).toBe(2);

		unsub();
	});

	it("derived with equals suppresses unchanged values", () => {
		const s = state(1);
		const parity = derived([s], () => s.get() % 2, {
			equals: (a, b) => a === b,
		});

		const values: number[] = [];
		subscribe(parity, (v) => values.push(v));

		s.set(3); // parity still 1 — suppressed
		s.set(5); // parity still 1 — suppressed
		s.set(4); // parity changes to 0

		expect(values).toEqual([0]);
	});

	it("equals suppression in diamond: downstream not re-triggered", () => {
		const s = state(1);
		const parity = derived([s], () => s.get() % 2, {
			equals: (a, b) => a === b,
		});
		const doubled = derived([s], () => s.get() * 2);
		let computeCount = 0;
		const combined = derived([parity, doubled], () => {
			computeCount++;
			return `${parity.get()},${doubled.get()}`;
		});

		const values: string[] = [];
		subscribe(combined, (v) => values.push(v));
		computeCount = 0;

		s.set(3);
		// parity: RESOLVED (value unchanged)
		// doubled: DATA 6
		// combined: recomputes because doubled changed
		expect(values).toEqual(["1,6"]);
		expect(computeCount).toBe(1);
	});
});

// ===========================================================================
// Section 4: Re-entrancy and batch ordering
// ===========================================================================

describe("Re-entrancy and batch ordering", () => {
	it("state.set() inside subscribe callback fires in correct order", () => {
		const a = state(0);
		const b = state(0);
		const log: string[] = [];

		subscribe(a, (v) => {
			log.push(`a=${v}`);
			if (v === 1) b.set(10);
		});
		subscribe(b, (v) => {
			log.push(`b=${v}`);
		});

		a.set(1);
		expect(log).toEqual(["a=1", "b=10"]);
	});

	it("batch coalesces multiple set() — subscribers fire once each", () => {
		const s = state(0);
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		batch(() => {
			s.set(1);
			s.set(2);
			s.set(3);
		});

		expect(values).toEqual([3]);
	});

	it("nested batch defers until outermost ends", () => {
		const s = state(0);
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		batch(() => {
			s.set(1);
			batch(() => {
				s.set(2);
			});
			expect(values).toEqual([]);
			s.set(3);
		});

		expect(values).toEqual([3]);
	});

	it("derived recomputes correctly when dep changes inside effect", () => {
		const trigger = state(0);
		const counter = state(0);
		const sum = derived([trigger, counter], () => trigger.get() + counter.get());

		const values: number[] = [];
		subscribe(sum, (v) => values.push(v));

		const dispose = effect([trigger], () => {
			if (trigger.get() > 0) counter.set(trigger.get() * 10);
		});

		trigger.set(1);
		expect(values).toContain(11);

		dispose();
	});
});

// ===========================================================================
// Section 5: Complex batch drain scenario
// ===========================================================================

describe("Complex batch scenarios", () => {
	it("batch with complex graph: a1 → b1 → c1 → d1, b2 → c2 → d1, c3 → e2", () => {
		const a1 = state(0);
		const b1 = derived([a1], () => a1.get() + 1);
		const b2 = state(0);
		const c1 = derived([b1], () => b1.get() * 2);
		const c2 = derived([b2], () => b2.get() * 3);
		const c3 = state(0);
		const d1 = derived([c1, c2], () => c1.get() + c2.get());
		const e1Values: number[] = [];
		const e2Values: string[] = [];

		subscribe(d1, (v) => e1Values.push(v));
		const e2 = derived([d1, c3], () => `${d1.get()},${c3.get()}`);
		subscribe(e2, (v) => e2Values.push(v));

		batch(() => {
			a1.set(1);
			b2.set(2);
			c3.set(3);
		});

		// b1=2, c1=4, c2=6, d1=10
		expect(e1Values).toEqual([10]);
		// e2 = "10,3"
		expect(e2Values).toEqual(["10,3"]);
	});
});
