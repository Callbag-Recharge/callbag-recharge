import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { derived } from "../../core/derived";
import { state } from "../../core/state";
import { fromTrigger } from "../../extra/fromTrigger";
import { pipeline, pipelineRunner, step, task } from "../../orchestrate";
import { constant, withMaxAttempts } from "../../utils/backoff";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a simple pipeline factory that counts invocations. */
function simplePipelineFactory(calls: { count: number }) {
	return () => {
		calls.count++;
		return pipeline({
			source: step(state(calls.count)),
			doubled: step(["source"], (s) => derived([s], () => s.get() * 2)),
		});
	};
}

// ==========================================================================
// pipelineRunner()
// ==========================================================================
describe("pipelineRunner", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	// --- Construction ---

	it("creates a runner with multiple pipelines", () => {
		const calls = { count: 0 };
		const runner = pipelineRunner([
			{ name: "a", factory: simplePipelineFactory(calls) },
			{ name: "b", factory: simplePipelineFactory(calls) },
		]);

		expect(Object.keys(runner.pipelines)).toEqual(["a", "b"]);
		expect(calls.count).toBe(2);
		expect(runner.status.get()).toBe("running");
		runner.destroy();
	});

	it("throws on duplicate pipeline names", () => {
		const calls = { count: 0 };
		expect(() =>
			pipelineRunner([
				{ name: "dup", factory: simplePipelineFactory(calls) },
				{ name: "dup", factory: simplePipelineFactory(calls) },
			]),
		).toThrow(/duplicate pipeline name "dup"/);
	});

	// --- ManagedPipeline reactive store ---

	it("exposes pipeline instance via reactive Store", () => {
		const calls = { count: 0 };
		const runner = pipelineRunner([{ name: "a", factory: simplePipelineFactory(calls) }]);

		const managed = runner.pipelines.a;
		const pl = managed.pipeline.get();
		expect(pl).not.toBeNull();
		expect(pl!.steps.doubled.get()).toBe(2); // first call → state(1) → 1*2

		runner.destroy();
	});

	it("pipeline store updates to null on stop", () => {
		const calls = { count: 0 };
		const runner = pipelineRunner([{ name: "a", factory: simplePipelineFactory(calls) }]);

		expect(runner.pipelines.a.pipeline.get()).not.toBeNull();
		runner.stop("a");
		expect(runner.pipelines.a.pipeline.get()).toBeNull();

		runner.destroy();
	});

	it("pipeline store updates to new instance on restart", () => {
		const calls = { count: 0 };
		const runner = pipelineRunner([{ name: "a", factory: simplePipelineFactory(calls) }]);

		const firstPl = runner.pipelines.a.pipeline.get();
		runner.restart("a");
		const secondPl = runner.pipelines.a.pipeline.get();

		expect(secondPl).not.toBeNull();
		expect(secondPl).not.toBe(firstPl);
		expect(calls.count).toBe(2);

		runner.destroy();
	});

	// --- Status tracking ---

	it("reflects pipeline status reactively", () => {
		const calls = { count: 0 };
		const runner = pipelineRunner([{ name: "a", factory: simplePipelineFactory(calls) }]);

		// Pipeline with state stores → status should be active or idle
		const s = runner.pipelines.a.status.get();
		expect(["idle", "active", "completed"]).toContain(s);

		runner.destroy();
	});

	// --- Aggregate status ---

	it("aggregate status is 'stopped' when all pipelines stopped", () => {
		const calls = { count: 0 };
		const runner = pipelineRunner([
			{ name: "a", factory: simplePipelineFactory(calls) },
			{ name: "b", factory: simplePipelineFactory(calls) },
		]);

		runner.stop();
		expect(runner.status.get()).toBe("stopped");

		runner.destroy();
	});

	it("aggregate status is 'running' when all healthy", () => {
		const calls = { count: 0 };
		const runner = pipelineRunner([{ name: "a", factory: simplePipelineFactory(calls) }]);

		expect(runner.status.get()).toBe("running");
		runner.destroy();
	});

	// --- Stop/Start ---

	it("stop() stops a specific pipeline", () => {
		const calls = { count: 0 };
		const runner = pipelineRunner([
			{ name: "a", factory: simplePipelineFactory(calls) },
			{ name: "b", factory: simplePipelineFactory(calls) },
		]);

		runner.stop("a");
		expect(runner.pipelines.a.status.get()).toBe("stopped");
		expect(runner.pipelines.a.pipeline.get()).toBeNull();
		// b still running
		expect(runner.pipelines.b.pipeline.get()).not.toBeNull();

		runner.destroy();
	});

	it("start() restarts a stopped pipeline", () => {
		const calls = { count: 0 };
		const runner = pipelineRunner([{ name: "a", factory: simplePipelineFactory(calls) }]);

		runner.stop("a");
		expect(runner.pipelines.a.pipeline.get()).toBeNull();
		expect(calls.count).toBe(1);

		runner.start("a");
		expect(runner.pipelines.a.pipeline.get()).not.toBeNull();
		expect(calls.count).toBe(2);

		runner.destroy();
	});

	it("start() with no args starts all stopped pipelines", () => {
		const calls = { count: 0 };
		const runner = pipelineRunner([
			{ name: "a", factory: simplePipelineFactory(calls) },
			{ name: "b", factory: simplePipelineFactory(calls) },
		]);

		runner.stop();
		expect(calls.count).toBe(2);

		runner.start();
		expect(calls.count).toBe(4);
		expect(runner.pipelines.a.pipeline.get()).not.toBeNull();
		expect(runner.pipelines.b.pipeline.get()).not.toBeNull();

		runner.destroy();
	});

	// --- Manual restart ---

	it("restart() destroys old and creates new pipeline", () => {
		const calls = { count: 0 };
		const runner = pipelineRunner([{ name: "a", factory: simplePipelineFactory(calls) }]);

		expect(calls.count).toBe(1);
		runner.restart("a");
		expect(calls.count).toBe(2);
		expect(runner.pipelines.a.restartCount.get()).toBe(1);

		runner.destroy();
	});

	it("restart() resets consecutive restart counter", () => {
		const calls = { count: 0 };
		const runner = pipelineRunner([{ name: "a", factory: simplePipelineFactory(calls) }]);

		// Multiple manual restarts should keep working (no maxRestarts exhaustion)
		runner.restart("a");
		runner.restart("a");
		runner.restart("a");
		expect(runner.pipelines.a.restartCount.get()).toBe(3);
		expect(runner.pipelines.a.pipeline.get()).not.toBeNull();

		runner.destroy();
	});

	// --- Throws on unknown name ---

	it("restart() throws for unknown pipeline", () => {
		const runner = pipelineRunner([]);
		expect(() => runner.restart("nope")).toThrow(/unknown pipeline "nope"/);
		runner.destroy();
	});

	it("stop() throws for unknown pipeline", () => {
		const runner = pipelineRunner([]);
		expect(() => runner.stop("nope")).toThrow(/unknown pipeline "nope"/);
		runner.destroy();
	});

	it("start() throws for unknown pipeline", () => {
		const runner = pipelineRunner([]);
		expect(() => runner.start("nope")).toThrow(/unknown pipeline "nope"/);
		runner.destroy();
	});

	// --- Auto-restart on error ---

	it("auto-restarts pipeline on error with backoff", async () => {
		let factoryCount = 0;
		const shouldError = true;

		const factory = () => {
			factoryCount++;
			const trigger = fromTrigger<string>();
			return pipeline({
				trigger: step(trigger),
				work: task(["trigger"], async (_signal, [v]: [string]) => {
					if (shouldError) throw new Error("boom");
					return v;
				}),
			});
		};

		const runner = pipelineRunner([
			{
				name: "flaky",
				factory,
				restart: { backoff: constant(100) },
			},
		]);

		expect(factoryCount).toBe(1);

		// Trigger error
		const pl1 = runner.pipelines.flaky.pipeline.get()!;
		(pl1.steps.trigger as any).fire("go");
		await vi.advanceTimersByTimeAsync(0);

		// Status should be errored, then restart scheduled
		expect(runner.pipelines.flaky.status.get()).toBe("errored");

		// Advance past backoff delay
		await vi.advanceTimersByTimeAsync(100);
		expect(factoryCount).toBe(2);
		expect(runner.pipelines.flaky.restartCount.get()).toBe(1);

		runner.destroy();
	});

	it("stops auto-restart after maxRestarts", async () => {
		let factoryCount = 0;

		// Factory that always has an errored pipeline status
		const factory = () => {
			factoryCount++;
			const trigger = fromTrigger<string>();
			return pipeline({
				trigger: step(trigger),
				work: task(["trigger"], async (_signal) => {
					throw new Error("always fails");
				}),
			});
		};

		const runner = pipelineRunner([
			{
				name: "limited",
				factory,
				restart: {
					maxRestarts: 2,
					backoff: constant(50),
				},
			},
		]);

		const pl1 = runner.pipelines.limited.pipeline.get()!;
		(pl1.steps.trigger as any).fire("go");
		await vi.advanceTimersByTimeAsync(0);

		// First restart
		await vi.advanceTimersByTimeAsync(50);
		expect(factoryCount).toBe(2);
		const pl2 = runner.pipelines.limited.pipeline.get()!;
		(pl2.steps.trigger as any).fire("go");
		await vi.advanceTimersByTimeAsync(0);

		// Second restart
		await vi.advanceTimersByTimeAsync(50);
		expect(factoryCount).toBe(3);
		const pl3 = runner.pipelines.limited.pipeline.get()!;
		(pl3.steps.trigger as any).fire("go");
		await vi.advanceTimersByTimeAsync(0);

		// Third attempt should NOT restart (maxRestarts = 2 means 2 restarts allowed)
		await vi.advanceTimersByTimeAsync(50);
		expect(factoryCount).toBe(3);
		expect(runner.pipelines.limited.status.get()).toBe("stopped");

		runner.destroy();
	});

	it("does not auto-restart when restart.enabled = false", async () => {
		let factoryCount = 0;

		const factory = () => {
			factoryCount++;
			const trigger = fromTrigger<string>();
			return pipeline({
				trigger: step(trigger),
				work: task(["trigger"], async (_signal) => {
					throw new Error("fail");
				}),
			});
		};

		const runner = pipelineRunner([
			{
				name: "no-restart",
				factory,
				restart: { enabled: false },
			},
		]);

		const pl = runner.pipelines["no-restart"].pipeline.get()!;
		(pl.steps.trigger as any).fire("go");
		await vi.advanceTimersByTimeAsync(0);

		// Should be stopped, not restarting
		await vi.advanceTimersByTimeAsync(1000);
		expect(factoryCount).toBe(1);
		expect(runner.pipelines["no-restart"].status.get()).toBe("stopped");

		runner.destroy();
	});

	// --- Backoff with withMaxAttempts ---

	it("respects backoff returning null (withMaxAttempts)", async () => {
		let factoryCount = 0;

		const factory = () => {
			factoryCount++;
			const trigger = fromTrigger<string>();
			return pipeline({
				trigger: step(trigger),
				work: task(["trigger"], async (_signal) => {
					throw new Error("fail");
				}),
			});
		};

		const runner = pipelineRunner([
			{
				name: "capped",
				factory,
				restart: { backoff: withMaxAttempts(constant(10), 1) },
			},
		]);

		const pl1 = runner.pipelines.capped.pipeline.get()!;
		(pl1.steps.trigger as any).fire("go");
		await vi.advanceTimersByTimeAsync(0);

		// First restart
		await vi.advanceTimersByTimeAsync(10);
		expect(factoryCount).toBe(2);

		// Trigger error again
		const pl2 = runner.pipelines.capped.pipeline.get()!;
		(pl2.steps.trigger as any).fire("go");
		await vi.advanceTimersByTimeAsync(0);

		// Should stop — withMaxAttempts(1) returns null on attempt 1
		await vi.advanceTimersByTimeAsync(100);
		expect(factoryCount).toBe(2);
		expect(runner.pipelines.capped.status.get()).toBe("stopped");

		runner.destroy();
	});

	// --- Health checks ---

	it("runs periodic health checks", async () => {
		const calls = { count: 0 };
		let healthResult = true;
		const healthChecks: number[] = [];

		const runner = pipelineRunner([
			{
				name: "checked",
				factory: simplePipelineFactory(calls),
				healthCheck: {
					intervalMs: 100,
					fn: () => {
						healthChecks.push(Date.now());
						return healthResult;
					},
				},
				restart: { backoff: constant(50) },
			},
		]);

		expect(runner.pipelines.checked.healthy.get()).toBe(true);

		// Advance past first health check
		await vi.advanceTimersByTimeAsync(100);
		expect(healthChecks.length).toBe(1);
		expect(runner.pipelines.checked.healthy.get()).toBe(true);

		// Fail health check
		healthResult = false;
		await vi.advanceTimersByTimeAsync(100);
		expect(runner.pipelines.checked.healthy.get()).toBe(false);

		runner.destroy();
	});

	it("triggers restart on failed health check", async () => {
		const calls = { count: 0 };
		let healthResult = true;

		const runner = pipelineRunner([
			{
				name: "unhealthy",
				factory: simplePipelineFactory(calls),
				healthCheck: {
					intervalMs: 100,
					fn: () => healthResult,
				},
				restart: { backoff: constant(50) },
			},
		]);

		expect(calls.count).toBe(1);

		// Fail health check
		healthResult = false;
		await vi.advanceTimersByTimeAsync(100);

		// Should schedule restart after backoff
		healthResult = true; // next factory call will be healthy
		await vi.advanceTimersByTimeAsync(50);
		expect(calls.count).toBe(2);
		expect(runner.pipelines.unhealthy.restartCount.get()).toBe(1);

		runner.destroy();
	});

	it("handles async health check", async () => {
		const calls = { count: 0 };

		const runner = pipelineRunner([
			{
				name: "async-check",
				factory: simplePipelineFactory(calls),
				healthCheck: {
					intervalMs: 100,
					fn: async () => true,
				},
				restart: { backoff: constant(50) },
			},
		]);

		await vi.advanceTimersByTimeAsync(100);
		expect(runner.pipelines["async-check"].healthy.get()).toBe(true);

		runner.destroy();
	});

	it("handles health check that throws", async () => {
		const calls = { count: 0 };

		const runner = pipelineRunner([
			{
				name: "throw-check",
				factory: simplePipelineFactory(calls),
				healthCheck: {
					intervalMs: 100,
					fn: () => {
						throw new Error("health check failed");
					},
				},
				restart: { backoff: constant(50) },
			},
		]);

		await vi.advanceTimersByTimeAsync(100);
		expect(runner.pipelines["throw-check"].healthy.get()).toBe(false);

		// Should trigger restart
		await vi.advanceTimersByTimeAsync(50);
		expect(calls.count).toBe(2);

		runner.destroy();
	});

	// --- Factory error ---

	it("handles factory that throws on creation", async () => {
		let throwOnCreate = true;
		let factoryCount = 0;

		const runner = pipelineRunner([
			{
				name: "bad-factory",
				factory: () => {
					factoryCount++;
					if (throwOnCreate) throw new Error("factory failed");
					return pipeline({ source: step(state(0)) });
				},
				restart: { backoff: constant(100) },
			},
		]);

		expect(factoryCount).toBe(1);
		expect(runner.pipelines["bad-factory"].pipeline.get()).toBeNull();
		expect(runner.pipelines["bad-factory"].healthy.get()).toBe(false);

		// Let it retry successfully
		throwOnCreate = false;
		await vi.advanceTimersByTimeAsync(100);
		expect(factoryCount).toBe(2);
		expect(runner.pipelines["bad-factory"].pipeline.get()).not.toBeNull();

		runner.destroy();
	});

	// --- Destroy ---

	it("destroy() tears down all pipelines and timers", async () => {
		const calls = { count: 0 };
		const runner = pipelineRunner([
			{
				name: "a",
				factory: simplePipelineFactory(calls),
				healthCheck: { intervalMs: 100, fn: () => true },
			},
		]);

		runner.destroy();

		// Advancing time should not trigger health checks or anything
		await vi.advanceTimersByTimeAsync(1000);
		// No errors, no additional factory calls
		expect(calls.count).toBe(1);
	});

	it("destroy() is idempotent", () => {
		const calls = { count: 0 };
		const runner = pipelineRunner([{ name: "a", factory: simplePipelineFactory(calls) }]);

		runner.destroy();
		runner.destroy(); // no-op, no throw
	});

	// --- Degraded status ---

	it("aggregate status is 'degraded' when a pipeline is unhealthy", async () => {
		const calls1 = { count: 0 };
		const calls2 = { count: 0 };
		let healthResult = true;

		const runner = pipelineRunner([
			{
				name: "a",
				factory: simplePipelineFactory(calls1),
				healthCheck: {
					intervalMs: 100,
					fn: () => healthResult,
				},
				// No auto-restart so we can observe degraded state
				restart: { enabled: false },
			},
			{
				name: "b",
				factory: simplePipelineFactory(calls2),
			},
		]);

		expect(runner.status.get()).toBe("running");

		healthResult = false;
		await vi.advanceTimersByTimeAsync(100);

		// a is unhealthy but restart disabled → status updates to stopped
		// but before that, healthy should be false → degraded
		// With restart disabled, on unhealthy it marks stopped
		expect(runner.pipelines.a.status.get()).toBe("stopped");
		// One stopped + one running = not all stopped, check if degraded
		// Actually with restart disabled, it goes to stopped which is not "errored"
		// Let's check what aggregate shows
		const s = runner.status.get();
		// "a" is stopped but healthy is false, "b" is running and healthy
		// The aggregate checks: not all stopped, any degraded (errored or !healthy)
		expect(s).toBe("degraded");

		runner.destroy();
	});

	// --- Empty configs ---

	it("handles empty config array", () => {
		const runner = pipelineRunner([]);
		// All stopped (vacuously true)
		expect(runner.status.get()).toBe("stopped");
		runner.destroy();
	});

	// --- Consecutive restart reset on success ---

	it("resets consecutive restart counter on successful activity", async () => {
		let factoryCount = 0;
		let shouldError = true;

		const factory = () => {
			factoryCount++;
			const trigger = fromTrigger<string>();
			return pipeline({
				trigger: step(trigger),
				work: task(["trigger"], async (_signal, [v]: [string]) => {
					if (shouldError) throw new Error("boom");
					return v;
				}),
			});
		};

		const runner = pipelineRunner([
			{
				name: "recoverable",
				factory,
				restart: { backoff: constant(50), maxRestarts: 5 },
			},
		]);

		// Error → restart
		const pl1 = runner.pipelines.recoverable.pipeline.get()!;
		(pl1.steps.trigger as any).fire("go");
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(50);
		expect(factoryCount).toBe(2);

		// Now succeed → should reset consecutive counter
		shouldError = false;
		const pl2 = runner.pipelines.recoverable.pipeline.get()!;
		(pl2.steps.trigger as any).fire("go");
		await vi.advanceTimersByTimeAsync(0);

		// Error again — should still be able to restart (counter was reset)
		shouldError = true;
		(pl2.steps.trigger as any).fire("go2");
		// task() is in switchMap so it cancels previous and runs new
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(50);
		expect(factoryCount).toBe(3);

		runner.destroy();
	});
});
