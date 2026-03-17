// ---------------------------------------------------------------------------
// Tests mirroring common callbag utility behavior
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import { filter } from "../../extra/filter";
import { map } from "../../extra/map";
import { scan } from "../../extra/scan";
import { subscribe } from "../../extra/subscribe";
import { DIRTY, derived, Inspector, pipe, producer, STATE, state } from "../../index";

beforeEach(() => {
	Inspector._reset();
});

describe("Callbag protocol", () => {
	it("source responds to handshake (type 0) with talkback", () => {
		const count = state(42);
		let receivedTalkback = false;

		count.source(0, (type: number, data: any) => {
			if (type === 0) {
				receivedTalkback = true;
				expect(typeof data).toBe("function");
			}
		});

		expect(receivedTalkback).toBe(true);
	});

	it("talkback type 1 (pull) responds with current value", () => {
		const count = state(42);
		let talkback: any;
		let pulledValue: any;

		count.source(0, (type: number, data: any) => {
			if (type === 0) talkback = data;
			if (type === 1) pulledValue = data;
		});

		talkback(1); // pull
		expect(pulledValue).toBe(42);
	});

	it("talkback type 2 (end) disconnects the sink", () => {
		const count = state(0);
		let talkback: any;
		let dirtyCount = 0;

		count.source(0, (type: number, data: any) => {
			if (type === 0) talkback = data;
			// v3: DIRTY arrives on type 3 (STATE), not type 1
			if (type === STATE && data === DIRTY) dirtyCount++;
		});

		count.set(1);
		expect(dirtyCount).toBe(1);

		talkback(2); // disconnect
		count.set(2);
		expect(dirtyCount).toBe(1);
	});

	it("sends DIRTY on type 3 and value on type 1 per state change", () => {
		const count = state(0);
		const signals: Array<{ type: number; data: any }> = [];

		count.source(0, (type: number, data: any) => {
			if (type === STATE) signals.push({ type: STATE, data });
			if (type === 1) signals.push({ type: 1, data });
		});

		count.set(1);
		count.set(2);

		// v3: DIRTY on type 3, values on type 1
		expect(signals).toEqual([
			{ type: STATE, data: DIRTY },
			{ type: 1, data: 1 },
			{ type: STATE, data: DIRTY },
			{ type: 1, data: 2 },
		]);
	});

	it("type 1 DATA carries only real values, never sentinels", () => {
		const count = state(0);
		const dataValues: any[] = [];

		count.source(0, (type: number, data: any) => {
			if (type === 1) dataValues.push(data);
		});

		count.set(1);
		count.set(2);

		// type 1 should only have real values — no DIRTY sentinel
		expect(dataValues).toEqual([1, 2]);
		expect(dataValues.every((v) => v !== DIRTY)).toBe(true);
	});

	it("type 3 transparent forwarding convention", () => {
		// A node that doesn't understand type 3 should forward it
		const s = state(0);
		const signals: Array<{ type: number; data: any }> = [];

		// derived forwards type 3 signals
		const d = derived([s], () => s.get() * 2);
		d.source(0, (type: number, data: any) => {
			if (type === STATE) signals.push({ type: STATE, data });
			if (type === 1) signals.push({ type: 1, data });
		});

		s.set(5);

		expect(signals).toEqual([
			{ type: STATE, data: DIRTY },
			{ type: 1, data: 10 },
		]);
	});
});

describe("Producer", () => {
	it("emits values from a push-based producer", () => {
		const s = producer<number>();

		const values: number[] = [];
		subscribe(s, (v) => {
			if (v !== undefined) values.push(v);
		});

		s.emit(1);
		s.emit(2);
		s.emit(3);

		expect(values).toEqual([1, 2, 3]);
		expect(s.get()).toBe(3);
	});

	it("producer fn starts lazily (on first sink)", () => {
		const start = vi.fn();
		const s = producer<number>((_actions) => {
			start();
		});

		expect(start).not.toHaveBeenCalled();
		s.source(0, () => {});
		expect(start).toHaveBeenCalledTimes(1);
	});

	it("producer cleanup runs when all sinks disconnect", () => {
		const cleanup = vi.fn();
		const s = producer<number>((_actions) => {
			return cleanup;
		});

		let talkback: any;
		s.source(0, (type: number, data: any) => {
			if (type === 0) talkback = data;
		});

		expect(cleanup).not.toHaveBeenCalled();
		talkback(2);
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it("producer can be used as dependency in derived", () => {
		const s = producer<number>();

		s.source(0, () => {}); // start producer

		const doubled = derived([s], () => (s.get() ?? 0) * 2);
		expect(doubled.get()).toBe(0);

		s.emit(5);
		expect(doubled.get()).toBe(10);
	});
});

describe("Pipe + operators", () => {
	it("map transforms values", () => {
		const count = state(5);
		const doubled = pipe(
			count,
			map((n) => n * 2),
		);

		expect(doubled.get()).toBe(10);
		count.set(7);
		expect(doubled.get()).toBe(14);
	});

	it("filter starts as undefined (nothing passed yet)", () => {
		const count = state(0);
		const positive = pipe(
			count,
			filter((n) => n > 0),
		);

		expect(positive.get()).toBeUndefined(); // 0 doesn't pass, nothing has passed

		count.set(-1);
		expect(positive.get()).toBeUndefined(); // still nothing passes

		count.set(5);
		expect(positive.get()).toBe(5);

		count.set(-2);
		expect(positive.get()).toBe(5); // keeps last passing
	});

	it("filter with initial value that passes", () => {
		const count = state(10);
		const positive = pipe(
			count,
			filter((n) => n > 0),
		);

		expect(positive.get()).toBe(10); // 10 passes immediately
	});

	it("scan accumulates values", () => {
		const count = state(0);
		const total = pipe(
			count,
			scan((acc, n) => acc + n, 0),
		);

		expect(total.get()).toBe(0);
		count.set(5);
		expect(total.get()).toBe(5);
		count.set(3);
		expect(total.get()).toBe(8);
	});

	it("chains operators — each step is a readable store", () => {
		const count = state(1, { name: "count" });

		const times10 = pipe(
			count,
			map((n: number) => n * 10),
		);
		const gt20 = pipe(
			times10,
			filter((n: number) => n > 20),
		);

		expect(times10.get()).toBe(10);
		expect(gt20.get()).toBeUndefined(); // 10 doesn't pass >20

		count.set(3);
		expect(times10.get()).toBe(30);
		expect(gt20.get()).toBe(30);

		count.set(1);
		expect(times10.get()).toBe(10);
		expect(gt20.get()).toBe(30); // filter keeps last passing
	});

	it("multi-step pipe with filter starting as undefined", () => {
		const count = state(0);
		const result = pipe(
			count,
			map((n) => n * 2),
			filter((n) => n > 0),
			map((n) => (n ?? 0) + 1), // handle undefined from filter
		);

		expect(result.get()).toBe(1); // filter is undefined → map gets undefined → 0+1=1

		count.set(3);
		expect(result.get()).toBe(7); // 3*2=6, passes >0, 6+1=7

		count.set(0);
		expect(result.get()).toBe(7); // 0*2=0, doesn't pass, filter holds 6, 6+1=7
	});
});

describe("Backpressure / pull", () => {
	it("v4.1: derived is lazy — computes on first get() then on changes", () => {
		const count = state(0);
		const computeFn = vi.fn(() => count.get() + 1);
		const d = derived([count], computeFn);

		// v4.1: not computed at construction — fully lazy
		expect(computeFn).toHaveBeenCalledTimes(0);

		// First get() triggers computation + lazy STANDALONE connection
		expect(d.get()).toBe(1); // 0 + 1
		expect(computeFn).toHaveBeenCalledTimes(1);

		count.set(1);
		count.set(2);
		count.set(3);
		// STANDALONE connection recomputes on each state change
		expect(computeFn).toHaveBeenCalledTimes(4); // 1 initial + 3 sets

		expect(d.get()).toBe(4); // 3 + 1, returns cached
		expect(computeFn).toHaveBeenCalledTimes(4); // no extra recompute
	});
});
