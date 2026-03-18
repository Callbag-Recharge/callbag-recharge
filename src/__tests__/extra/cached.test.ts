import { describe, expect, it, vi } from "vitest";
import { cached } from "../../extra/cached";
import { batch, DATA, DIRTY, derived, pipe, RESOLVED, START, STATE, state } from "../../index";

// ---------------------------------------------------------------------------
// Factory form: cached([deps], fn, opts?)
// ---------------------------------------------------------------------------

describe("cached() factory form", () => {
	it("computes initial value at construction", () => {
		const a = state(2);
		const c = cached([a], () => a.get() * 10);

		expect(c.get()).toBe(20);
	});

	it("connected mode: push-based like derived", () => {
		const a = state(1);
		const c = cached([a], () => a.get() * 2);

		const values: number[] = [];
		c.source(START, (type: number, data: any) => {
			if (type === DATA) values.push(data);
		});

		a.set(5);
		a.set(10);

		expect(values).toEqual([10, 20]);
		expect(c.get()).toBe(20);
	});

	it("disconnected get(): returns cached when deps unchanged", () => {
		const a = state(3);
		const fn = vi.fn(() => a.get() * 2);
		const c = cached([a], fn);

		// Initial computation
		expect(c.get()).toBe(6);
		const callsAfterInit = fn.mock.calls.length;

		// get() again without dep change — should NOT recompute
		expect(c.get()).toBe(6);
		expect(fn.mock.calls.length).toBe(callsAfterInit);
	});

	it("disconnected get(): recomputes when deps change", () => {
		const a = state(3);
		const fn = vi.fn(() => a.get() * 2);
		const c = cached([a], fn);

		expect(c.get()).toBe(6);
		const callsAfterInit = fn.mock.calls.length;

		a.set(7);
		expect(c.get()).toBe(14);
		expect(fn.mock.calls.length).toBe(callsAfterInit + 1);
	});

	it("multi-dep input tracking", () => {
		const a = state(2);
		const b = state(3);
		const fn = vi.fn(() => a.get() + b.get());
		const c = cached([a, b], fn);

		expect(c.get()).toBe(5);
		const calls1 = fn.mock.calls.length;

		// No change — cached
		expect(c.get()).toBe(5);
		expect(fn.mock.calls.length).toBe(calls1);

		// Change one dep — recomputes
		a.set(10);
		expect(c.get()).toBe(13);
		expect(fn.mock.calls.length).toBe(calls1 + 1);

		// No change again — cached
		expect(c.get()).toBe(13);
		expect(fn.mock.calls.length).toBe(calls1 + 1);
	});

	it("equals option: push-phase memoization (RESOLVED)", () => {
		const a = state(1);
		const c = cached([a], () => Math.floor(a.get() / 10), {
			equals: Object.is,
		});

		const signals: unknown[] = [];
		const values: number[] = [];
		c.source(START, (type: number, data: any) => {
			if (type === STATE) signals.push(data);
			if (type === DATA) values.push(data);
		});

		// floor(1/10) = 0, floor(5/10) = 0 → same → RESOLVED
		batch(() => a.set(5));
		expect(signals).toContain(RESOLVED);
		expect(values).toEqual([]); // no new DATA

		// floor(15/10) = 1 → different → DATA
		a.set(15);
		expect(values).toContain(1);
	});

	it("reconnection after disconnect", () => {
		const a = state(2);
		const c = cached([a], () => a.get() * 3);

		// First subscription
		let talkback: (t: number) => void;
		const values1: number[] = [];
		c.source(START, (type: number, data: any) => {
			if (type === START) talkback = data;
			if (type === DATA) values1.push(data);
		});

		a.set(5);
		expect(values1).toEqual([15]);

		// Disconnect
		talkback!(2);

		// Disconnected get() should still work
		a.set(10);
		expect(c.get()).toBe(30);

		// Reconnect
		const values2: number[] = [];
		c.source(START, (type: number, data: any) => {
			if (type === DATA) values2.push(data);
		});

		a.set(20);
		expect(values2).toEqual([60]);
	});

	it("forwards type 3 signals (diamond resolution)", () => {
		const a = state(1);
		const b = state(10);
		const expensiveA = cached([a], () => a.get() * 100);

		// Multi-dep derived depending on cached and b
		const combined = derived([expensiveA, b], () => expensiveA.get() + b.get());

		const values: number[] = [];
		combined.source(START, (type: number, data: any) => {
			if (type === DATA) values.push(data);
		});

		// Batch both changes — diamond resolution via type 3
		batch(() => {
			a.set(2);
			b.set(20);
		});
		expect(combined.get()).toBe(220); // 2*100 + 20
		// Should recompute only once
		expect(values.filter((v) => v === 220).length).toBe(1);
	});

	it("multi-dep cached: no glitch in batched diamond", () => {
		const a = state(1);
		const b = state(10);
		const c = cached([a, b], () => a.get() * 100 + b.get());

		const values: number[] = [];
		c.source(START, (type: number, data: any) => {
			if (type === DATA) values.push(data);
		});

		// Both deps change in a batch — should recompute only ONCE
		batch(() => {
			a.set(2);
			b.set(20);
		});

		// Only the final correct value, no glitchy intermediate
		expect(values).toEqual([220]);
		expect(c.get()).toBe(220);
	});

	it("multi-dep cached: RESOLVED when all deps resolve without value change", () => {
		const a = state(1);
		const b = state(10);
		const c = cached([a, b], () => Math.floor((a.get() + b.get()) / 100), {
			equals: Object.is,
		});

		const signals: unknown[] = [];
		const values: number[] = [];
		c.source(START, (type: number, data: any) => {
			if (type === STATE) signals.push(data);
			if (type === DATA) values.push(data);
		});

		// Change both deps but result stays 0 (floor((2+20)/100) = 0)
		batch(() => {
			a.set(2);
			b.set(20);
		});

		expect(values).toEqual([]); // no new DATA
		expect(signals).toContain(RESOLVED);
	});
});

// ---------------------------------------------------------------------------
// Pipe form: cached(eq?)
// ---------------------------------------------------------------------------

describe("cached() pipe form", () => {
	it("deduplicates output (default Object.is)", () => {
		const s = state(1);
		const c = pipe(s, cached<number>());

		const values: number[] = [];
		c.source(START, (type: number, data: any) => {
			if (type === DATA) values.push(data);
		});

		s.set(1); // same value — deduped
		s.set(2); // different — emitted
		s.set(2); // same — deduped
		s.set(3); // different — emitted

		expect(values).toEqual([2, 3]);
	});

	it("deduplicates with custom equality", () => {
		const s = state({ x: 1 });
		const c = pipe(
			s,
			cached<{ x: number }>((a, b) => a.x === b.x),
		);

		const values: Array<{ x: number }> = [];
		c.source(START, (type: number, data: any) => {
			if (type === DATA) values.push(data);
		});

		s.set({ x: 1 }); // same by custom eq — deduped
		s.set({ x: 2 }); // different — emitted

		expect(values).toEqual([{ x: 2 }]);
	});

	it("sends RESOLVED on duplicate (type 3)", () => {
		const s = state(1);
		// Map to floor(x/10) so different inputs can produce same output
		const floored = derived([s], () => Math.floor(s.get() / 10));
		const c = pipe(floored, cached<number>());

		const signals: unknown[] = [];
		c.source(START, (type: number, data: any) => {
			if (type === STATE) signals.push(data);
		});

		// floor(1/10)=0, floor(5/10)=0 → same → RESOLVED
		batch(() => s.set(5));

		expect(signals).toContain(DIRTY);
		expect(signals).toContain(RESOLVED);
	});

	it("cached getter on disconnected reads", () => {
		const s = state(5);
		const c = pipe(s, cached<number>());

		// Disconnected get() returns cached
		expect(c.get()).toBe(5);

		s.set(10);
		expect(c.get()).toBe(10);

		// Same value → still returns cached
		expect(c.get()).toBe(10);
	});

	it("reconnection preserves dedup state", () => {
		const s = state(1);
		const c = pipe(s, cached<number>());

		let talkback: (t: number) => void;
		const values: number[] = [];
		c.source(START, (type: number, data: any) => {
			if (type === START) talkback = data;
			if (type === DATA) values.push(data);
		});

		s.set(2);
		expect(values).toEqual([2]);

		// Disconnect and reconnect
		talkback!(2);

		const values2: number[] = [];
		c.source(START, (type: number, data: any) => {
			if (type === DATA) values2.push(data);
		});

		s.set(2); // same as last — deduped
		s.set(3); // different — emitted

		expect(values2).toEqual([3]);
	});
});
