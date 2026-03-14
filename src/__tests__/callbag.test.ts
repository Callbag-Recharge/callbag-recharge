// ---------------------------------------------------------------------------
// Tests mirroring common callbag utility behavior
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import { filter } from "../extra/filter";
import { map } from "../extra/map";
import { scan } from "../extra/scan";
import { DIRTY, derived, Inspector, pipe, state, stream, subscribe } from "../index";

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
			if (type === 1 && data !== DIRTY) pulledValue = data;
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
			if (type === 1 && data === DIRTY) dirtyCount++;
		});

		count.set(1);
		expect(dirtyCount).toBe(1);

		talkback(2); // disconnect
		count.set(2);
		expect(dirtyCount).toBe(1);
	});

	it("pushes DIRTY symbol (not values) on state change", () => {
		const count = state(0);
		const received: any[] = [];

		count.source(0, (type: number, data: any) => {
			if (type === 1) received.push(data);
		});

		count.set(1);
		count.set(2);
		expect(received).toEqual([DIRTY, DIRTY]);
	});
});

describe("Stream", () => {
	it("emits values from a push-based producer", () => {
		let emitter: (v: number) => void;
		const s = stream<number>((emit) => {
			emitter = emit;
		});

		const values: number[] = [];
		subscribe(s, (v) => {
			if (v !== undefined) values.push(v);
		});

		emitter?.(1);
		emitter?.(2);
		emitter?.(3);

		expect(values).toEqual([1, 2, 3]);
		expect(s.get()).toBe(3);
	});

	it("producer starts lazily (on first sink)", () => {
		const start = vi.fn();
		const s = stream<number>((_emit) => {
			start();
		});

		expect(start).not.toHaveBeenCalled();
		s.source(0, () => {});
		expect(start).toHaveBeenCalledTimes(1);
	});

	it("producer cleanup runs when all sinks disconnect", () => {
		const cleanup = vi.fn();
		const s = stream<number>((_emit) => {
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

	it("stream can be used as dependency in derived", () => {
		let emitter: (v: number) => void;
		const s = stream<number>((emit) => {
			emitter = emit;
		});

		s.source(0, () => {}); // start producer

		const doubled = derived([s], () => (s.get() ?? 0) * 2);
		expect(doubled.get()).toBe(0);

		emitter?.(5);
		expect(doubled.get()).toBe(10);
	});

	it("pull-based stream responds to .pull()", () => {
		let count = 0;
		const s = stream<number>((emit, request) => {
			request(() => {
				count++;
				emit(count);
			});
		});

		s.source(0, () => {}); // start producer
		expect(s.get()).toBeUndefined(); // nothing emitted yet

		s.pull();
		expect(s.get()).toBe(1);

		s.pull();
		expect(s.get()).toBe(2);
	});

	it(".pull() on non-pullable stream throws", () => {
		const s = stream<number>((_emit) => {
			// push-only, no request() call
		});

		s.source(0, () => {});

		expect(() => s.pull()).toThrow("not pullable");
	});

	it(".pull() error does not disconnect the stream", () => {
		let emitter: (v: number) => void;
		const s = stream<number>((emit) => {
			emitter = emit;
		});

		s.source(0, () => {});

		expect(() => s.pull()).toThrow();

		// Should still work after the error
		emitter?.(42);
		expect(s.get()).toBe(42);
	});

	it("pull-based stream works with derived", () => {
		let count = 0;
		const s = stream<number>((emit, request) => {
			request(() => emit(++count));
		});

		s.source(0, () => {});

		const doubled = derived([s], () => (s.get() ?? 0) * 2);

		expect(doubled.get()).toBe(0); // nothing pulled yet

		s.pull();
		expect(doubled.get()).toBe(2); // count=1, doubled=2

		s.pull();
		expect(doubled.get()).toBe(4); // count=2, doubled=4
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
	it("derived does not compute until pulled", () => {
		const count = state(0);
		const computeFn = vi.fn(() => count.get() + 1);
		const d = derived([count], computeFn);

		// Should NOT have computed yet
		expect(computeFn).toHaveBeenCalledTimes(0);

		count.set(1);
		count.set(2);
		count.set(3);
		// Still not computed — nobody pulled
		expect(computeFn).toHaveBeenCalledTimes(0);

		d.get();
		expect(computeFn).toHaveBeenCalledTimes(1);
		expect(d.get()).toBe(4); // 3 + 1
	});
});
