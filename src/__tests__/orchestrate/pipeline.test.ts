import { describe, expect, it } from "vitest";
import { derived } from "../../core/derived";
import { pipe } from "../../core/pipe";
import { fromTrigger } from "../../extra/fromTrigger";
import { map } from "../../extra/map";
import { route } from "../../extra/route";
import { subscribe } from "../../extra/subscribe";
import { state } from "../../index";
import { gate, pipeline, source, step, task } from "../../orchestrate";
import { track } from "../../utils/track";

// ==========================================================================
// step()
// ==========================================================================
describe("step", () => {
	it("creates a step def with no deps", () => {
		const s = step(state(0));
		expect(s.deps).toEqual([]);
		expect(s.factory).toBeDefined();
	});

	it("creates a step def with deps", () => {
		const s = step(["input"], (a: any) => a);
		expect(s.deps).toEqual(["input"]);
	});

	it("accepts name option (no-deps form)", () => {
		const s = step(state(0), { name: "myStep" });
		expect(s.name).toBe("myStep");
	});

	it("accepts name option (deps-first form)", () => {
		const s = step(["input"], (a: any) => a, { name: "namedDep" });
		expect(s.name).toBe("namedDep");
		expect(s.deps).toEqual(["input"]);
	});

	it("throws when deps-first form has no factory", () => {
		expect(() => step(["a"] as any, undefined as any)).toThrow(
			/deps-first form requires a factory/,
		);
	});
});

// ==========================================================================
// pipeline()
// ==========================================================================
describe("pipeline", () => {
	it("wires a simple linear pipeline", () => {
		const wf = pipeline({
			source: step(state(0)),
			doubled: step(["source"], (s) => derived([s], () => s.get() * 2)),
		});

		expect(wf.inner.order).toEqual(["source", "doubled"]);
		expect(wf.steps.doubled.get()).toBe(0);

		(wf.steps.source as any).set(5);
		expect(wf.steps.doubled.get()).toBe(10);

		wf.destroy();
	});

	it("wires multi-dep steps", () => {
		const wf = pipeline({
			a: step(state(10)),
			b: step(state(20)),
			sum: step(["a", "b"], (a, b) => derived([a, b], () => a.get() + b.get())),
		});

		expect(wf.steps.sum.get()).toBe(30);

		(wf.steps.a as any).set(100);
		expect(wf.steps.sum.get()).toBe(120);

		wf.destroy();
	});

	it("tracks per-step metadata via inner.stepMeta", () => {
		const wf = pipeline({
			source: step(state(0)),
		});

		expect(wf.inner.stepMeta.source.get().status).toBe("idle");
		expect(wf.inner.stepMeta.source.get().count).toBe(0);

		(wf.steps.source as any).set(1);
		expect(wf.inner.stepMeta.source.get().status).toBe("active");
		expect(wf.inner.stepMeta.source.get().count).toBe(1);

		(wf.steps.source as any).set(2);
		expect(wf.inner.stepMeta.source.get().count).toBe(2);

		wf.destroy();
	});

	it("status is idle when no values emitted (step-only pipeline)", () => {
		const wf = pipeline({
			source: step(state(0)),
		});

		// Step-only pipeline: status falls back to stream lifecycle
		expect(wf.status.get()).toBe("idle");
		wf.destroy();
	});

	it("status is active when any step emits (step-only pipeline)", () => {
		const wf = pipeline({
			source: step(state(0)),
		});

		(wf.steps.source as any).set(1);
		expect(wf.status.get()).toBe("active");
		wf.destroy();
	});

	it("topological order respects dependencies", () => {
		const wf = pipeline({
			c: step(["a", "b"], (a, b) => derived([a, b], () => a.get() + b.get())),
			a: step(state(1)),
			b: step(state(2)),
		});

		// a and b should come before c
		const cIdx = wf.inner.order.indexOf("c");
		const aIdx = wf.inner.order.indexOf("a");
		const bIdx = wf.inner.order.indexOf("b");

		expect(aIdx).toBeLessThan(cIdx);
		expect(bIdx).toBeLessThan(cIdx);

		wf.destroy();
	});

	it("throws on unknown dep", () => {
		expect(() =>
			pipeline({
				a: step(["nonexistent"], (x: any) => x),
			}),
		).toThrow(/unknown step "nonexistent"/);
	});

	it("throws on cycle", () => {
		expect(() =>
			pipeline({
				a: step(["b"], (b: any) => b),
				b: step(["a"], (a: any) => a),
			}),
		).toThrow(/cycle detected/);
	});

	it("works with fromTrigger source", () => {
		const wf = pipeline({
			trigger: step(fromTrigger<number>()),
			doubled: step(["trigger"], (s) =>
				pipe(
					s,
					map((x) => (x ?? 0) * 2),
				),
			),
		});

		const values: number[] = [];
		const unsub = subscribe(wf.steps.doubled, (v) => values.push(v!));

		(wf.steps.trigger as any).fire(5);
		(wf.steps.trigger as any).fire(10);

		expect(values).toEqual([10, 20]);

		unsub.unsubscribe();
		wf.destroy();
	});

	it("works with pipe operators", () => {
		const wf = pipeline({
			input: step(state(0)),
			tracked: step(["input"], (s) => pipe(s, track())),
		});

		(wf.steps.input as any).set(42);
		expect(wf.steps.tracked.get()).toBe(42);

		// tracked step should have track's meta
		const trackMeta = (wf.steps.tracked as any).meta;
		expect(trackMeta).toBeDefined();
		expect(trackMeta.get().status).toBe("active");

		wf.destroy();
	});

	it("destroy() stops all subscriptions", () => {
		const wf = pipeline({
			source: step(state(0)),
		});

		(wf.steps.source as any).set(1);
		expect(wf.inner.stepMeta.source.get().count).toBe(1);

		wf.destroy();

		// After destroy, meta should not update
		(wf.steps.source as any).set(2);
		expect(wf.inner.stepMeta.source.get().count).toBe(1);
	});

	it("diamond topology: fan-out and fan-in", () => {
		const wf = pipeline({
			source: step(state(1)),
			left: step(["source"], (s) => derived([s], () => s.get() * 2)),
			right: step(["source"], (s) => derived([s], () => s.get() + 10)),
			merged: step(["left", "right"], (l, r) => derived([l, r], () => l.get() + r.get())),
		});

		expect(wf.steps.merged.get()).toBe(13); // (1*2) + (1+10) = 2 + 11

		(wf.steps.source as any).set(5);
		expect(wf.steps.merged.get()).toBe(25); // (5*2) + (5+10) = 10 + 15

		wf.destroy();
	});

	it("works with route for conditional branching", () => {
		const wf = pipeline({
			input: step(fromTrigger<number>()),
			router: step(["input"], (s) => {
				const [positive, negative] = route(s, (v) => (v ?? 0) > 0);
				// Return positive branch, attach negative for external access
				(positive as any)._negative = negative;
				return positive;
			}),
		});

		const positiveVals: number[] = [];
		const negativeVals: number[] = [];

		const u1 = subscribe(wf.steps.router, (v) => positiveVals.push(v!));
		const u2 = subscribe((wf.steps.router as any)._negative, (v) => negativeVals.push(v!));

		(wf.steps.input as any).fire(5);
		(wf.steps.input as any).fire(-3);
		(wf.steps.input as any).fire(10);

		expect(positiveVals).toEqual([5, 10]);
		expect(negativeVals).toEqual([-3]);

		u1.unsubscribe();
		u2.unsubscribe();
		wf.destroy();
	});

	it("factory throw cleans up already-wired subscriptions", () => {
		const source = state(0);
		let wiredCount = 0;

		expect(() =>
			pipeline({
				a: step(source),
				b: step(["a"], (s) => {
					wiredCount++;
					return derived([s], () => s.get());
				}),
				c: step(["b"], () => {
					throw new Error("factory boom");
				}),
			}),
		).toThrow(/factory boom/);

		// Step b was wired before c threw
		expect(wiredCount).toBe(1);
	});

	it("destroy() cleans up status derived store", () => {
		const wf = pipeline({
			source: step(state(0)),
		});

		// Status should be connected and reactive
		expect(wf.status.get()).toBe("idle");

		(wf.steps.source as any).set(1);
		expect(wf.status.get()).toBe("active");

		wf.destroy();

		// After destroy, status should no longer react
		// (internal subscription cleaned up)
	});

	it("reset() clears all step metas back to idle", () => {
		const wf = pipeline({
			a: step(state(0)),
			b: step(["a"], (a) => derived([a], () => a.get() * 2)),
		});

		(wf.steps.a as any).set(5);
		expect(wf.inner.stepMeta.a.get().status).toBe("active");
		expect(wf.inner.stepMeta.b.get().status).toBe("active");

		wf.reset();
		expect(wf.inner.stepMeta.a.get().status).toBe("idle");
		expect(wf.inner.stepMeta.b.get().status).toBe("idle");
		expect(wf.status.get()).toBe("idle");

		wf.destroy();
	});

	it("works with gate for human-in-the-loop", () => {
		const wf = pipeline({
			input: step(fromTrigger<string>()),
			gated: step(["input"], (s) => pipe(s, gate())),
		});

		const values: string[] = [];
		const unsub = subscribe(wf.steps.gated, (v) => values.push(v!));

		(wf.steps.input as any).fire("task-1");
		(wf.steps.input as any).fire("task-2");

		// Nothing passes until approved
		expect(values).toEqual([]);

		const gated = wf.steps.gated as any;
		expect(gated.pending.get()).toEqual(["task-1", "task-2"]);

		gated.approve(2); // approve both
		expect(values).toEqual(["task-1", "task-2"]);

		unsub.unsubscribe();
		wf.destroy();
	});

	it("all-source-steps pipeline does not bypass status", () => {
		// When every step is a source step (no deps), the bypass logic
		// should NOT treat idle/active as "done" — there are no work steps.
		const wf = pipeline({
			a: step(state(0)),
			b: step(state(0)),
		});

		// Both idle → overall idle
		expect(wf.status.get()).toBe("idle");

		// One emits → active (not "completed" — no bypass)
		(wf.steps.a as any).set(1);
		expect(wf.status.get()).toBe("active");

		// Both emit → still active (source steps don't "complete")
		(wf.steps.b as any).set(2);
		expect(wf.status.get()).toBe("active");

		wf.destroy();
	});
});

// ==========================================================================
// approval + destroy
// ==========================================================================
describe("approval controls after destroy", () => {
	it("throws when calling gate controls after pipeline destroy", () => {
		const gated = pipe(state(0), gate()) as any;
		// Subscribe to activate the producer
		const unsub = subscribe(gated, () => {});

		// Controls work while active
		gated.approve();

		// Tear down
		unsub.unsubscribe();

		// Controls should throw after teardown
		expect(() => gated.approve()).toThrow("torn down");
		expect(() => gated.reject()).toThrow("torn down");
		expect(() => gated.modify((v: any) => v)).toThrow("torn down");
		expect(() => gated.open()).toThrow("torn down");
		expect(() => gated.close()).toThrow("torn down");
	});

	it("throws when calling approval def controls after pipeline destroy", async () => {
		const { approval } = await import("../../orchestrate/approval");

		const reviewDef = approval<string>("input");

		const wf = pipeline({
			input: step(fromTrigger<string>()),
			review: reviewDef,
		});

		// Controls on def work before destroy
		(wf.steps.input as any).fire("hello");
		expect(reviewDef.pending.get()).toEqual(["hello"]);
		reviewDef.approve();

		// Destroy the pipeline
		wf.destroy();

		// Def controls should throw after destroy
		expect(() => reviewDef.approve()).toThrow("after pipeline was destroyed");
		expect(() => reviewDef.reject()).toThrow("after pipeline was destroyed");
		expect(() => reviewDef.modify((v: any) => v)).toThrow("after pipeline was destroyed");
		expect(() => reviewDef.open()).toThrow("after pipeline was destroyed");
		expect(() => reviewDef.close()).toThrow("after pipeline was destroyed");

		// Stores should also throw after destroy
		expect(() => reviewDef.pending.get()).toThrow("after pipeline was destroyed");
		expect(() => reviewDef.isOpen.get()).toThrow("after pipeline was destroyed");
	});

	it("reports completed when all tasks are skipped", () => {
		// Simulates the circuit-breaker-all-open scenario: task() skip predicate
		// fires, taskState transitions to "skipped", pipeline reports "completed".
		const trigger = fromTrigger<string>();
		const shouldSkip = true;

		const wf = pipeline({
			trigger: source(trigger),
			work: task(["trigger"], async (_signal, _values) => "result", {
				skip: () => shouldSkip,
			}),
		});

		// Before firing, pipeline should be idle
		expect(wf.status.get()).toBe("idle");

		const statuses: string[] = [];
		subscribe(wf.status, (s) => statuses.push(s));

		trigger.fire("go");

		// task was skipped — pipeline should report "completed"
		expect(wf.status.get()).toBe("completed");
		expect(statuses).toContain("completed");

		wf.destroy();
	});

	it("reports completed when some tasks skipped and some succeed", async () => {
		const trigger = fromTrigger<string>();
		const skipA = true;

		const wf = pipeline({
			trigger: source(trigger),
			a: task(["trigger"], async (_signal, _values) => "a-result", {
				skip: () => skipA,
			}),
			b: task(["trigger"], async (_signal, _values) => "b-result"),
		});

		expect(wf.status.get()).toBe("idle");
		const statuses: string[] = [];
		subscribe(wf.status, (s) => statuses.push(s));

		trigger.fire("go");
		// b is async — wait for it
		await new Promise((r) => setTimeout(r, 10));

		// a was skipped, b succeeded → pipeline completed
		expect(wf.status.get()).toBe("completed");
		expect(statuses).toContain("completed");
		wf.destroy();
	});

	it("reports errored when some tasks skipped and some error", async () => {
		const trigger = fromTrigger<string>();

		const wf = pipeline({
			trigger: source(trigger),
			a: task(["trigger"], async (_signal, _values) => "a-result", {
				skip: () => true,
			}),
			b: task(
				["trigger"],
				async () => {
					throw new Error("boom");
				},
				{ fallback: null },
			),
		});

		expect(wf.status.get()).toBe("idle");
		const statuses: string[] = [];
		subscribe(wf.status, (s) => statuses.push(s));

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 10));

		// a skipped, b errored → pipeline errored
		expect(wf.status.get()).toBe("errored");
		wf.destroy();
	});

	it("source() tags step with SOURCE_ROLE", async () => {
		const { SOURCE_ROLE } = await import("../../orchestrate/pipeline");
		const trigger = fromTrigger<string>();
		const def = source(trigger);
		expect((def as any)[SOURCE_ROLE]).toBe(true);
		expect(def.deps).toEqual([]);
	});

	it("reset after skip returns to idle and re-trigger works", async () => {
		const trigger = fromTrigger<string>();
		let shouldSkip = true;

		const wf = pipeline({
			trigger: source(trigger),
			work: task(["trigger"], async (_signal, _values) => "result", {
				skip: () => shouldSkip,
			}),
		});

		// First run: skip
		trigger.fire("go");
		expect(wf.status.get()).toBe("completed");

		// Reset
		wf.reset();
		expect(wf.status.get()).toBe("idle");

		// Second run: don't skip
		shouldSkip = false;
		trigger.fire("go2");
		await new Promise((r) => setTimeout(r, 10));
		expect(wf.status.get()).toBe("completed");

		wf.destroy();
	});

	it("task lifecycle hooks fire correctly", () => {
		const trigger = fromTrigger<string>();
		const hooks: string[] = [];

		const wf = pipeline({
			trigger: source(trigger),
			work: task(["trigger"], async (_signal, _values) => "result", {
				skip: () => true,
				onSkip: () => hooks.push("skipped"),
				onStart: () => hooks.push("started"),
			}),
		});

		trigger.fire("go");
		expect(hooks).toEqual(["skipped"]);
		// onStart should NOT have fired since it was skipped
		expect(hooks).not.toContain("started");
		wf.destroy();
	});

	it("double destroy is idempotent", async () => {
		const { approval } = await import("../../orchestrate/approval");

		const wf = pipeline({
			input: step(fromTrigger<string>()),
			review: approval<string>("input"),
		});

		wf.destroy();
		wf.destroy(); // should not throw
	});
});
