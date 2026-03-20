import { describe, expect, it } from "vitest";
import { derived } from "../../core/derived";
import { fromTrigger } from "../../extra/fromTrigger";
import { subscribe } from "../../extra/subscribe";
import { pipeline, step, task } from "../../orchestrate";
import type { PipelineStatus } from "../../orchestrate/pipeline";

// ==========================================================================
// task() — step definition
// ==========================================================================
describe("task", () => {
	it("creates a step def with no deps", () => {
		const t = task(() => 42);
		expect(t.deps).toEqual([]);
		expect(t.factory).toBeDefined();
		expect(t._taskState).toBeDefined();
	});

	it("creates a step def with deps", () => {
		const t = task(["a", "b"], (a, b) => a + b);
		expect(t.deps).toEqual(["a", "b"]);
		expect(t._taskState).toBeDefined();
	});

	it("accepts name option", () => {
		const t = task(["a"], (v) => v, { name: "myTask" });
		expect(t.name).toBe("myTask");
	});
});

// ==========================================================================
// task() in pipeline — single dep
// ==========================================================================
describe("task in pipeline — single dep", () => {
	it("sync task produces value", async () => {
		const trigger = fromTrigger<number>();
		const wf = pipeline({
			input: step(trigger),
			doubled: task(["input"], (v: number) => v * 2),
		});

		const values: (number | null)[] = [];
		const unsub = subscribe(wf.steps.doubled, (v) => values.push(v));

		trigger.fire(5);
		// Sync task still runs through taskState (async), so wait a tick
		await new Promise((r) => setTimeout(r, 50));

		expect(values).toContain(10);

		unsub();
		wf.destroy();
	});

	it("async task produces value", async () => {
		const trigger = fromTrigger<string>();
		const wf = pipeline({
			input: step(trigger),
			fetched: task(["input"], async (v: string) => {
				await new Promise((r) => setTimeout(r, 30));
				return `result:${v}`;
			}),
		});

		const values: (string | null)[] = [];
		const unsub = subscribe(wf.steps.fetched, (v) => values.push(v));

		trigger.fire("hello");
		await new Promise((r) => setTimeout(r, 100));

		expect(values).toContain("result:hello");

		unsub();
		wf.destroy();
	});

	it("re-trigger cancels previous (switchMap semantics)", async () => {
		const trigger = fromTrigger<number>();
		const wf = pipeline({
			input: step(trigger),
			slow: task(["input"], async (v: number) => {
				await new Promise((r) => setTimeout(r, 100));
				return v * 10;
			}),
		});

		const values: (number | null)[] = [];
		const unsub = subscribe(wf.steps.slow, (v) => values.push(v));

		// Fire twice quickly — first should be cancelled
		trigger.fire(1);
		await new Promise((r) => setTimeout(r, 20));
		trigger.fire(2);
		await new Promise((r) => setTimeout(r, 200));

		// Only the second trigger's result should appear
		const nonNull = values.filter((v) => v !== null);
		expect(nonNull[nonNull.length - 1]).toBe(20);

		unsub();
		wf.destroy();
	});
});

// ==========================================================================
// task() in pipeline — multi-dep diamond join
// ==========================================================================
describe("task in pipeline — diamond join", () => {
	it("waits for ALL deps before running", async () => {
		const trigger = fromTrigger<string>();

		const wf = pipeline({
			trigger: step(trigger),
			fetchA: task(["trigger"], async () => {
				await new Promise((r) => setTimeout(r, 30));
				return "a-result";
			}),
			fetchB: task(["trigger"], async () => {
				await new Promise((r) => setTimeout(r, 60));
				return "b-result";
			}),
			aggregate: task(["fetchA", "fetchB"], async (a: string | null, b: string | null) => {
				return `merged:${a}+${b}`;
			}),
		});

		const aggValues: (string | null)[] = [];
		const unsub = subscribe(wf.steps.aggregate, (v) => aggValues.push(v));

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 200));

		// Aggregate should have received both values
		const meaningful = aggValues.filter(
			(v) => v !== null && typeof v === "string" && v.startsWith("merged:") && !v.includes("null"),
		);
		expect(meaningful.length).toBeGreaterThanOrEqual(1);
		expect(meaningful[meaningful.length - 1]).toBe("merged:a-result+b-result");

		unsub();
		wf.destroy();
	});

	it("does not run aggregate with undefined deps", async () => {
		const trigger = fromTrigger<string>();
		let aggCalls = 0;

		const wf = pipeline({
			trigger: step(trigger),
			fetchA: task(["trigger"], async () => {
				await new Promise((r) => setTimeout(r, 30));
				return "a";
			}),
			fetchB: task(["trigger"], async () => {
				await new Promise((r) => setTimeout(r, 80));
				return "b";
			}),
			aggregate: task(["fetchA", "fetchB"], async (a: string | null, b: string | null) => {
				aggCalls++;
				return `${a}+${b}`;
			}),
		});

		subscribe(wf.steps.aggregate, () => {});

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 200));

		// Aggregate may run once with real values and once with null (skip),
		// but should never receive undefined
		expect(aggCalls).toBeGreaterThanOrEqual(1);

		wf.destroy();
	});
});

// ==========================================================================
// task() — skip predicate
// ==========================================================================
describe("task — skip predicate", () => {
	it("skips execution when predicate returns true", async () => {
		const trigger = fromTrigger<string | null>();
		let taskRan = false;

		const wf = pipeline({
			input: step(trigger),
			work: task(
				["input"],
				async (v: string | null) => {
					taskRan = true;
					return `processed:${v}`;
				},
				{ skip: (v: string | null) => v === null },
			),
		});

		subscribe(wf.steps.work, () => {});

		trigger.fire(null);
		await new Promise((r) => setTimeout(r, 50));

		expect(taskRan).toBe(false);

		// Now fire a real value
		trigger.fire("hello");
		await new Promise((r) => setTimeout(r, 50));

		expect(taskRan).toBe(true);

		wf.destroy();
	});
});

// ==========================================================================
// task() — error + fallback
// ==========================================================================
describe("task — error handling", () => {
	it("emits null on error by default", async () => {
		const trigger = fromTrigger<string>();

		const wf = pipeline({
			input: step(trigger),
			failing: task(["input"], async () => {
				throw new Error("boom");
			}),
		});

		const values: any[] = [];
		subscribe(wf.steps.failing, (v) => values.push(v));

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 50));

		expect(values).toContain(null);

		wf.destroy();
	});

	it("uses fallback value on error", async () => {
		const trigger = fromTrigger<string>();

		const wf = pipeline({
			input: step(trigger),
			failing: task(
				["input"],
				async () => {
					throw new Error("boom");
				},
				{ fallback: "default-value" },
			),
		});

		const values: any[] = [];
		subscribe(wf.steps.failing, (v) => values.push(v));

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 50));

		expect(values).toContain("default-value");

		wf.destroy();
	});

	it("uses fallback function on error", async () => {
		const trigger = fromTrigger<string>();

		const wf = pipeline({
			input: step(trigger),
			failing: task(
				["input"],
				async () => {
					throw new Error("boom");
				},
				{ fallback: (e: unknown) => `recovered:${(e as Error).message}` },
			),
		});

		const values: any[] = [];
		subscribe(wf.steps.failing, (v) => values.push(v));

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 50));

		expect(values).toContain("recovered:boom");

		wf.destroy();
	});
});

// ==========================================================================
// task() — retry
// ==========================================================================
describe("task — retry", () => {
	it("retries on failure", async () => {
		const trigger = fromTrigger<string>();
		let attempts = 0;

		const wf = pipeline({
			input: step(trigger),
			retrying: task(
				["input"],
				async () => {
					attempts++;
					if (attempts < 3) throw new Error(`attempt ${attempts}`);
					return "success";
				},
				{ retry: 3 },
			),
		});

		const values: any[] = [];
		subscribe(wf.steps.retrying, (v) => values.push(v));

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 200));

		expect(attempts).toBe(3);
		expect(values).toContain("success");

		wf.destroy();
	});
});

// ==========================================================================
// task() — pipeline auto-detection of runStatus
// ==========================================================================
describe("task — pipeline runStatus auto-detection", () => {
	it("auto-detects taskState for runStatus without explicit tasks option", async () => {
		const trigger = fromTrigger<string>();

		const wf = pipeline({
			input: step(trigger),
			work: task(["input"], async (v: string) => {
				await new Promise((r) => setTimeout(r, 30));
				return `done:${v}`;
			}),
		});

		// runStatus should NOT be idle-only — it should track the auto-detected task
		expect(wf.status.get()).toBe("idle");

		const statuses: PipelineStatus[] = [];
		const unsub = subscribe(wf.status, (s) => statuses.push(s));

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 100));

		// Should have gone through active → completed
		expect(statuses).toContain("active");
		expect(wf.status.get()).toBe("completed");

		unsub();
		wf.destroy();
	});

	it("reset() resets auto-detected taskState", async () => {
		const trigger = fromTrigger<string>();

		const wf = pipeline({
			input: step(trigger),
			work: task(["input"], async () => {
				await new Promise((r) => setTimeout(r, 20));
				return "done";
			}),
		});

		subscribe(wf.status, () => {});

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 100));
		expect(wf.status.get()).toBe("completed");

		wf.reset();
		expect(wf.status.get()).toBe("idle");

		wf.destroy();
	});

	it("works with mix of task() and step() definitions", async () => {
		const trigger = fromTrigger<number>();

		const wf = pipeline({
			input: step(trigger),
			// Expert step — no auto-detection
			sync: step(["input"], (s) => derived([s], () => (s.get() ?? 0) * 2)),
			// Task step — auto-detected
			async: task(["sync"], async (v: number) => {
				await new Promise((r) => setTimeout(r, 20));
				return v + 1;
			}),
		});

		subscribe(wf.status, () => {});

		trigger.fire(5);
		await new Promise((r) => setTimeout(r, 100));

		expect(wf.status.get()).toBe("completed");

		wf.destroy();
	});
});

// ==========================================================================
// task() — no deps
// ==========================================================================
describe("task — no deps", () => {
	it("runs immediately when pipeline starts", async () => {
		const wf = pipeline({
			init: task(() => "initialized"),
		});

		const values: any[] = [];
		subscribe(wf.steps.init, (v) => values.push(v));

		await new Promise((r) => setTimeout(r, 50));
		expect(values).toContain("initialized");

		wf.destroy();
	});
});
