import { describe, expect, it } from "vitest";
import { constant, exponential } from "../../utils/backoff";
import { circuitBreaker } from "../../utils/circuitBreaker";

// ---------------------------------------------------------------------------
// Basic state transitions
// ---------------------------------------------------------------------------
describe("circuitBreaker", () => {
	it("starts in closed state", () => {
		const cb = circuitBreaker();
		expect(cb.state).toBe("closed");
		expect(cb.canExecute()).toBe(true);
	});

	it("stays closed below failure threshold", () => {
		const cb = circuitBreaker({ failureThreshold: 3 });
		cb.recordFailure();
		cb.recordFailure();
		expect(cb.state).toBe("closed");
		expect(cb.failureCount).toBe(2);
		expect(cb.canExecute()).toBe(true);
	});

	it("opens after reaching failure threshold", () => {
		const cb = circuitBreaker({ failureThreshold: 3, cooldownMs: 10_000 });
		cb.recordFailure();
		cb.recordFailure();
		cb.recordFailure();
		expect(cb.state).toBe("open");
		expect(cb.canExecute()).toBe(false);
	});

	it("resets failure count on success in closed state", () => {
		const cb = circuitBreaker({ failureThreshold: 3 });
		cb.recordFailure();
		cb.recordFailure();
		cb.recordSuccess();
		expect(cb.failureCount).toBe(0);
		cb.recordFailure();
		expect(cb.failureCount).toBe(1);
	});

	// ---------------------------------------------------------------------------
	// Cooldown and half-open transition
	// ---------------------------------------------------------------------------
	it("transitions to half-open after cooldown expires", () => {
		let time = 0;
		const cb = circuitBreaker({
			failureThreshold: 2,
			cooldownMs: 1000,
			now: () => time,
		});

		cb.recordFailure();
		cb.recordFailure();
		expect(cb.state).toBe("open");

		// Before cooldown
		time = 500;
		expect(cb.state).toBe("open");
		expect(cb.canExecute()).toBe(false);

		// After cooldown — canExecute() triggers the transition
		time = 1000;
		expect(cb.canExecute()).toBe(true); // transitions to half-open
		expect(cb.state).toBe("half-open");
	});

	it("canExecute triggers half-open transition when cooldown expired", () => {
		let time = 0;
		const cb = circuitBreaker({
			failureThreshold: 1,
			cooldownMs: 100,
			now: () => time,
		});

		cb.recordFailure();
		expect(cb.canExecute()).toBe(false);

		time = 100;
		expect(cb.canExecute()).toBe(true); // transitions to half-open
		expect(cb.state).toBe("half-open");
	});

	// ---------------------------------------------------------------------------
	// Half-open behavior
	// ---------------------------------------------------------------------------
	it("closes on success in half-open state", () => {
		let time = 0;
		const cb = circuitBreaker({
			failureThreshold: 1,
			cooldownMs: 100,
			now: () => time,
		});

		cb.recordFailure();
		time = 100;
		cb.canExecute(); // → half-open

		cb.recordSuccess();
		expect(cb.state).toBe("closed");
		expect(cb.failureCount).toBe(0);
	});

	it("re-opens on failure in half-open state", () => {
		let time = 0;
		const cb = circuitBreaker({
			failureThreshold: 1,
			cooldownMs: 100,
			now: () => time,
		});

		cb.recordFailure();
		time = 100;
		cb.canExecute(); // → half-open

		cb.recordFailure();
		expect(cb.state).toBe("open");
	});

	it("limits trial requests in half-open via halfOpenMax", () => {
		let time = 0;
		const cb = circuitBreaker({
			failureThreshold: 1,
			cooldownMs: 100,
			halfOpenMax: 2,
			now: () => time,
		});

		cb.recordFailure();
		time = 100;

		expect(cb.canExecute()).toBe(true); // 1st trial
		expect(cb.canExecute()).toBe(true); // 2nd trial
		expect(cb.canExecute()).toBe(false); // 3rd — rejected
	});

	// ---------------------------------------------------------------------------
	// Backoff-based cooldown
	// ---------------------------------------------------------------------------
	it("uses backoff strategy for escalating cooldown", () => {
		let time = 0;
		const cb = circuitBreaker({
			failureThreshold: 1,
			cooldown: exponential({ base: 100, factor: 2, maxDelay: 10_000 }),
			now: () => time,
		});

		// First open: cooldown = 100ms (attempt 0)
		cb.recordFailure();
		expect(cb.state).toBe("open");

		time = 100;
		cb.canExecute(); // → half-open
		cb.recordFailure(); // back to open, openCycle = 1

		// Second open: cooldown = 200ms (attempt 1)
		time = 200; // only 100ms after re-open
		expect(cb.canExecute()).toBe(false);

		time = 300; // 200ms after re-open
		expect(cb.canExecute()).toBe(true); // → half-open
	});

	it("uses constant backoff for fixed cooldown", () => {
		let time = 0;
		const cb = circuitBreaker({
			failureThreshold: 1,
			cooldown: constant(500),
			now: () => time,
		});

		cb.recordFailure();
		time = 499;
		expect(cb.canExecute()).toBe(false);
		time = 500;
		expect(cb.canExecute()).toBe(true);
	});

	// ---------------------------------------------------------------------------
	// Reset
	// ---------------------------------------------------------------------------
	it("reset restores closed state and clears counters", () => {
		const time = 0;
		const cb = circuitBreaker({
			failureThreshold: 1,
			cooldownMs: 1000,
			now: () => time,
		});

		cb.recordFailure();
		expect(cb.state).toBe("open");

		cb.reset();
		expect(cb.state).toBe("closed");
		expect(cb.failureCount).toBe(0);
		expect(cb.canExecute()).toBe(true);
	});

	// ---------------------------------------------------------------------------
	// Default options
	// ---------------------------------------------------------------------------
	it("defaults: threshold=5, cooldownMs=30000, halfOpenMax=1", () => {
		const cb = circuitBreaker();
		for (let i = 0; i < 4; i++) cb.recordFailure();
		expect(cb.state).toBe("closed");
		cb.recordFailure();
		expect(cb.state).toBe("open");
	});
});
