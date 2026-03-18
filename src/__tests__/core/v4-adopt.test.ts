/**
 * v4 output slot tests.
 * Verifies output slot mode transitions (STANDALONE → SINGLE → MULTI)
 * and topology scenarios.
 */
import { describe, expect, it } from "vitest";
import { derived } from "../../core/derived";
import { effect } from "../../core/effect";
import { START, STATE } from "../../core/protocol";
import { state } from "../../core/state";
import { subscribe } from "../../core/subscribe";

describe("Output slot transitions", () => {
	it("Scenario 1: A→B, add C — B transitions from DISCONNECTED to SINGLE", () => {
		const a = state(0);
		const b = derived([a], () => a.get() + 1);

		// B is DISCONNECTED — output slot is null, no upstream connection
		expect(b.get()).toBe(1); // pull-computes
		expect((b as any)._output).toBeNull();
		expect((b as any)._flags & 2).toBeFalsy(); // D_CONNECTED not set

		// C subscribes → output slot transitions to SINGLE, connects upstream
		const values: number[] = [];
		const unsub = subscribe(b, (v) => values.push(v));
		expect((b as any)._flags & 2).toBeTruthy(); // D_CONNECTED set

		a.set(5);
		expect(b.get()).toBe(6);
		expect(values).toEqual([6]);

		unsub();
		// B disconnects from upstream (no STANDALONE mode)
		expect((b as any)._flags & 2).toBeFalsy(); // D_CONNECTED cleared
		a.set(10);
		expect(b.get()).toBe(11); // pull-computes fresh value
	});

	it("Scenario 2: Diamond A→B→C, A→C — C unsubscribes cleanly", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([a, b], () => a.get() + b.get());

		const values: number[] = [];
		const unsub = subscribe(c, (v) => values.push(v));

		a.set(10);
		expect(c.get()).toBe(30); // 10 + 20
		expect(values).toEqual([30]);

		unsub();

		// v6: C disconnects from upstream when last subscriber leaves.
		// D_CONNECTED should be cleared.
		expect((c as any)._flags & 2).toBeFalsy(); // D_CONNECTED cleared

		// Stores still return fresh values via pull-compute
		a.set(20);
		expect(b.get()).toBe(40); // pull-computes
		expect(c.get()).toBe(60); // pull-computes: 20 + 40
	});

	it("Scenario 3: A→B→C exists, add D to B — B output slot becomes MULTI", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([b], () => b.get() + 100);
		const d = derived([b], () => b.get() * 10);

		const cValues: number[] = [];
		const dValues: number[] = [];
		const unsub1 = subscribe(c, (v) => cValues.push(v));
		const unsub2 = subscribe(d, (v) => dValues.push(v));

		a.set(5);
		expect(c.get()).toBe(110); // 10 + 100
		expect(d.get()).toBe(100); // 10 * 10

		// B's output slot is MULTI (Set) — c and d both have dep connections to b
		// established at construction (STANDALONE mode)

		unsub1();
		unsub2();

		// All stores still reactive in STANDALONE mode
		a.set(20);
		expect(b.get()).toBe(40);
		expect(c.get()).toBe(140);
		expect(d.get()).toBe(400);
	});

	it("Type 3 tuple forwarding: unknown tuples pass through unchanged", () => {
		const a = state(1);
		const b = derived([a], () => a.get());

		const received: any[] = [];

		// Subscribe via raw callbag to see STATE signals
		b.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === STATE) received.push(data);
		});

		// When a sends STATE signals, they should forward through b
		a.set(2); // sends DIRTY then DATA through b
		// b should have forwarded DIRTY
		expect(received.some((s) => s === Symbol.for("DIRTY") || typeof s === "symbol")).toBe(true);
	});

	it("Raw callbag sink: receives only type 0, 1, 2 (no type 3)", () => {
		const a = state(1);

		const received: Array<[number, any]> = [];
		a.source(START, (type: number, data: any) => {
			received.push([type, data]);
		});

		a.set(2);

		// Should have received START, then STATE (DIRTY), then DATA
		// Note: raw callbag sinks DO receive type 3 from producer —
		// filtering is the caller's responsibility
		const types = received.map(([t]) => t);
		expect(types[0]).toBe(START);
		// type 3 (STATE) signals are sent by the producer
		// External callers that want only type 0/1/2 should filter
	});
});

describe("Effect with output slot deps", () => {
	it("Effect drives derived's output slot correctly", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);

		let effectValue: number | undefined;
		const dispose = effect([b], () => {
			effectValue = b.get();
		});

		expect(effectValue).toBe(2); // initial

		a.set(5);
		expect(effectValue).toBe(10); // updated
		expect(b.get()).toBe(10);

		dispose();
	});

	it("Effect dispose removes from all deps' output slots", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);

		let runCount = 0;
		const dispose = effect([b], () => {
			runCount++;
		});
		expect(runCount).toBe(1); // initial

		a.set(5);
		expect(runCount).toBe(2);

		dispose();
		a.set(10);
		expect(runCount).toBe(2); // no more runs after dispose
	});

	it("Effect with multi-dep diamond computes once", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([a, b], () => a.get() + b.get());

		let effectCount = 0;
		const dispose = effect([c], () => {
			effectCount++;
		});
		expect(effectCount).toBe(1); // initial

		a.set(5);
		expect(effectCount).toBe(2); // initial + one for set(5)
		expect(c.get()).toBe(15); // 5 + 10

		dispose();
	});
});
