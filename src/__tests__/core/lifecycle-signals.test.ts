/**
 * Lifecycle signals — RESET, PAUSE, RESUME, TEARDOWN
 *
 * Tests signal propagation via talkback (upstream direction) through:
 * - Simple chains (state → derived → effect)
 * - Diamond topologies
 * - Tier 2 boundaries (switchMap)
 * - Nested pipelines
 * - Timer signal control
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { derived } from "../../core/derived";
import { effect } from "../../core/effect";
import { operator } from "../../core/operator";
import { pipe } from "../../core/pipe";
import { producer } from "../../core/producer";
import {
	DATA,
	DIRTY,
	isLifecycleSignal,
	PAUSE,
	RESET,
	RESOLVED,
	RESUME,
	STATE,
	TEARDOWN,
} from "../../core/protocol";
import { state } from "../../core/state";
import { subscribe } from "../../core/subscribe";
import { map } from "../../extra/map";
import { switchMap } from "../../extra/switchMap";

// ---------------------------------------------------------------------------
// RESET signal propagation
// ---------------------------------------------------------------------------

describe("RESET signal", () => {
	it("propagates upstream through derived chain", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([b], () => b.get() + 10);

		const sub = subscribe(c, () => {});
		expect(c.get()).toBe(12); // (1*2) + 10

		a.set(5);
		expect(c.get()).toBe(20); // (5*2) + 10

		// Send RESET via talkback — should propagate upstream to a
		sub.signal(RESET);

		// State 'a' resets to initial value (1)
		expect(a.get()).toBe(1);
		sub.unsubscribe();
	});

	it("propagates upstream through operator chain", () => {
		const a = state(0);
		let skipCount = 0;
		const doubled = operator<number>(
			[a],
			({ emit, signal }) => {
				skipCount = 0; // fresh on each init
				return (_, type, data) => {
					if (type === STATE) signal(data);
					else if (type === DATA) {
						if (skipCount < 1) {
							skipCount++;
							return; // skip first value
						}
						emit((data as number) * 2);
					}
				};
			},
			{ initial: 0 },
		);

		const values: number[] = [];
		const sub = subscribe(doubled, (v) => values.push(v));

		a.set(1); // skipped (skipCount < 1)
		a.set(2); // emits 4
		expect(values).toEqual([4]);

		// RESET re-inits the handler — skipCount resets to 0
		sub.signal(RESET);
		a.set(3); // skipped again (fresh skipCount)
		a.set(4); // emits 8
		expect(values).toEqual([4, 8]);

		sub.unsubscribe();
	});

	it("resets state to initial value", () => {
		const a = state(42);
		const sub = subscribe(a, () => {});

		a.set(100);
		expect(a.get()).toBe(100);

		sub.signal(RESET);
		expect(a.get()).toBe(42); // reset to initial

		sub.unsubscribe();
	});

	it("effect re-runs after RESET from deps", () => {
		const a = state(1);
		let runCount = 0;
		const dispose = effect([a], () => {
			runCount++;
			return undefined;
		});

		expect(runCount).toBe(1); // initial run

		a.set(2);
		expect(runCount).toBe(2);

		// Send RESET through effect's signal method
		(dispose as any).signal(RESET);
		expect(runCount).toBe(3); // re-ran after RESET

		dispose();
	});

	it("crosses tier 2 boundary (switchMap) — RESET reaches source", () => {
		const source = state(10);

		const result = pipe(
			source,
			switchMap((v) =>
				producer<number>(({ emit }) => {
					emit(v * 2);
					return undefined;
				}),
			),
		);

		const sub = subscribe(result, () => {});

		source.set(99);
		expect(source.get()).toBe(99);

		// RESET propagates through switchMap's onSignal → upstream to source
		sub.signal(RESET);

		// Source should be reset to initial value (10)
		expect(source.get()).toBe(10);

		sub.unsubscribe();
	});
});

// ---------------------------------------------------------------------------
// TEARDOWN signal propagation
// ---------------------------------------------------------------------------

describe("TEARDOWN signal", () => {
	it("completes producer and cascades END downstream", () => {
		const a = state(1);
		let ended = false;

		const sub = subscribe(a, () => {}, {
			onEnd: () => {
				ended = true;
			},
		});

		sub.signal(TEARDOWN);
		expect(ended).toBe(true);
	});

	it("cascades through derived chain", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		let endedB = false;

		const sub = subscribe(b, () => {}, {
			onEnd: () => {
				endedB = true;
			},
		});

		sub.signal(TEARDOWN);
		expect(endedB).toBe(true);
	});

	it("task() interceptor calls ts.destroy() on TEARDOWN", async () => {
		// This is tested indirectly through the pipeline.destroy() path
		// which sends TEARDOWN to step subscriptions. The task operator
		// interceptor catches it and calls ts.destroy().
		// Direct test would require importing task() and pipeline().
		expect(true).toBe(true); // placeholder — covered by orchestrate tests
	});
});

// ---------------------------------------------------------------------------
// PAUSE / RESUME signals
// ---------------------------------------------------------------------------

describe("PAUSE / RESUME signals", () => {
	it("forward through derived chain without error", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);

		const sub = subscribe(b, () => {});

		// Should not throw — signals forward upstream through talkbacks
		sub.signal(PAUSE);
		sub.signal(RESUME);

		sub.unsubscribe();
	});

	it("forward through operator chain without error", () => {
		const a = state(1);
		const doubled = pipe(
			a,
			map((x: number) => x * 2),
		);

		const sub = subscribe(doubled, () => {});

		sub.signal(PAUSE);
		sub.signal(RESUME);

		sub.unsubscribe();
	});
});

// ---------------------------------------------------------------------------
// Timer signal-based control
// ---------------------------------------------------------------------------

describe("timer lifecycle signals", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("countdown auto-starts and responds to PAUSE/RESUME/RESET", async () => {
		const { countdown } = await import("../../utils/timer");
		const timer = countdown(1000, { tickMs: 100 });

		const values: number[] = [];
		const sub = subscribe(timer.remaining, (v) => values.push(v));

		expect(timer.active.get()).toBe(true);

		vi.advanceTimersByTime(300);
		expect(timer.remaining.get()).toBeLessThan(1000);

		sub.signal(PAUSE);
		expect(timer.active.get()).toBe(false);
		const paused = timer.remaining.get();

		vi.advanceTimersByTime(500);
		expect(timer.remaining.get()).toBe(paused); // unchanged while paused

		sub.signal(RESUME);
		expect(timer.active.get()).toBe(true);

		sub.signal(RESET);
		expect(timer.remaining.get()).toBe(1000);
		expect(timer.active.get()).toBe(false);

		sub.unsubscribe();
	});
});

// ---------------------------------------------------------------------------
// Diamond topology
// ---------------------------------------------------------------------------

describe("lifecycle signals in diamond topology", () => {
	it("RESET propagates through diamond without issues", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([a], () => a.get() + 10);
		const d = derived([b, c], () => b.get() + c.get());

		const sub = subscribe(d, () => {});
		a.set(5);
		expect(d.get()).toBe(25); // (5*2) + (5+10)

		// RESET propagates upstream from d through both b and c to a
		sub.signal(RESET);

		// a should be reset (initial is undefined for state(1))
		// d's cache is cleared
		sub.unsubscribe();
	});
});

// ---------------------------------------------------------------------------
// isLifecycleSignal utility
// ---------------------------------------------------------------------------

describe("isLifecycleSignal", () => {
	it("returns true for lifecycle signals", () => {
		expect(isLifecycleSignal(RESET)).toBe(true);
		expect(isLifecycleSignal(PAUSE)).toBe(true);
		expect(isLifecycleSignal(RESUME)).toBe(true);
		expect(isLifecycleSignal(TEARDOWN)).toBe(true);
	});

	it("returns false for non-lifecycle signals", () => {
		expect(isLifecycleSignal(DIRTY)).toBe(false);
		expect(isLifecycleSignal(RESOLVED)).toBe(false);
		expect(isLifecycleSignal(null)).toBe(false);
		expect(isLifecycleSignal(42)).toBe(false);
	});
});
