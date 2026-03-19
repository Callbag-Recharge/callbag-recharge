import { describe, expect, it } from "vitest";
import { slidingWindow, tokenBucket } from "../../utils/rateLimiter";

// ---------------------------------------------------------------------------
// Token Bucket
// ---------------------------------------------------------------------------
describe("tokenBucket", () => {
	it("starts with full burst capacity", () => {
		const rl = tokenBucket({ rate: 10, burst: 5 });
		expect(rl.available()).toBe(5);
	});

	it("defaults burst to rate", () => {
		const rl = tokenBucket({ rate: 10 });
		expect(rl.available()).toBe(10);
	});

	it("tryAcquire succeeds when tokens available", () => {
		const rl = tokenBucket({ rate: 10, burst: 3 });
		expect(rl.tryAcquire()).toBe(true);
		expect(rl.tryAcquire()).toBe(true);
		expect(rl.tryAcquire()).toBe(true);
		expect(rl.tryAcquire()).toBe(false);
	});

	it("tryAcquire with custom token count", () => {
		const rl = tokenBucket({ rate: 10, burst: 5 });
		expect(rl.tryAcquire(3)).toBe(true);
		expect(rl.available()).toBe(2);
		expect(rl.tryAcquire(3)).toBe(false);
		expect(rl.tryAcquire(2)).toBe(true);
	});

	it("refills tokens over time", () => {
		let time = 0;
		const rl = tokenBucket({ rate: 10, burst: 5, now: () => time });

		// Consume all tokens
		for (let i = 0; i < 5; i++) rl.tryAcquire();
		expect(rl.available()).toBe(0);

		// Advance 500ms — should have 5 tokens (10/s * 0.5s)
		time = 500;
		expect(rl.available()).toBe(5);
	});

	it("does not exceed burst on refill", () => {
		let time = 0;
		const rl = tokenBucket({ rate: 10, burst: 5, now: () => time });

		time = 10_000; // way past full
		expect(rl.available()).toBe(5); // capped at burst
	});

	it("acquire waits and returns ms waited", async () => {
		let time = 0;
		const rl = tokenBucket({ rate: 10, burst: 1, now: () => time });
		rl.tryAcquire(); // consume the one token

		// acquire should wait ~100ms for 1 token at 10/s
		const waitPromise = rl.acquire();
		// Simulate time passing (acquire uses setTimeout internally)
		time = 100;
		const waited = await waitPromise;
		expect(waited).toBeGreaterThan(0);
	});

	it("acquire returns 0 when tokens available", async () => {
		const rl = tokenBucket({ rate: 10, burst: 5 });
		const waited = await rl.acquire();
		expect(waited).toBe(0);
	});

	it("reset restores full capacity", () => {
		const rl = tokenBucket({ rate: 10, burst: 5 });
		rl.tryAcquire();
		rl.tryAcquire();
		rl.reset();
		expect(rl.available()).toBe(5);
	});
});

// ---------------------------------------------------------------------------
// Sliding Window
// ---------------------------------------------------------------------------
describe("slidingWindow", () => {
	it("allows requests up to max", () => {
		const rl = slidingWindow({ max: 3, windowMs: 1000 });
		expect(rl.tryAcquire()).toBe(true);
		expect(rl.tryAcquire()).toBe(true);
		expect(rl.tryAcquire()).toBe(true);
		expect(rl.tryAcquire()).toBe(false);
	});

	it("reports available slots", () => {
		const rl = slidingWindow({ max: 5, windowMs: 1000 });
		expect(rl.available()).toBe(5);
		rl.tryAcquire();
		rl.tryAcquire();
		expect(rl.available()).toBe(3);
	});

	it("frees slots after window expires", () => {
		let time = 0;
		const rl = slidingWindow({ max: 2, windowMs: 1000, now: () => time });

		rl.tryAcquire();
		rl.tryAcquire();
		expect(rl.available()).toBe(0);

		// Advance past window
		time = 1001;
		expect(rl.available()).toBe(2);
		expect(rl.tryAcquire()).toBe(true);
	});

	it("sliding window — partial expiry", () => {
		let time = 0;
		const rl = slidingWindow({ max: 3, windowMs: 1000, now: () => time });

		rl.tryAcquire(); // t=0
		time = 500;
		rl.tryAcquire(); // t=500
		rl.tryAcquire(); // t=500
		expect(rl.available()).toBe(0);

		// t=1001: first request expired, others still active
		time = 1001;
		expect(rl.available()).toBe(1);
		expect(rl.tryAcquire()).toBe(true);
		expect(rl.tryAcquire()).toBe(false);
	});

	it("tryAcquire with custom token count", () => {
		const rl = slidingWindow({ max: 5, windowMs: 1000 });
		expect(rl.tryAcquire(3)).toBe(true);
		expect(rl.available()).toBe(2);
		expect(rl.tryAcquire(3)).toBe(false);
		expect(rl.tryAcquire(2)).toBe(true);
		expect(rl.available()).toBe(0);
	});

	it("acquire returns 0 when slots available", async () => {
		const rl = slidingWindow({ max: 5, windowMs: 1000 });
		const waited = await rl.acquire();
		expect(waited).toBe(0);
	});

	it("reset clears all timestamps", () => {
		const rl = slidingWindow({ max: 3, windowMs: 1000 });
		rl.tryAcquire();
		rl.tryAcquire();
		rl.tryAcquire();
		expect(rl.available()).toBe(0);
		rl.reset();
		expect(rl.available()).toBe(3);
	});
});
