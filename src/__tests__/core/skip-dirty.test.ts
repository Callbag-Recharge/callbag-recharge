// ---------------------------------------------------------------------------
// Skip DIRTY optimization tests — SINGLE_DEP talkback signaling
// ---------------------------------------------------------------------------
// When a single-dep subscriber (derived, effect, operator) connects to a
// source (producer/state), it signals SINGLE_DEP via the talkback. The source
// sets P_SKIP_DIRTY and skips DIRTY dispatch in the unbatched path. Downstream
// nodes handle DATA-without-DIRTY correctly. During batching, DIRTY is still
// dispatched (the optimization only applies to the unbatched else-branch).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { Inspector } from "../../core/inspector";
import { P_SKIP_DIRTY } from "../../core/producer";
import { map } from "../../extra/map";
import { batch, DIRTY, derived, effect, pipe, producer, state } from "../../index";

describe("Skip DIRTY optimization", () => {
	// -----------------------------------------------------------------------
	// P_SKIP_DIRTY flag management
	// -----------------------------------------------------------------------

	it("state sets P_SKIP_DIRTY when single-dep derived subscribes", () => {
		const s = state(0);
		const d = derived([s], () => s.get() * 2);

		// Subscribe to trigger connection
		const dispose = Inspector.activate(d);

		expect((s as any)._flags & P_SKIP_DIRTY).toBeTruthy();
		dispose();
	});

	it("state clears P_SKIP_DIRTY on SINGLE→MULTI transition", () => {
		const s = state(0);
		const d1 = derived([s], () => s.get() * 2);
		const d2 = derived([s], () => s.get() + 1);

		const dispose1 = Inspector.activate(d1);
		expect((s as any)._flags & P_SKIP_DIRTY).toBeTruthy();

		const dispose2 = Inspector.activate(d2);
		expect((s as any)._flags & P_SKIP_DIRTY).toBeFalsy();
		dispose1();
		dispose2();
	});

	it("state clears P_SKIP_DIRTY when subscriber disconnects", () => {
		const s = state(0);
		const d = derived([s], () => s.get() * 2);

		const dispose = Inspector.activate(d);

		expect((s as any)._flags & P_SKIP_DIRTY).toBeTruthy();

		// Disconnect derived from state
		dispose();
		expect((s as any)._flags & P_SKIP_DIRTY).toBeFalsy();
	});

	it("producer sets P_SKIP_DIRTY when single-dep derived subscribes", () => {
		const p = producer<number>(({ emit }) => {
			emit(42);
		});

		const d = derived([p], () => p.get());
		const dispose = Inspector.activate(d);

		expect((p as any)._flags & P_SKIP_DIRTY).toBeTruthy();
		dispose();
	});

	// -----------------------------------------------------------------------
	// Unbatched path: DIRTY skipped for single-dep subscribers
	// -----------------------------------------------------------------------

	it("state → single-dep derived: DATA without DIRTY in unbatched mode", () => {
		const s = state(0);
		const d = derived([s], () => s.get() * 2);

		const obs = Inspector.observe(d);

		s.set(5);

		// Derived receives DATA and synthesizes DIRTY for its own downstream
		expect(obs.signals.some((sig) => sig === DIRTY)).toBe(true);
		expect(obs.values.some((v) => v === 10)).toBe(true);
		expect(d.get()).toBe(10);
		obs.dispose();
	});

	it("state → single-dep effect: runs fn on DATA without DIRTY", () => {
		const s = state(0);
		const values: number[] = [];

		effect([s], () => {
			values.push(s.get());
			return undefined;
		});

		s.set(1);
		s.set(2);

		// Initial run + 2 updates
		expect(values).toEqual([0, 1, 2]);
	});

	it("state → single-dep operator (map): emits mapped value without DIRTY", () => {
		const s = state(0);
		const mapped = pipe(
			s,
			map((x: number) => x * 10),
		);

		const obs = Inspector.observe(mapped);

		s.set(3);
		s.set(7);

		expect(obs.values).toEqual([30, 70]);
		expect(mapped.get()).toBe(70);
		obs.dispose();
	});

	// -----------------------------------------------------------------------
	// Batched path: DIRTY still dispatched (optimization doesn't apply)
	// -----------------------------------------------------------------------

	it("state → single-dep derived: DIRTY sent during batch", () => {
		const s = state(0);
		const d = derived([s], () => s.get() * 2);

		const obs = Inspector.observe(d);

		batch(() => s.set(5));

		expect(obs.signals).toContain(DIRTY);
		obs.dispose();
	});

	it("state → single-dep operator: DIRTY forwarded during batch", () => {
		const s = state(0);
		const mapped = pipe(
			s,
			map((x: number) => x * 10),
		);

		const obs = Inspector.observe(mapped);

		batch(() => s.set(5));

		expect(obs.signals).toContain(DIRTY);
		obs.dispose();
	});

	// -----------------------------------------------------------------------
	// Diamond resolution preserved
	// -----------------------------------------------------------------------

	it("state(SKIP_DIRTY) → derived(single-dep) → multi-dep derived: diamond safe", () => {
		const a = state(1);
		const b = state(10);

		// Single-dep derived on a — gets P_SKIP_DIRTY
		const doubled = derived([a], () => a.get() * 2);

		// Multi-dep derived depending on doubled and b
		const combined = derived([doubled, b], () => doubled.get() + b.get());

		const dispose = Inspector.activate(combined);

		// Change only a (unbatched) — derived synthesizes DIRTY for combined
		a.set(5);
		expect(combined.get()).toBe(20); // 5*2 + 10

		// Change only b (unbatched)
		b.set(100);
		expect(combined.get()).toBe(110); // 5*2 + 100

		// Change both in batch — diamond resolution works
		batch(() => {
			a.set(3);
			b.set(50);
		});
		expect(combined.get()).toBe(56); // 3*2 + 50
		dispose();
	});

	it("state → operator → multi-dep derived: no glitch in unbatched mode", () => {
		const a = state(1);
		const b = state(10);

		const mapped = pipe(
			a,
			map((x: number) => x * 2),
		);

		const combined = derived([mapped, b], () => mapped.get() + b.get());

		const obs = Inspector.observe(combined);

		// Each set is independent in unbatched mode
		a.set(5);
		expect(obs.values).toContain(20); // 5*2 + 10

		b.set(100);
		expect(combined.get()).toBe(110);
		obs.dispose();
	});

	// -----------------------------------------------------------------------
	// Multi-subscriber: DIRTY resumes when SINGLE→MULTI
	// -----------------------------------------------------------------------

	it("DIRTY resumes after second subscriber added", () => {
		const s = state(0);
		const d1 = derived([s], () => s.get());

		const dispose1 = Inspector.activate(d1);
		expect((s as any)._flags & P_SKIP_DIRTY).toBeTruthy();

		// Add second subscriber directly to state
		const obs2 = Inspector.observe(s);

		// Now MULTI — P_SKIP_DIRTY should be cleared
		expect((s as any)._flags & P_SKIP_DIRTY).toBeFalsy();

		s.set(1);
		// DIRTY should be dispatched again
		expect(obs2.signals).toContain(DIRTY);
		dispose1();
		obs2.dispose();
	});

	// -----------------------------------------------------------------------
	// Reconnection: SINGLE_DEP re-signaled after disconnect/reconnect
	// -----------------------------------------------------------------------

	it("P_SKIP_DIRTY restored after derived reconnects", () => {
		const s = state(0);
		const d = derived([s], () => s.get() * 2);

		// First subscription
		const dispose1 = Inspector.activate(d);
		expect((s as any)._flags & P_SKIP_DIRTY).toBeTruthy();

		// Disconnect
		dispose1();
		expect((s as any)._flags & P_SKIP_DIRTY).toBeFalsy();

		// Reconnect
		const dispose2 = Inspector.activate(d);
		expect((s as any)._flags & P_SKIP_DIRTY).toBeTruthy();

		// Values still correct
		s.set(7);
		expect(d.get()).toBe(14);
		dispose2();
	});

	// -----------------------------------------------------------------------
	// Non-single-dep subscriber: P_SKIP_DIRTY not set
	// -----------------------------------------------------------------------

	it("multi-dep derived does not set P_SKIP_DIRTY on its deps", () => {
		const a = state(0);
		const b = state(0);
		const d = derived([a, b], () => a.get() + b.get());

		const dispose = Inspector.activate(d);

		// Multi-dep derived doesn't send SINGLE_DEP
		expect((a as any)._flags & P_SKIP_DIRTY).toBeFalsy();
		expect((b as any)._flags & P_SKIP_DIRTY).toBeFalsy();
		dispose();
	});

	it("multi-dep effect does not set P_SKIP_DIRTY on its deps", () => {
		const a = state(0);
		const b = state(0);

		effect([a, b], () => undefined);

		expect((a as any)._flags & P_SKIP_DIRTY).toBeFalsy();
		expect((b as any)._flags & P_SKIP_DIRTY).toBeFalsy();
	});

	// -----------------------------------------------------------------------
	// MULTI→SINGLE transition: P_SKIP_DIRTY restored
	// -----------------------------------------------------------------------

	it("P_SKIP_DIRTY restored when MULTI drops back to SINGLE (single-dep remains)", () => {
		const s = state(0);
		const d = derived([s], () => s.get());

		const dispose1 = Inspector.activate(d);
		expect((s as any)._flags & P_SKIP_DIRTY).toBeTruthy();

		// Add raw subscriber — MULTI, P_SKIP_DIRTY cleared
		const dispose2 = Inspector.activate(s);
		expect((s as any)._flags & P_SKIP_DIRTY).toBeFalsy();

		// Raw subscriber disconnects — back to SINGLE, P_SKIP_DIRTY restored
		dispose2();
		expect((s as any)._flags & P_SKIP_DIRTY).toBeTruthy();

		// Optimization works again
		const dispose3 = Inspector.activate(d);

		s.set(1);
		// Derived synthesizes DIRTY, but state didn't dispatch DIRTY
		expect(d.get()).toBe(1);
		dispose1();
		dispose3();
	});

	it("P_SKIP_DIRTY NOT restored when non-single-dep subscriber remains", () => {
		const s = state(0);
		const d = derived([s], () => s.get());

		// Single-dep subscriber
		const dispose1 = Inspector.activate(d);
		expect((s as any)._flags & P_SKIP_DIRTY).toBeTruthy();

		// Raw subscriber (not single-dep)
		const dispose2 = Inspector.activate(s);
		expect((s as any)._flags & P_SKIP_DIRTY).toBeFalsy();

		// Single-dep subscriber disconnects — raw remains, P_SKIP_DIRTY stays off
		dispose1();
		expect((s as any)._flags & P_SKIP_DIRTY).toBeFalsy();
		dispose2();
	});

	// -----------------------------------------------------------------------
	// P_SKIP_DIRTY cleared on complete/error (P1 fix)
	// -----------------------------------------------------------------------

	it("P_SKIP_DIRTY cleared on producer complete()", () => {
		const p = producer<number>(
			({ emit }) => {
				emit(1);
				// Don't complete yet — we'll test resubscription
			},
			{ resubscribable: true },
		);

		const d = derived([p], () => p.get());
		const dispose = Inspector.activate(d);
		expect((p as any)._flags & P_SKIP_DIRTY).toBeTruthy();

		// Complete the producer
		(p as any).complete();
		expect((p as any)._flags & P_SKIP_DIRTY).toBeFalsy();
		dispose();
	});

	it("P_SKIP_DIRTY cleared on producer error()", () => {
		const p = producer<number>(
			({ emit }) => {
				emit(1);
			},
			{ resubscribable: true },
		);

		const d = derived([p], () => p.get());
		const dispose = Inspector.activate(d);
		expect((p as any)._flags & P_SKIP_DIRTY).toBeTruthy();

		// Error the producer
		(p as any).error(new Error("test"));
		expect((p as any)._flags & P_SKIP_DIRTY).toBeFalsy();
		dispose();
	});
});
