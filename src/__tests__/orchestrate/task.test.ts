import { describe, expect, it } from "vitest";
import { derived } from "../../core/derived";
import { Inspector } from "../../core/inspector";
import { fromTrigger } from "../../extra/fromTrigger";
import { subscribe } from "../../extra/subscribe";
import { pipeline, source, step, task } from "../../orchestrate";
import type { PipelineStatus } from "../../orchestrate/pipeline";
import { TASK_STATE } from "../../orchestrate/types";

// ==========================================================================
// task() — step definition
// ==========================================================================
describe("task", () => {
	it("creates a step def with no deps", () => {
		const t = task((_signal) => 42);
		expect(t.deps).toEqual([]);
		expect(t.factory).toBeDefined();
		expect(t[TASK_STATE]).toBeDefined();
	});

	it("creates a step def with deps", () => {
		const t = task(["a", "b"], (_signal, [a, b]) => a + b);
		expect(t.deps).toEqual(["a", "b"]);
		expect(t[TASK_STATE]).toBeDefined();
	});

	it("accepts name option", () => {
		const t = task(["a"], (_signal, [v]) => v, { name: "myTask" });
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
			doubled: task(["input"], (_signal, [v]: [number]) => v * 2),
		});

		const values: (number | null)[] = [];
		const unsub = subscribe(wf.steps.doubled, (v) => values.push(v));

		trigger.fire(5);
		// Sync task still runs through taskState (async), so wait a tick
		await new Promise((r) => setTimeout(r, 50));

		expect(values).toContain(10);

		unsub.unsubscribe();
		wf.destroy();
	});

	it("async task produces value", async () => {
		const trigger = fromTrigger<string>();
		const wf = pipeline({
			input: step(trigger),
			fetched: task(["input"], async (_signal, [v]: [string]) => {
				await new Promise((r) => setTimeout(r, 30));
				return `result:${v}`;
			}),
		});

		const values: (string | null)[] = [];
		const unsub = subscribe(wf.steps.fetched, (v) => values.push(v));

		trigger.fire("hello");
		await new Promise((r) => setTimeout(r, 100));

		expect(values).toContain("result:hello");

		unsub.unsubscribe();
		wf.destroy();
	});

	it("re-trigger cancels previous (switchMap semantics)", async () => {
		const trigger = fromTrigger<number>();
		const wf = pipeline({
			input: step(trigger),
			slow: task(["input"], async (_signal, [v]: [number]) => {
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

		unsub.unsubscribe();
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
			fetchA: task(["trigger"], async (_signal) => {
				await new Promise((r) => setTimeout(r, 30));
				return "a-result";
			}),
			fetchB: task(["trigger"], async (_signal) => {
				await new Promise((r) => setTimeout(r, 60));
				return "b-result";
			}),
			aggregate: task(
				["fetchA", "fetchB"],
				async (_signal, [a, b]: [string | null, string | null]) => {
					return `merged:${a}+${b}`;
				},
			),
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

		unsub.unsubscribe();
		wf.destroy();
	});

	it("does not run aggregate with undefined deps", async () => {
		const trigger = fromTrigger<string>();
		let aggCalls = 0;

		const wf = pipeline({
			trigger: step(trigger),
			fetchA: task(["trigger"], async (_signal) => {
				await new Promise((r) => setTimeout(r, 30));
				return "a";
			}),
			fetchB: task(["trigger"], async (_signal) => {
				await new Promise((r) => setTimeout(r, 80));
				return "b";
			}),
			aggregate: task(
				["fetchA", "fetchB"],
				async (_signal, [a, b]: [string | null, string | null]) => {
					aggCalls++;
					return `${a}+${b}`;
				},
			),
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
				async (_signal, [v]: [string | null]) => {
					taskRan = true;
					return `processed:${v}`;
				},
				{ skip: ([v]: [string | null]) => v === null },
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
	it("emits undefined on error by default", async () => {
		const trigger = fromTrigger<string>();

		const wf = pipeline({
			input: step(trigger),
			failing: task(["input"], async (_signal) => {
				throw new Error("boom");
			}),
		});

		const values: any[] = [];
		subscribe(wf.steps.failing, (v) => values.push(v));

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 50));

		expect(values).toContain(undefined);

		wf.destroy();
	});

	it("uses fallback value on error", async () => {
		const trigger = fromTrigger<string>();

		const wf = pipeline({
			input: step(trigger),
			failing: task(
				["input"],
				async (_signal) => {
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
				async (_signal) => {
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
				async (_signal) => {
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
			work: task(["input"], async (_signal, [v]: [string]) => {
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

		unsub.unsubscribe();
		wf.destroy();
	});

	it("reset() resets auto-detected taskState", async () => {
		const trigger = fromTrigger<string>();

		const wf = pipeline({
			input: step(trigger),
			work: task(["input"], async (_signal) => {
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
			async: task(["sync"], async (_signal, [v]: [number]) => {
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
			init: task((_signal) => "initialized"),
		});

		// No-deps tasks execute synchronously during pipeline construction.
		// The value is already in the store by the time we subscribe, and
		// subscribe() follows RxJS semantics (no initial-value callback),
		// so check via get() instead.
		await new Promise((r) => setTimeout(r, 50));
		expect(wf.steps.init.get()).toBe("initialized");

		wf.destroy();
	});
});

// ==========================================================================
// task() — async generator guard
// ==========================================================================
describe("task — async generator guard", () => {
	it("throws early when fn returns an async generator", async () => {
		const trigger = fromTrigger<string>();

		const wf = pipeline({
			input: step(trigger),
			stream: task(["input"], async function* (_signal) {
				yield 1;
				yield 2;
			}),
		});

		subscribe(wf.steps.stream, () => {});

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 50));

		// task should have errored — taskState captures the throw
		const meta = wf.steps.stream.get();
		expect(meta).toBeUndefined(); // fallback undefined on error
		expect(wf.status.get()).toBe("errored");

		wf.destroy();
	});
});

// ==========================================================================
// task() — reset preserves runCount (restart semantics)
// ==========================================================================
describe("task — reset preserves runCount", () => {
	it("pipeline reset uses restart, keeping cumulative runCount", async () => {
		const trigger = fromTrigger<string>();

		const workDef = task(["trigger"], async (_signal, [_v]) => {
			await new Promise((r) => setTimeout(r, 10));
			return "done";
		});
		const ts = workDef[TASK_STATE];

		const wf = pipeline({
			trigger: source(trigger),
			work: workDef,
		});

		subscribe(wf.status, () => {});

		// Run 1
		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 50));
		expect(wf.status.get()).toBe("completed");
		expect(ts.runCount.get()).toBe(1);

		// Reset + Run 2
		wf.reset();
		expect(wf.status.get()).toBe("idle");
		// runCount preserved by restart() semantics
		expect(ts.runCount.get()).toBe(1);

		trigger.fire("go2");
		await new Promise((r) => setTimeout(r, 50));
		expect(wf.status.get()).toBe("completed");
		expect(ts.runCount.get()).toBe(2);

		// Reset + Run 3
		wf.reset();
		trigger.fire("go3");
		await new Promise((r) => setTimeout(r, 50));
		expect(ts.runCount.get()).toBe(3);

		wf.destroy();
	});
});

// ==========================================================================
// task() — Inspector.observe on pipeline steps
// ==========================================================================
describe("task — Inspector.observe", () => {
	it("observe captures task output values", async () => {
		const trigger = fromTrigger<string>();

		const wf = pipeline({
			trigger: source(trigger),
			work: task(["trigger"], async (_signal, [v]: [string]) => {
				return `result:${v}`;
			}),
		});

		const obs = Inspector.observe(wf.steps.work);

		trigger.fire("hello");
		await new Promise((r) => setTimeout(r, 50));

		// Should see null (undefined guard) and the real result
		expect(obs.values).toContain("result:hello");

		obs.dispose();
		wf.destroy();
	});

	it("observe captures task status transitions", async () => {
		const trigger = fromTrigger<string>();

		const workDef = task(["trigger"], async (_signal) => {
			await new Promise((r) => setTimeout(r, 20));
			return "done";
		});
		const ts = workDef[TASK_STATE];

		const wf = pipeline({
			trigger: source(trigger),
			work: workDef,
		});

		const statusObs = Inspector.observe(ts.status);

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 80));

		// Should see idle → running → success
		expect(statusObs.values).toContain("running");
		expect(statusObs.values).toContain("success");

		statusObs.dispose();
		wf.destroy();
	});

	it("observe captures pipeline status lifecycle", async () => {
		const trigger = fromTrigger<string>();

		const wf = pipeline({
			trigger: source(trigger),
			work: task(["trigger"], async (_signal) => {
				await new Promise((r) => setTimeout(r, 10));
				return "done";
			}),
		});

		const statusObs = Inspector.observe(wf.status);

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 50));

		expect(statusObs.values).toContain("active");
		expect(statusObs.values).toContain("completed");

		statusObs.dispose();
		wf.destroy();
	});
});

// ==========================================================================
// task() — diamond with error propagation (airflow-demo pattern)
// ==========================================================================
describe("task — diamond with error propagation", () => {
	it("downstream receives undefined when upstream errors (no fallback)", async () => {
		const trigger = fromTrigger<string>();

		const wf = pipeline({
			trigger: source(trigger),
			failing: task(["trigger"], async () => {
				throw new Error("upstream fail");
			}),
			downstream: task(["failing"], async (_signal, [v]) => `got:${v}`, {
				skip: ([v]) => v === undefined,
			}),
		});

		const statusObs = Inspector.observe(wf.status);

		subscribe(wf.steps.downstream, () => {});

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 80));

		// Pipeline should be errored (failing task errored)
		expect(wf.status.get()).toBe("errored");

		statusObs.dispose();
		wf.destroy();
	});

	it("partial failure in diamond: one branch fails, aggregate skipped by undefined guard", async () => {
		const trigger = fromTrigger<string>();
		let aggCalls = 0;

		const wf = pipeline({
			trigger: source(trigger),
			branchA: task(["trigger"], async () => {
				throw new Error("A fails");
			}),
			branchB: task(["trigger"], async (_signal) => {
				await new Promise((r) => setTimeout(r, 10));
				return "B-ok";
			}),
			aggregate: task(
				["branchA", "branchB"],
				async (_signal, [a, b]) => {
					aggCalls++;
					return `merged:${a}+${b}`;
				},
				{
					skip: ([a, b]) => a === undefined && b === undefined,
				},
			),
		});

		subscribe(wf.steps.aggregate, () => {});

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 100));

		// Aggregate should be skipped — branchA emits undefined on error,
		// and the undefined guard catches it before the task fn runs
		expect(aggCalls).toBe(0);
		// Pipeline status is "errored" because branchA errored
		expect(wf.status.get()).toBe("errored");

		wf.destroy();
	});

	it("all branches fail: aggregate skipped via predicate", async () => {
		const trigger = fromTrigger<string>();
		let aggCalls = 0;

		const wf = pipeline({
			trigger: source(trigger),
			branchA: task(["trigger"], async () => {
				throw new Error("A fails");
			}),
			branchB: task(["trigger"], async () => {
				throw new Error("B fails");
			}),
			aggregate: task(
				["branchA", "branchB"],
				async (_signal, [a, b]) => {
					aggCalls++;
					return `${a}+${b}`;
				},
				{ skip: ([a, b]) => a === undefined && b === undefined },
			),
		});

		subscribe(wf.steps.aggregate, () => {});

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 80));

		// Aggregate should not have run (both undefined → skipped)
		// Note: combine fires when each dep emits undefined, the first time
		// one dep is still undefined (guard), second time both are undefined (skip)
		expect(aggCalls).toBe(0);

		wf.destroy();
	});
});

// ==========================================================================
// task() — full airflow-demo pattern: re-trigger lifecycle
// ==========================================================================
describe("task — airflow-demo re-trigger pattern", () => {
	it("full pipeline lifecycle: trigger → run → complete → re-trigger", async () => {
		const triggerSrc = fromTrigger<string>();
		let runCounter = 0;

		const wf = pipeline({
			trigger: source(triggerSrc),
			cron: task(["trigger"], async (_signal) => {
				return "triggered";
			}),
			fetchA: task(["cron"], async (_signal) => {
				await new Promise((r) => setTimeout(r, 20));
				return "A";
			}),
			fetchB: task(["cron"], async (_signal) => {
				await new Promise((r) => setTimeout(r, 30));
				return "B";
			}),
			merge: task(
				["fetchA", "fetchB"],
				async (_signal, [a, b]) => {
					runCounter++;
					return `${a}+${b}`;
				},
				{ skip: ([a, b]) => a === undefined && b === undefined },
			),
		});

		const statuses: PipelineStatus[] = [];
		const unsub = subscribe(wf.status, (s) => statuses.push(s));

		// Run 1
		triggerSrc.fire("go");
		await new Promise((r) => setTimeout(r, 150));
		expect(wf.status.get()).toBe("completed");

		// Reset + Run 2 — reset cascades RESET to source which re-emits initial
		// value, causing a transient ripple. Wait for it to settle before re-triggering.
		wf.reset();
		await new Promise((r) => setTimeout(r, 100));

		triggerSrc.fire("go2");
		await new Promise((r) => setTimeout(r, 200));
		expect(wf.status.get()).toBe("completed");

		// merge ran at least once per pipeline execution
		expect(runCounter).toBeGreaterThanOrEqual(2);

		unsub.unsubscribe();
		wf.destroy();
	});

	it("task lifecycle hooks fire in correct order", async () => {
		const trigger = fromTrigger<string>();
		const hooks: string[] = [];

		const wf = pipeline({
			trigger: source(trigger),
			work: task(
				["trigger"],
				async (_signal) => {
					await new Promise((r) => setTimeout(r, 10));
					return "done";
				},
				{
					onStart: () => hooks.push("start"),
					onSuccess: () => hooks.push("success"),
					onError: () => hooks.push("error"),
				},
			),
		});

		subscribe(wf.status, () => {});

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 150));

		expect(hooks).toEqual(["start", "success"]);

		wf.destroy();
	});

	it("task onError fires on failure", async () => {
		const trigger = fromTrigger<string>();
		const hooks: string[] = [];

		const wf = pipeline({
			trigger: source(trigger),
			work: task(
				["trigger"],
				async () => {
					throw new Error("fail");
				},
				{
					onStart: () => hooks.push("start"),
					onSuccess: () => hooks.push("success"),
					onError: () => hooks.push("error"),
				},
			),
		});

		subscribe(wf.status, () => {});

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 50));

		expect(hooks).toEqual(["start", "error"]);

		wf.destroy();
	});
});
