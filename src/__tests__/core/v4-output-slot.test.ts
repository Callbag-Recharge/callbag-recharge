/**
 * v4 output slot tests.
 * Verifies output slot transitions, _status lifecycle, and Set optimization.
 */
import { describe, expect, it } from "vitest";
import { derived } from "../../core/derived";
import { effect } from "../../core/effect";
import { operator } from "../../core/operator";
import { DATA, DIRTY, END, START, STATE, batch } from "../../core/protocol";
import { state } from "../../core/state";
import { subscribe } from "../../core/subscribe";
import { producer } from "../../core/producer";

describe("Producer output slot", () => {
	it("null → SINGLE → MULTI → SINGLE → null transitions", () => {
		const p = producer<number>();
		const impl = p as any;

		// Initially null
		expect(impl._output).toBeNull();

		// First subscriber: SINGLE (fn, not Set)
		const values1: number[] = [];
		const unsub1 = subscribe(p, (v) => values1.push(v));
		expect(impl._output).not.toBeNull();
		expect(impl._output).not.toBeInstanceOf(Set);

		// Second subscriber: MULTI (Set)
		const values2: number[] = [];
		const unsub2 = subscribe(p, (v) => values2.push(v));
		expect(impl._output).toBeInstanceOf(Set);
		expect((impl._output as Set<any>).size).toBe(2);

		// Emit reaches both
		p.emit(42);
		expect(values1).toEqual([42]);
		expect(values2).toEqual([42]);

		// Remove second: MULTI → SINGLE
		unsub2();
		expect(impl._output).not.toBeInstanceOf(Set);
		expect(impl._output).not.toBeNull();

		// Emit reaches remaining
		p.emit(99);
		expect(values1).toEqual([42, 99]);
		expect(values2).toEqual([42]); // no longer subscribed

		// Remove last: SINGLE → null
		unsub1();
		expect(impl._output).toBeNull();
	});

	it("Set not allocated for single subscriber (P0 memory optimization)", () => {
		const p = producer<number>();
		const impl = p as any;

		const unsub = subscribe(p, () => {});
		// Should be a function, not a Set
		expect(typeof impl._output === "function" || impl._output !== null).toBe(true);
		expect(impl._output).not.toBeInstanceOf(Set);
		unsub();
	});

	it("_status lifecycle: DISCONNECTED → SETTLED → DIRTY → SETTLED → COMPLETED", () => {
		const p = producer<number>();
		const impl = p as any;

		expect(impl._status).toBe("DISCONNECTED");

		const unsub = subscribe(p, () => {});
		p.emit(1);
		expect(impl._status).toBe("SETTLED");

		// Manual signal
		p.signal(DIRTY);
		expect(impl._status).toBe("DIRTY");

		p.emit(2);
		expect(impl._status).toBe("SETTLED");

		p.complete();
		expect(impl._status).toBe("COMPLETED");
	});

	it("_status ERRORED on error()", () => {
		const p = producer<number>();
		const impl = p as any;

		subscribe(p, () => {}, { onEnd: () => {} });
		p.error("boom");
		expect(impl._status).toBe("ERRORED");
	});

	it("_status DISCONNECTED when last subscriber leaves", () => {
		const p = producer<number>();
		const impl = p as any;

		const unsub = subscribe(p, () => {});
		p.emit(1);
		expect(impl._status).toBe("SETTLED");

		unsub();
		expect(impl._status).toBe("DISCONNECTED");
	});
});

describe("Operator output slot", () => {
	it("null → SINGLE → MULTI → SINGLE → null transitions", () => {
		const a = state(0);
		const op = operator<number>([a], (actions) => {
			return (_depIndex, type, data) => {
				if (type === STATE) actions.signal(data);
				if (type === DATA) actions.emit(data * 2);
				if (type === END) data !== undefined ? actions.error(data) : actions.complete();
			};
		});
		const impl = op as any;

		expect(impl._output).toBeNull();

		const values1: number[] = [];
		const unsub1 = subscribe(op, (v) => values1.push(v));
		expect(impl._output).not.toBeNull();
		expect(impl._output).not.toBeInstanceOf(Set);

		const values2: number[] = [];
		const unsub2 = subscribe(op, (v) => values2.push(v));
		expect(impl._output).toBeInstanceOf(Set);

		a.set(5);
		expect(values1).toEqual([10]);
		expect(values2).toEqual([10]);

		unsub2();
		expect(impl._output).not.toBeInstanceOf(Set);

		unsub1();
		expect(impl._output).toBeNull();
	});

	it("_status lifecycle for operator", () => {
		const a = state(0);
		const op = operator<number>([a], (actions) => {
			return (_depIndex, type, data) => {
				if (type === STATE) actions.signal(data);
				if (type === DATA) actions.emit(data);
				if (type === END) data !== undefined ? actions.error(data) : actions.complete();
			};
		});
		const impl = op as any;

		expect(impl._status).toBe("DISCONNECTED");

		const unsub = subscribe(op, () => {});

		a.set(1);
		expect(impl._status).toBe("SETTLED");

		unsub();
		expect(impl._status).toBe("DISCONNECTED");
	});
});

describe("Derived output slot", () => {
	it("STANDALONE → SINGLE → MULTI → SINGLE → STANDALONE transitions", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const impl = b as any;

		// STANDALONE: no external subscribers, but connected
		expect(impl._output).toBeNull();
		expect(impl._flags & 16).toBeTruthy(); // D_STANDALONE
		expect(b.get()).toBe(2); // value is current

		// SINGLE: first external subscriber
		const values1: number[] = [];
		const unsub1 = subscribe(b, (v) => values1.push(v));
		expect(impl._flags & 16).toBeFalsy(); // D_STANDALONE cleared
		expect(impl._output).not.toBeNull();
		expect(impl._output).not.toBeInstanceOf(Set);

		// MULTI: second external subscriber
		const values2: number[] = [];
		const unsub2 = subscribe(b, (v) => values2.push(v));
		expect(impl._output).toBeInstanceOf(Set);

		a.set(5);
		expect(values1).toEqual([10]);
		expect(values2).toEqual([10]);

		// MULTI → SINGLE
		unsub2();
		expect(impl._output).not.toBeInstanceOf(Set);

		a.set(8);
		expect(values1).toEqual([10, 16]);
		expect(values2).toEqual([10]); // no longer subscribed

		// SINGLE → STANDALONE
		unsub1();
		expect(impl._output).toBeNull();
		expect(impl._flags & 16).toBeTruthy(); // D_STANDALONE back

		// STANDALONE: value still current
		a.set(9);
		expect(b.get()).toBe(18); // still reactive
	});

	it("_status full lifecycle for derived", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const impl = b as any;

		// After construction: SETTLED (computed initial)
		expect(impl._status).toBe("SETTLED");

		// After state change: should go through DIRTY → SETTLED
		// We verify the final state after the synchronous cycle
		a.set(5);
		expect(impl._status).toBe("SETTLED");
		expect(b.get()).toBe(10);
	});

	it("STANDALONE: get() returns current value with no external subscribers", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);

		expect(b.get()).toBe(2);
		a.set(5);
		expect(b.get()).toBe(10);
		a.set(100);
		expect(b.get()).toBe(200);
	});

	it("transition preserves value: subscribing doesn't double-emit", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);

		expect(b.get()).toBe(2);

		// Subscribe should NOT trigger a re-emission of the current value
		const values: number[] = [];
		const unsub = subscribe(b, (v) => values.push(v));

		// No emission on subscribe (only reactive changes)
		expect(values).toEqual([]);

		a.set(5);
		expect(values).toEqual([10]);
		unsub();
	});

	it("P0: single-dep derived has no bitmask overhead", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const impl = b as any;

		// Single-dep should not use _dirtyDeps (always 0)
		expect(impl._dirtyDeps).toBe(0);

		a.set(5);
		expect(impl._dirtyDeps).toBe(0);
		expect(b.get()).toBe(10);
	});

	it("multi-dep diamond: C computes exactly once per a.set()", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([a, b], () => a.get() + b.get());

		let cCount = 0;
		effect([c], () => {
			cCount++;
		});
		// Effect runs once on creation (initial)
		expect(cCount).toBe(1);

		a.set(5);
		expect(cCount).toBe(2); // 1 initial + 1 for set(5)
		expect(c.get()).toBe(15); // 5 + 10
	});

	it("diamond topology with output slots", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([a, b], () => a.get() + b.get());

		let cCount = 0;
		effect([c], () => {
			cCount++;
		});

		// Verify with multiple subscribers to B (MULTI mode)
		const bValues: number[] = [];
		const unsub = subscribe(b, (v) => bValues.push(v));
		a.set(10);
		expect(cCount).toBe(2); // once for initial effect, once for set(10)... wait
		// Effect runs on creation (initial) + on a.set(10)
		// Actually cCount starts at 1 from initial effect run
		// Then a.set(10) triggers one more
		expect(c.get()).toBe(30); // 10 + 20
		expect(bValues).toEqual([20]);
		unsub();
	});

	it("chain assembled once: verify no rewiring on reconnect", () => {
		const a = state(1);
		let computeCount = 0;
		const b = derived([a], () => {
			computeCount++;
			return a.get() * 2;
		});

		// Initial computation at construction
		expect(computeCount).toBe(1);

		// Subscribe and unsubscribe multiple times
		const unsub1 = subscribe(b, () => {});
		unsub1();
		const unsub2 = subscribe(b, () => {});
		unsub2();

		// No extra computations from subscribe/unsubscribe
		expect(computeCount).toBe(1);

		// State change recomputes once
		a.set(5);
		expect(computeCount).toBe(2);
		expect(b.get()).toBe(10);
	});

	it("DATA without prior DIRTY (raw callbag compat) still works", () => {
		// Create a raw callbag source that sends DATA without DIRTY
		let rawSink: ((type: number, data?: any) => void) | null = null;
		const rawSource: any = {
			get: () => 42,
			source: (type: number, payload: any) => {
				if (type === START) {
					rawSink = payload;
					payload(START, () => {});
				}
			},
		};

		const b = derived([rawSource], () => rawSource.get());

		const values: number[] = [];
		const unsub = subscribe(b, (v) => values.push(v));

		// Update get() BEFORE sending DATA (so fn() reads the new value)
		(rawSource as any).get = () => 100;
		// Raw source sends DATA without prior DIRTY
		rawSink?.(DATA, 100);

		// Derived should still recompute
		expect(values.length).toBe(1);
		expect(b.get()).toBe(100);
		unsub();
	});

	it("equals guard → RESOLVED → subtree skip", () => {
		const a = state(1);
		const b = derived([a], () => (a.get() >= 10 ? "high" : "low"), {
			equals: Object.is,
		});

		let cCount = 0;
		const c = derived([b], () => {
			cCount++;
			return b.get();
		});

		// Initial: cCount = 1 (from construction)
		expect(cCount).toBe(1);

		effect([c], () => {});

		a.set(2); // still "low" — b sends RESOLVED
		expect(cCount).toBe(1); // c did not recompute
		expect(c.get()).toBe("low");

		a.set(15); // now "high" — b sends DATA
		expect(cCount).toBe(2); // c recomputed once
		expect(c.get()).toBe("high");
	});
});

describe("Multi-subscriber derived completion", () => {
	it("upstream END dispatches to all subscribers in MULTI mode", () => {
		const p = producer<number>();
		const d = derived([p], () => p.get() ?? 0);

		const ended1: unknown[] = [];
		const ended2: unknown[] = [];

		// Two external subscribers → MULTI mode
		const unsub1 = subscribe(d, () => {}, { onEnd: (e) => ended1.push(e) });
		const unsub2 = subscribe(d, () => {}, { onEnd: (e) => ended2.push(e) });

		// Verify MULTI mode
		expect((d as any)._output).toBeInstanceOf(Set);

		// Upstream completes → derived should forward END to both
		p.complete();

		expect(ended1.length).toBe(1);
		expect(ended2.length).toBe(1);
		expect((d as any)._status).toBe("COMPLETED");
	});

	it("upstream error dispatches to all subscribers in MULTI mode", () => {
		const p = producer<number>();
		const d = derived([p], () => p.get() ?? 0);

		const errors1: unknown[] = [];
		const errors2: unknown[] = [];

		const unsub1 = subscribe(d, () => {}, { onEnd: (e) => errors1.push(e) });
		const unsub2 = subscribe(d, () => {}, { onEnd: (e) => errors2.push(e) });

		p.error("boom");

		expect(errors1).toEqual(["boom"]);
		expect(errors2).toEqual(["boom"]);
		expect((d as any)._status).toBe("ERRORED");
	});
});

describe("Batch coalescing through output slot", () => {
	it("batch still works through output slot", () => {
		const a = state(0);
		const b = derived([a], () => a.get() * 2);

		let effectCount = 0;
		effect([b], () => {
			effectCount++;
		});

		batch(() => {
			a.set(1);
			a.set(2);
			a.set(3);
		});

		// Effect should run once (coalesced)
		expect(effectCount).toBe(2); // 1 initial + 1 batched
		expect(b.get()).toBe(6);
	});
});
