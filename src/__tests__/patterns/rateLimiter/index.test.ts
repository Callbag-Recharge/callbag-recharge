import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../../../core/state";
import { subscribe } from "../../../core/subscribe";
import { rateLimiter } from "../../../patterns/rateLimiter";

describe("rateLimiter", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// -----------------------------------------------------------------------
	// Drop strategy
	// -----------------------------------------------------------------------

	it("passes emissions within the limit", () => {
		const source = state(0);
		const rl = rateLimiter(source, { maxPerWindow: 3, windowMs: 1000 });
		const values: (number | undefined)[] = [];

		subscribe(rl.store, (v) => values.push(v));

		source.set(1);
		source.set(2);
		source.set(3);

		expect(values).toEqual([1, 2, 3]);
		rl.dispose();
	});

	it("drop strategy: silently drops emissions over limit", () => {
		const source = state(0);
		const rl = rateLimiter(source, {
			maxPerWindow: 2,
			windowMs: 1000,
			strategy: "drop",
		});
		const values: (number | undefined)[] = [];

		subscribe(rl.store, (v) => values.push(v));

		source.set(1);
		source.set(2);
		source.set(3); // dropped
		source.set(4); // dropped

		expect(values).toEqual([1, 2]);
		expect(rl.dropped.get()).toBe(2);
		rl.dispose();
	});

	it("drop strategy: limited store reflects capacity state", () => {
		const source = state(0);
		const rl = rateLimiter(source, {
			maxPerWindow: 2,
			windowMs: 1000,
			strategy: "drop",
		});

		expect(rl.limited.get()).toBe(false);

		source.set(1);
		expect(rl.limited.get()).toBe(false);

		source.set(2);
		expect(rl.limited.get()).toBe(true);

		rl.dispose();
	});

	// -----------------------------------------------------------------------
	// Queue strategy
	// -----------------------------------------------------------------------

	it("queue strategy: buffers emissions over limit and replays on window reset", () => {
		const source = state(0);
		const rl = rateLimiter(source, {
			maxPerWindow: 2,
			windowMs: 1000,
			strategy: "queue",
		});
		const values: (number | undefined)[] = [];

		subscribe(rl.store, (v) => values.push(v));

		source.set(1);
		source.set(2);
		source.set(3); // queued
		source.set(4); // queued

		expect(values).toEqual([1, 2]);
		expect(rl.dropped.get()).toBe(2); // 2 items in queue

		// Advance past window
		vi.advanceTimersByTime(1000);

		// Queued items should be flushed
		expect(values).toEqual([1, 2, 3, 4]);
		rl.dispose();
	});

	it("queue strategy: partial flush when queue exceeds next window limit", () => {
		const source = state(0);
		const rl = rateLimiter(source, {
			maxPerWindow: 1,
			windowMs: 1000,
			strategy: "queue",
		});
		const values: (number | undefined)[] = [];

		subscribe(rl.store, (v) => values.push(v));

		source.set(1);
		source.set(2); // queued
		source.set(3); // queued

		expect(values).toEqual([1]);

		vi.advanceTimersByTime(1000);
		expect(values).toEqual([1, 2]); // only 1 flushed per window

		vi.advanceTimersByTime(1000);
		expect(values).toEqual([1, 2, 3]);

		rl.dispose();
	});

	// -----------------------------------------------------------------------
	// Error strategy
	// -----------------------------------------------------------------------

	it("error strategy: stops forwarding when limit exceeded", () => {
		const source = state(0);
		const rl = rateLimiter(source, {
			maxPerWindow: 2,
			windowMs: 1000,
			strategy: "error",
		});
		const values: (number | undefined)[] = [];

		subscribe(rl.store, (v) => values.push(v));

		source.set(1);
		source.set(2);
		source.set(3); // triggers error

		expect(rl.dropped.get()).toBe(1);
		expect(rl.error.get()).toBeInstanceOf(Error);

		// Further emissions are ignored after error
		source.set(4);
		expect(values).toEqual([1, 2]); // no more values after error

		rl.dispose();
	});

	// -----------------------------------------------------------------------
	// Window reset
	// -----------------------------------------------------------------------

	it("window reset allows more emissions", () => {
		const source = state(0);
		const rl = rateLimiter(source, {
			maxPerWindow: 2,
			windowMs: 1000,
			strategy: "drop",
		});
		const values: (number | undefined)[] = [];

		subscribe(rl.store, (v) => values.push(v));

		source.set(1);
		source.set(2);
		source.set(3); // dropped

		vi.advanceTimersByTime(1000);

		source.set(4); // allowed
		source.set(5); // allowed

		expect(values).toEqual([1, 2, 4, 5]);
		expect(rl.dropped.get()).toBe(0); // reset on window
		rl.dispose();
	});

	// -----------------------------------------------------------------------
	// Reset
	// -----------------------------------------------------------------------

	it("reset clears state and allows emissions again (drop strategy)", () => {
		const source = state(0);
		const rl = rateLimiter(source, {
			maxPerWindow: 1,
			windowMs: 10000,
			strategy: "drop",
		});
		const values: (number | undefined)[] = [];

		subscribe(rl.store, (v) => values.push(v));

		source.set(1);
		source.set(2); // dropped

		expect(rl.dropped.get()).toBe(1);
		rl.reset();

		source.set(3); // allowed after reset
		expect(values).toEqual([1, 3]);
		expect(rl.dropped.get()).toBe(0);
		expect(rl.limited.get()).toBe(true); // at capacity again

		rl.dispose();
	});

	// -----------------------------------------------------------------------
	// Default strategy
	// -----------------------------------------------------------------------

	it("defaults to drop strategy", () => {
		const source = state(0);
		const rl = rateLimiter(source, { maxPerWindow: 1, windowMs: 1000 });
		const values: (number | undefined)[] = [];

		subscribe(rl.store, (v) => values.push(v));

		source.set(1);
		source.set(2); // dropped

		expect(values).toEqual([1]);
		expect(rl.dropped.get()).toBe(1);

		rl.dispose();
	});
});
