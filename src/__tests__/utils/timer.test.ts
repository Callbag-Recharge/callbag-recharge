import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countdown, stopwatch } from "../../utils/timer";

describe("countdown", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// -----------------------------------------------------------------------
	// Initial state
	// -----------------------------------------------------------------------

	it("initializes with given duration", () => {
		const c = countdown(5000);
		expect(c.remaining.get()).toBe(5000);
		expect(c.active.get()).toBe(false);
		expect(c.expired.get()).toBe(false);
	});

	// -----------------------------------------------------------------------
	// start / tick
	// -----------------------------------------------------------------------

	it("start begins counting down", () => {
		const c = countdown(1000, { tickMs: 100 });
		c.start();
		expect(c.active.get()).toBe(true);

		vi.advanceTimersByTime(500);
		expect(c.remaining.get()).toBeLessThanOrEqual(500);
		expect(c.remaining.get()).toBeGreaterThan(0);
	});

	it("expires when remaining reaches 0", () => {
		const c = countdown(500, { tickMs: 100 });
		c.start();

		vi.advanceTimersByTime(600);
		expect(c.remaining.get()).toBe(0);
		expect(c.expired.get()).toBe(true);
		expect(c.active.get()).toBe(false);
	});

	// -----------------------------------------------------------------------
	// pause / resume
	// -----------------------------------------------------------------------

	it("pause stops counting", () => {
		const c = countdown(1000, { tickMs: 100 });
		c.start();
		vi.advanceTimersByTime(300);
		c.pause();

		const remaining = c.remaining.get();
		expect(c.active.get()).toBe(false);

		vi.advanceTimersByTime(500);
		expect(c.remaining.get()).toBe(remaining); // unchanged
	});

	it("resume continues from paused state", () => {
		const c = countdown(1000, { tickMs: 100 });
		c.start();
		vi.advanceTimersByTime(300);
		c.pause();
		const remaining = c.remaining.get();

		c.resume();
		expect(c.active.get()).toBe(true);

		vi.advanceTimersByTime(100);
		expect(c.remaining.get()).toBeLessThan(remaining);
	});

	it("resume when expired is a no-op", () => {
		const c = countdown(100, { tickMs: 50 });
		c.start();
		vi.advanceTimersByTime(200);
		expect(c.expired.get()).toBe(true);

		c.resume();
		expect(c.active.get()).toBe(false);
	});

	// -----------------------------------------------------------------------
	// reset
	// -----------------------------------------------------------------------

	it("reset restores to original duration and stops", () => {
		const c = countdown(1000, { tickMs: 100 });
		c.start();
		vi.advanceTimersByTime(500);
		c.reset();

		expect(c.remaining.get()).toBe(1000);
		expect(c.active.get()).toBe(false);
		expect(c.expired.get()).toBe(false);
	});

	it("reset with custom duration sets new duration", () => {
		const c = countdown(1000, { tickMs: 100 });
		c.reset(2000);
		expect(c.remaining.get()).toBe(2000);
	});

	it("start after expiration resets remaining to original duration", () => {
		const c = countdown(500, { tickMs: 100 });
		c.start();
		vi.advanceTimersByTime(600);
		expect(c.expired.get()).toBe(true);

		c.start(); // should reset remaining to 500
		expect(c.remaining.get()).toBe(500);
		expect(c.active.get()).toBe(true);
		expect(c.expired.get()).toBe(false);
	});

	// -----------------------------------------------------------------------
	// dispose
	// -----------------------------------------------------------------------

	it("dispose stops timer and prevents further operations", () => {
		const c = countdown(1000, { tickMs: 100 });
		c.start();
		c.dispose();

		expect(c.active.get()).toBe(false);

		c.start(); // no-op
		expect(c.active.get()).toBe(false);
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
	// start / tick
	// -----------------------------------------------------------------------

	it("start begins counting up", () => {
		const sw = stopwatch({ tickMs: 100 });
		sw.start();
		expect(sw.active.get()).toBe(true);

		vi.advanceTimersByTime(500);
		expect(sw.elapsed.get()).toBeGreaterThanOrEqual(500);
	});

	it("start resets elapsed and laps", () => {
		const sw = stopwatch({ tickMs: 100 });
		sw.start();
		vi.advanceTimersByTime(500);
		sw.lap();

		sw.start(); // restart
		expect(sw.elapsed.get()).toBe(0);
		expect(sw.laps.get()).toEqual([]);
	});

	// -----------------------------------------------------------------------
	// pause / resume
	// -----------------------------------------------------------------------

	it("pause stops counting", () => {
		const sw = stopwatch({ tickMs: 100 });
		sw.start();
		vi.advanceTimersByTime(300);
		sw.pause();

		const elapsed = sw.elapsed.get();
		expect(sw.active.get()).toBe(false);

		vi.advanceTimersByTime(500);
		expect(sw.elapsed.get()).toBe(elapsed);
	});

	it("resume continues from paused state", () => {
		const sw = stopwatch({ tickMs: 100 });
		sw.start();
		vi.advanceTimersByTime(300);
		sw.pause();
		const elapsed = sw.elapsed.get();

		sw.resume();
		vi.advanceTimersByTime(200);
		expect(sw.elapsed.get()).toBeGreaterThan(elapsed);
	});

	// -----------------------------------------------------------------------
	// lap
	// -----------------------------------------------------------------------

	it("lap records current elapsed time", () => {
		const sw = stopwatch({ tickMs: 100 });
		sw.start();
		vi.advanceTimersByTime(500);
		sw.lap();

		const laps = sw.laps.get();
		expect(laps.length).toBe(1);
		expect(laps[0]).toBeGreaterThanOrEqual(500);
	});

	it("multiple laps are recorded in order", () => {
		const sw = stopwatch({ tickMs: 100 });
		sw.start();
		vi.advanceTimersByTime(200);
		sw.lap();
		vi.advanceTimersByTime(300);
		sw.lap();

		const laps = sw.laps.get();
		expect(laps.length).toBe(2);
		expect(laps[1]).toBeGreaterThan(laps[0]);
	});

	it("lap is a no-op when not active", () => {
		const sw = stopwatch();
		sw.lap();
		expect(sw.laps.get()).toEqual([]);
	});

	// -----------------------------------------------------------------------
	// reset
	// -----------------------------------------------------------------------

	it("reset clears elapsed, laps, and stops", () => {
		const sw = stopwatch({ tickMs: 100 });
		sw.start();
		vi.advanceTimersByTime(500);
		sw.lap();
		sw.reset();

		expect(sw.elapsed.get()).toBe(0);
		expect(sw.active.get()).toBe(false);
		expect(sw.laps.get()).toEqual([]);
	});

	// -----------------------------------------------------------------------
	// dispose
	// -----------------------------------------------------------------------

	it("dispose stops and prevents further operations", () => {
		const sw = stopwatch({ tickMs: 100 });
		sw.start();
		sw.dispose();

		expect(sw.active.get()).toBe(false);

		sw.start(); // no-op
		expect(sw.active.get()).toBe(false);
	});
});
