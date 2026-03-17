import { describe, expect, it } from "vitest";
import {
	constant,
	decorrelatedJitter,
	exponential,
	fibonacci,
	linear,
	withMaxAttempts,
} from "../../utils/backoff";

// ---------------------------------------------------------------------------
// constant
// ---------------------------------------------------------------------------
describe("constant", () => {
	it("always returns the same delay", () => {
		const strategy = constant(500);
		expect(strategy(0)).toBe(500);
		expect(strategy(5)).toBe(500);
		expect(strategy(100)).toBe(500);
	});
});

// ---------------------------------------------------------------------------
// linear
// ---------------------------------------------------------------------------
describe("linear", () => {
	it("returns base + step * attempt", () => {
		const strategy = linear(100, 50);
		expect(strategy(0)).toBe(100);
		expect(strategy(1)).toBe(150);
		expect(strategy(2)).toBe(200);
		expect(strategy(5)).toBe(350);
	});

	it("defaults step to base", () => {
		const strategy = linear(100);
		expect(strategy(0)).toBe(100);
		expect(strategy(1)).toBe(200);
		expect(strategy(3)).toBe(400);
	});
});

// ---------------------------------------------------------------------------
// exponential
// ---------------------------------------------------------------------------
describe("exponential", () => {
	it("returns base * factor^attempt with defaults", () => {
		const strategy = exponential();
		expect(strategy(0)).toBe(100); // 100 * 2^0
		expect(strategy(1)).toBe(200); // 100 * 2^1
		expect(strategy(2)).toBe(400); // 100 * 2^2
		expect(strategy(3)).toBe(800); // 100 * 2^3
	});

	it("caps at maxDelay", () => {
		const strategy = exponential({ base: 100, maxDelay: 500 });
		expect(strategy(0)).toBe(100);
		expect(strategy(1)).toBe(200);
		expect(strategy(2)).toBe(400);
		expect(strategy(3)).toBe(500); // capped
		expect(strategy(10)).toBe(500);
	});

	it("respects custom factor", () => {
		const strategy = exponential({ base: 10, factor: 3, maxDelay: 100_000 });
		expect(strategy(0)).toBe(10); // 10 * 3^0
		expect(strategy(1)).toBe(30); // 10 * 3^1
		expect(strategy(2)).toBe(90); // 10 * 3^2
	});

	it("applies full jitter — result in [0, calculated]", () => {
		const strategy = exponential({
			base: 1000,
			jitter: "full",
			maxDelay: 100_000,
		});
		// Run multiple times — should always be in range
		for (let i = 0; i < 50; i++) {
			const delay = strategy(2); // calculated = 4000
			expect(delay).toBeGreaterThanOrEqual(0);
			expect(delay).toBeLessThanOrEqual(4000);
		}
	});

	it("applies equal jitter — result in [calculated/2, calculated]", () => {
		const strategy = exponential({
			base: 1000,
			jitter: "equal",
			maxDelay: 100_000,
		});
		for (let i = 0; i < 50; i++) {
			const delay = strategy(2); // calculated = 4000
			expect(delay).toBeGreaterThanOrEqual(2000);
			expect(delay).toBeLessThanOrEqual(4000);
		}
	});
});

// ---------------------------------------------------------------------------
// fibonacci
// ---------------------------------------------------------------------------
describe("fibonacci", () => {
	it("returns fib(attempt) * base", () => {
		const strategy = fibonacci(100);
		// fib: 1, 1, 2, 3, 5, 8, 13...
		expect(strategy(0)).toBe(100); // fib(0) = 1
		expect(strategy(1)).toBe(100); // fib(1) = 1
		expect(strategy(2)).toBe(200); // fib(2) = 2
		expect(strategy(3)).toBe(300); // fib(3) = 3
		expect(strategy(4)).toBe(500); // fib(4) = 5
		expect(strategy(5)).toBe(800); // fib(5) = 8
	});

	it("caps at maxDelay", () => {
		const strategy = fibonacci(100, 400);
		expect(strategy(0)).toBe(100);
		expect(strategy(2)).toBe(200);
		expect(strategy(3)).toBe(300);
		expect(strategy(4)).toBe(400); // capped: fib(4)*100 = 500 > 400
		expect(strategy(10)).toBe(400);
	});

	it("defaults base to 100", () => {
		const strategy = fibonacci();
		expect(strategy(0)).toBe(100);
		expect(strategy(4)).toBe(500);
	});
});

// ---------------------------------------------------------------------------
// decorrelatedJitter
// ---------------------------------------------------------------------------
describe("decorrelatedJitter", () => {
	it("returns values between base and max", () => {
		const strategy = decorrelatedJitter(100, 10_000);
		let prev: number | undefined;
		for (let i = 0; i < 20; i++) {
			const delay = strategy(i, undefined, prev);
			expect(delay).toBeGreaterThanOrEqual(100);
			expect(delay).toBeLessThanOrEqual(10_000);
			prev = delay;
		}
	});

	it("uses base when prevDelay is undefined (first call)", () => {
		const strategy = decorrelatedJitter(100, 10_000);
		// No prevDelay — uses base, ceiling = min(10000, 100*3) = 300
		const delay = strategy(0);
		expect(delay).toBeGreaterThanOrEqual(100);
		expect(delay).toBeLessThanOrEqual(300);
	});

	it("is stateless — safe to share across concurrent sequences", () => {
		const strategy = decorrelatedJitter(100, 10_000);
		// Sequence A
		const a1 = strategy(0, undefined, undefined); // uses base
		// Sequence B — should also use base, unaffected by A
		const b1 = strategy(0, undefined, undefined);
		expect(a1).toBeGreaterThanOrEqual(100);
		expect(b1).toBeGreaterThanOrEqual(100);
		expect(a1).toBeLessThanOrEqual(300);
		expect(b1).toBeLessThanOrEqual(300);
	});

	it("scales ceiling from prevDelay", () => {
		const strategy = decorrelatedJitter(100, 10_000);
		// With prevDelay=500, ceiling = min(10000, 500*3) = 1500
		for (let i = 0; i < 50; i++) {
			const delay = strategy(1, undefined, 500);
			expect(delay).toBeGreaterThanOrEqual(100);
			expect(delay).toBeLessThanOrEqual(1500);
		}
	});
});

// ---------------------------------------------------------------------------
// withMaxAttempts
// ---------------------------------------------------------------------------
describe("withMaxAttempts", () => {
	it("returns null when attempt >= maxAttempts", () => {
		const strategy = withMaxAttempts(constant(100), 3);
		expect(strategy(0)).toBe(100);
		expect(strategy(1)).toBe(100);
		expect(strategy(2)).toBe(100);
		expect(strategy(3)).toBeNull();
		expect(strategy(10)).toBeNull();
	});

	it("works with any base strategy", () => {
		const strategy = withMaxAttempts(linear(50, 50), 2);
		expect(strategy(0)).toBe(50);
		expect(strategy(1)).toBe(100);
		expect(strategy(2)).toBeNull();
	});
});
