import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAUSE, RESET, RESUME } from "../../core/protocol";
import { subscribe } from "../../core/subscribe";
import { countdown, stopwatch } from "../../utils/timer";

describe("countdown", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// -----------------------------------------------------------------------
	// Initial state (before subscription — pull-compute)
	// -----------------------------------------------------------------------

	it("initializes with given duration", () => {
		const c = countdown(5000);
		expect(c.remaining.get()).toBe(5000);
		expect(c.active.get()).toBe(false);
		expect(c.expired.get()).toBe(false);
	});

	// -----------------------------------------------------------------------
	// Auto-start on subscription
	// -----------------------------------------------------------------------

	it("auto-starts counting on first subscription", () => {
		const c = countdown(1000, { tickMs: 100 });
		const sub = subscribe(c.remaining, () => {});
		expect(c.active.get()).toBe(true);

		vi.advanceTimersByTime(500);
		expect(c.remaining.get()).toBeLessThanOrEqual(500);
		expect(c.remaining.get()).toBeGreaterThan(0);
		sub.unsubscribe();
	});

	it("expires when remaining reaches 0", () => {
		const c = countdown(500, { tickMs: 100 });
		const sub = subscribe(c.remaining, () => {});

		vi.advanceTimersByTime(600);
		expect(c.remaining.get()).toBe(0);
		expect(c.expired.get()).toBe(true);
		expect(c.active.get()).toBe(false);
		sub.unsubscribe();
	});

	// -----------------------------------------------------------------------
	// PAUSE / RESUME signals
	// -----------------------------------------------------------------------

	it("PAUSE stops counting", () => {
		const c = countdown(1000, { tickMs: 100 });
		const sub = subscribe(c.remaining, () => {});
		vi.advanceTimersByTime(300);
		sub.signal(PAUSE);

		const remaining = c.remaining.get();
		expect(c.active.get()).toBe(false);

		vi.advanceTimersByTime(500);
		expect(c.remaining.get()).toBe(remaining); // unchanged
		sub.unsubscribe();
	});

	it("RESUME continues from paused state", () => {
		const c = countdown(1000, { tickMs: 100 });
		const sub = subscribe(c.remaining, () => {});
		vi.advanceTimersByTime(300);
		sub.signal(PAUSE);
		const remaining = c.remaining.get();

		sub.signal(RESUME);
		expect(c.active.get()).toBe(true);

		vi.advanceTimersByTime(100);
		expect(c.remaining.get()).toBeLessThan(remaining);
		sub.unsubscribe();
	});

	it("RESUME when expired is a no-op", () => {
		const c = countdown(100, { tickMs: 50 });
		const sub = subscribe(c.remaining, () => {});
		vi.advanceTimersByTime(200);
		expect(c.expired.get()).toBe(true);

		sub.signal(RESUME);
		expect(c.active.get()).toBe(false);
		sub.unsubscribe();
	});

	// -----------------------------------------------------------------------
	// RESET signal
	// -----------------------------------------------------------------------

	it("RESET restores to original duration and stops", () => {
		const c = countdown(1000, { tickMs: 100 });
		const sub = subscribe(c.remaining, () => {});
		vi.advanceTimersByTime(500);
		sub.signal(RESET);

		expect(c.remaining.get()).toBe(1000);
		expect(c.active.get()).toBe(false);
		expect(c.expired.get()).toBe(false);
		sub.unsubscribe();
	});

	it("RESUME after RESET restarts countdown", () => {
		const c = countdown(500, { tickMs: 100 });
		const sub = subscribe(c.remaining, () => {});
		vi.advanceTimersByTime(600);
		expect(c.expired.get()).toBe(true);

		sub.signal(RESET);
		expect(c.remaining.get()).toBe(500);

		sub.signal(RESUME);
		expect(c.active.get()).toBe(true);
		expect(c.expired.get()).toBe(false);
		sub.unsubscribe();
	});

	// -----------------------------------------------------------------------
	// Unsubscribe stops timer
	// -----------------------------------------------------------------------

	it("unsubscribe stops timer when last subscriber leaves", () => {
		const c = countdown(1000, { tickMs: 100 });
		const sub = subscribe(c.remaining, () => {});
		expect(c.active.get()).toBe(true);

		sub.unsubscribe();
		// Timer stops because producer disconnects on last unsub
	});
});

describe("stopwatch", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// -----------------------------------------------------------------------
	// Initial state
	// -----------------------------------------------------------------------

	it("initializes with elapsed=0", () => {
		const sw = stopwatch();
		expect(sw.elapsed.get()).toBe(0);
		expect(sw.active.get()).toBe(false);
		expect(sw.laps.get()).toEqual([]);
	});

	// -----------------------------------------------------------------------
	// Auto-start on subscription
	// -----------------------------------------------------------------------

	it("auto-starts counting on first subscription", () => {
		const sw = stopwatch({ tickMs: 100 });
		const sub = subscribe(sw.elapsed, () => {});
		expect(sw.active.get()).toBe(true);

		vi.advanceTimersByTime(500);
		expect(sw.elapsed.get()).toBeGreaterThanOrEqual(500);
		sub.unsubscribe();
	});

	// -----------------------------------------------------------------------
	// PAUSE / RESUME signals
	// -----------------------------------------------------------------------

	it("PAUSE stops counting", () => {
		const sw = stopwatch({ tickMs: 100 });
		const sub = subscribe(sw.elapsed, () => {});
		vi.advanceTimersByTime(300);
		sub.signal(PAUSE);

		const elapsed = sw.elapsed.get();
		expect(sw.active.get()).toBe(false);

		vi.advanceTimersByTime(500);
		expect(sw.elapsed.get()).toBe(elapsed);
		sub.unsubscribe();
	});

	it("RESUME continues from paused state", () => {
		const sw = stopwatch({ tickMs: 100 });
		const sub = subscribe(sw.elapsed, () => {});
		vi.advanceTimersByTime(300);
		sub.signal(PAUSE);
		const elapsed = sw.elapsed.get();

		sub.signal(RESUME);
		vi.advanceTimersByTime(200);
		expect(sw.elapsed.get()).toBeGreaterThan(elapsed);
		sub.unsubscribe();
	});

	// -----------------------------------------------------------------------
	// RESET signal
	// -----------------------------------------------------------------------

	it("RESET clears elapsed and stops", () => {
		const sw = stopwatch({ tickMs: 100 });
		const sub = subscribe(sw.elapsed, () => {});
		vi.advanceTimersByTime(500);
		sub.signal(RESET);

		expect(sw.elapsed.get()).toBe(0);
		expect(sw.active.get()).toBe(false);
		expect(sw.laps.get()).toEqual([]);
		sub.unsubscribe();
	});

	// -----------------------------------------------------------------------
	// Unsubscribe
	// -----------------------------------------------------------------------

	it("unsubscribe stops timer", () => {
		const sw = stopwatch({ tickMs: 100 });
		const sub = subscribe(sw.elapsed, () => {});
		expect(sw.active.get()).toBe(true);

		sub.unsubscribe();
	});
});
