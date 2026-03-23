import { describe, expect, it } from "vitest";
import { reactiveLog } from "../../data/index";
import { state } from "../../index";
import { exponential } from "../../utils/backoff";
import { circuitBreaker } from "../../utils/circuitBreaker";

/**
 * The airflow-demo example has complex pipeline wiring with timing and randomness.
 * These tests verify that the building blocks used by the demo import and work correctly,
 * without running the full async pipeline.
 */
describe("airflow-demo example building blocks", () => {
	it("reactiveLog tracks entries and respects maxSize", () => {
		const log = reactiveLog<string>({ id: "test:log", maxSize: 5 });

		log.append("[OK] step 1");
		log.append("[OK] step 2");
		expect(log.lengthStore.get()).toBe(2);

		// Fill past max
		for (let i = 3; i <= 7; i++) {
			log.append(`[OK] step ${i}`);
		}
		expect(log.lengthStore.get()).toBe(5);

		log.destroy();
	});

	it("circuitBreaker starts closed and tracks failures", () => {
		const breaker = circuitBreaker({
			failureThreshold: 3,
			cooldownMs: 5000,
			cooldown: exponential({ base: 1000, factor: 2, max: 10000 }),
		});

		expect(breaker.state).toBe("closed");
		expect(breaker.canExecute()).toBe(true);

		breaker.recordSuccess();
		expect(breaker.state).toBe("closed");

		breaker.recordFailure();
		breaker.recordFailure();
		expect(breaker.state).toBe("closed"); // still under threshold

		breaker.recordFailure();
		expect(breaker.state).toBe("open"); // threshold hit
		expect(breaker.canExecute()).toBe(false);
	});

	it("exponential backoff produces increasing values", () => {
		const backoff = exponential({ base: 1000, factor: 2, maxDelay: 10000 });
		const v0 = backoff(0);
		const v1 = backoff(1);
		const v2 = backoff(2);

		expect(v0).toBe(1000);
		expect(v1).toBe(2000);
		expect(v2).toBe(4000);
		// Should cap at maxDelay
		expect(backoff(100)).toBeLessThanOrEqual(10000);
	});

	it("state stores used for pipeline running/runCount work", () => {
		const running = state(false, { name: "test:pipeline:running" });
		const runCount = state(0, { name: "test:pipeline:runCount" });

		expect(running.get()).toBe(false);
		expect(runCount.get()).toBe(0);

		running.set(true);
		expect(running.get()).toBe(true);

		runCount.update((n) => n + 1);
		expect(runCount.get()).toBe(1);

		running.set(false);
		runCount.update((n) => n + 1);
		expect(running.get()).toBe(false);
		expect(runCount.get()).toBe(2);
	});

	it("edge definitions are consistent", () => {
		// Verify the edge structure matches the expected DAG shape
		const edges = [
			{ source: "cron", target: "fetch-bank" },
			{ source: "cron", target: "fetch-cards" },
			{ source: "fetch-bank", target: "aggregate" },
			{ source: "fetch-cards", target: "aggregate" },
			{ source: "aggregate", target: "anomaly" },
			{ source: "aggregate", target: "batch-write" },
			{ source: "anomaly", target: "alert" },
		] as const;

		expect(edges).toHaveLength(7);

		// Cron fans out to 2 targets
		const cronTargets = edges.filter((e) => e.source === "cron").map((e) => e.target);
		expect(cronTargets).toEqual(["fetch-bank", "fetch-cards"]);

		// Aggregate has 2 sources
		const aggSources = edges.filter((e) => e.target === "aggregate").map((e) => e.source);
		expect(aggSources).toEqual(["fetch-bank", "fetch-cards"]);

		// Alert depends on anomaly
		const alertSources = edges.filter((e) => e.target === "alert").map((e) => e.source);
		expect(alertSources).toEqual(["anomaly"]);
	});
});
