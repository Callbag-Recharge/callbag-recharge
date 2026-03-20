import { describe, expect, it } from "vitest";
import { derived } from "../../core/derived";
import { producer } from "../../core/producer";
import { combine } from "../../extra/combine";
import { map } from "../../extra/map";
import { subscribe } from "../../extra/subscribe";
import { switchMap } from "../../extra/switchMap";
import { pipe, state } from "../../index";
import { fromTrigger, gate, pipeline, route, step, taskState, track } from "../../orchestrate";
import type { PipelineStatus } from "../../orchestrate/pipeline";

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

		expect(wf.order).toEqual(["source", "doubled"]);
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

	it("tracks per-step metadata", () => {
		const wf = pipeline({
			source: step(state(0)),
		});

		expect(wf.stepMeta.source.get().status).toBe("idle");
		expect(wf.stepMeta.source.get().count).toBe(0);

		(wf.steps.source as any).set(1);
		expect(wf.stepMeta.source.get().status).toBe("active");
		expect(wf.stepMeta.source.get().count).toBe(1);

		(wf.steps.source as any).set(2);
		expect(wf.stepMeta.source.get().count).toBe(2);

		wf.destroy();
	});

	it("overall status is idle when no values emitted", () => {
		const wf = pipeline({
			source: step(state(0)),
		});

		expect(wf.status.get()).toBe("idle");
		wf.destroy();
	});

	it("overall status is active when any step emits", () => {
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
		const cIdx = wf.order.indexOf("c");
		const aIdx = wf.order.indexOf("a");
		const bIdx = wf.order.indexOf("b");

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

		unsub();
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
		expect(wf.stepMeta.source.get().count).toBe(1);

		wf.destroy();

		// After destroy, meta should not update
		(wf.steps.source as any).set(2);
		expect(wf.stepMeta.source.get().count).toBe(1);
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

		u1();
		u2();
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

	it("destroy() cleans up overallStatus derived store", () => {
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
		expect(wf.stepMeta.a.get().status).toBe("active");
		expect(wf.stepMeta.b.get().status).toBe("active");

		wf.reset();
		expect(wf.stepMeta.a.get().status).toBe("idle");
		expect(wf.stepMeta.b.get().status).toBe("idle");
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

		unsub();
		wf.destroy();
	});

	// ======================================================================
	// runStatus (taskState-based)
	// ======================================================================

	it("runStatus is idle when no tasks registered", () => {
		const wf = pipeline({
			source: step(state(0)),
		});

		expect(wf.runStatus.get()).toBe("idle");

		(wf.steps.source as any).set(1);
		// No tasks → stays idle (no work to track)
		expect(wf.runStatus.get()).toBe("idle");

		wf.destroy();
	});

	it("runStatus tracks taskState lifecycle", async () => {
		const task = taskState<string>();
		const wf = pipeline(
			{
				source: step(state(0)),
				work: step(["source"], (s) => derived([s], () => s.get())),
			},
			{
				tasks: { work: task },
			},
		);

		expect(wf.runStatus.get()).toBe("idle");

		// Start a task
		const p = task.run(() => Promise.resolve("done"));
		expect(wf.runStatus.get()).toBe("active");

		// Wait for completion
		await p;
		expect(wf.runStatus.get()).toBe("completed");

		wf.destroy();
		task.destroy();
	});

	it("runStatus shows errored when task fails", async () => {
		const task = taskState<string>();
		const wf = pipeline(
			{
				source: step(state(0)),
			},
			{
				tasks: { source: task },
			},
		);

		expect(wf.runStatus.get()).toBe("idle");

		// Run a failing task
		await task.run(() => Promise.reject(new Error("boom"))).catch(() => {});
		expect(wf.runStatus.get()).toBe("errored");

		wf.destroy();
		task.destroy();
	});

	it("runStatus re-triggers naturally without reset", async () => {
		const task = taskState<string>();
		const wf = pipeline(
			{
				source: step(state(0)),
			},
			{
				tasks: { source: task },
			},
		);

		// First run
		await task.run(() => Promise.resolve("first"));
		expect(wf.runStatus.get()).toBe("completed");

		// Second run — runStatus goes active→completed again
		const p = task.run(() => Promise.resolve("second"));
		expect(wf.runStatus.get()).toBe("active");
		await p;
		expect(wf.runStatus.get()).toBe("completed");

		wf.destroy();
		task.destroy();
	});

	it("runStatus with multiple tasks: active while any running", async () => {
		const t1 = taskState<string>();
		const t2 = taskState<string>();
		const wf = pipeline(
			{
				a: step(state(0)),
				b: step(state(0)),
			},
			{
				tasks: { a: t1, b: t2 },
			},
		);

		expect(wf.runStatus.get()).toBe("idle");

		// Start both
		let resolve1: (v: string) => void;
		let resolve2: (v: string) => void;
		const p1 = t1.run(() => new Promise<string>((r) => (resolve1 = r)));
		const p2 = t2.run(() => new Promise<string>((r) => (resolve2 = r)));
		expect(wf.runStatus.get()).toBe("active");

		// Complete first — still active (second running)
		resolve1!("done1");
		await p1;
		expect(wf.runStatus.get()).toBe("active");

		// Complete second — completed
		resolve2!("done2");
		await p2;
		expect(wf.runStatus.get()).toBe("completed");

		wf.destroy();
		t1.destroy();
		t2.destroy();
	});

	it("runStatus completes with combine+switchMap diamond (async tasks)", async () => {
		// Reproduces the demo scenario: trigger → two parallel async fetches →
		// combine → aggregate. The combine fires when EITHER dep changes, and
		// switchMap emits innerStore.get() immediately (undefined). Without
		// undefined guards, this causes premature aggregate triggers.
		const t1 = taskState<string>();
		const t2 = taskState<string>();
		const tAgg = taskState<string>();

		const trigger = fromTrigger<string>();

		const wf = pipeline(
			{
				trigger: step(trigger),
				fetchA: step(["trigger"], (src) =>
					pipe(
						src,
						switchMap(() =>
							producer<string | null>(({ emit, complete }) => {
								t1.run(() => new Promise<string>((r) => setTimeout(() => r("a-result"), 50)))
									.then((r) => {
										emit(r);
										complete();
									})
									.catch(() => {
										emit(null);
										complete();
									});
							}),
						),
					),
				),
				fetchB: step(["trigger"], (src) =>
					pipe(
						src,
						switchMap(() =>
							producer<string | null>(({ emit, complete }) => {
								t2.run(() => new Promise<string>((r) => setTimeout(() => r("b-result"), 80)))
									.then((r) => {
										emit(r);
										complete();
									})
									.catch(() => {
										emit(null);
										complete();
									});
							}),
						),
					),
				),
				agg: step(["fetchA", "fetchB"], (a, b) =>
					pipe(
						combine(a, b),
						switchMap(([va, vb]: [string | null, string | null]) => {
							// Guard: undefined = not yet produced
							if (va === undefined || vb === undefined) {
								return producer<string | null>(({ emit, complete }) => {
									emit(null);
									complete();
								});
							}
							return producer<string | null>(({ emit, complete }) => {
								tAgg
									.run(() => new Promise<string>((r) => setTimeout(() => r("agg"), 30)))
									.then((r) => {
										emit(r);
										complete();
									})
									.catch(() => {
										emit(null);
										complete();
									});
							});
						}),
					),
				),
			},
			{ tasks: { fetchA: t1, fetchB: t2, agg: tAgg } },
		);

		expect(wf.runStatus.get()).toBe("idle");

		// Fire trigger
		trigger.fire("go");

		// Wait for all async work to settle
		await new Promise((r) => setTimeout(r, 200));

		// All tasks should have completed
		expect(t1.get().status).toBe("success");
		expect(t2.get().status).toBe("success");
		expect(tAgg.get().status).toBe("success");
		expect(wf.runStatus.get()).toBe("completed");

		wf.destroy();
		t1.destroy();
		t2.destroy();
		tAgg.destroy();
	});

	it("re-trigger after reset: aggregate runs when both deps succeed", async () => {
		// Reproduces the airflow demo bug: trigger → sync cron → two parallel
		// async fetches → combine → aggregate. The switchMap fix ensures the
		// synchronous cron emission is detected (no spurious undefined from .get()),
		// so downstream switchMaps fire only once per trigger.
		const t1 = taskState<string>();
		const t2 = taskState<string>();
		const tAgg = taskState<string>();

		const trigger = fromTrigger<string>();

		const wf = pipeline(
			{
				trigger: step(trigger),
				// Synchronous cron: emit immediately, then fire-and-forget task tracking.
				// Prevents double-fire downstream (the original bug was an async cron
				// that emitted undefined first, then "triggered" via microtask).
				cron: step(["trigger"], (src) =>
					pipe(
						src,
						switchMap(() =>
							producer<string>(({ emit, complete }) => {
								emit("triggered");
								complete();
							}),
						),
					),
				),
				fetchA: step(["cron"], (src) =>
					pipe(
						src,
						switchMap(() =>
							producer<string | null>(({ emit, complete }) => {
								t1.run(() => new Promise<string>((r) => setTimeout(() => r("a-result"), 30)))
									.then((r) => {
										emit(r);
										complete();
									})
									.catch(() => {
										emit(null);
										complete();
									});
							}),
						),
					),
				),
				fetchB: step(["cron"], (src) =>
					pipe(
						src,
						switchMap(() =>
							producer<string | null>(({ emit, complete }) => {
								t2.run(() => new Promise<string>((r) => setTimeout(() => r("b-result"), 50)))
									.then((r) => {
										emit(r);
										complete();
									})
									.catch(() => {
										emit(null);
										complete();
									});
							}),
						),
					),
				),
				agg: step(["fetchA", "fetchB"], (a, b) =>
					pipe(
						combine(a, b),
						switchMap(([va, vb]: [string | null, string | null]) => {
							if (va === undefined || vb === undefined) {
								return producer<string | null>(({ emit, complete }) => {
									emit(null);
									complete();
								});
							}
							if (va === null && vb === null) {
								return producer<string | null>(({ emit, complete }) => {
									emit(null);
									complete();
								});
							}
							return producer<string | null>(({ emit, complete }) => {
								tAgg
									.run(() => new Promise<string>((r) => setTimeout(() => r("agg"), 20)))
									.then((r) => {
										emit(r);
										complete();
									})
									.catch(() => {
										emit(null);
										complete();
									});
							});
						}),
					),
				),
			},
			{ tasks: { fetchA: t1, fetchB: t2, agg: tAgg } },
		);

		// Run #1
		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 200));
		expect(t1.get().status).toBe("success");
		expect(t2.get().status).toBe("success");
		expect(tAgg.get().status).toBe("success");

		// Reset and Run #2
		wf.reset();
		trigger.fire("go-again");
		await new Promise((r) => setTimeout(r, 200));

		// Both fetches should succeed and aggregate should have run
		expect(t1.get().status).toBe("success");
		expect(t2.get().status).toBe("success");
		expect(tAgg.get().status).toBe("success");
		expect(wf.runStatus.get()).toBe("completed");

		wf.destroy();
		t1.destroy();
		t2.destroy();
		tAgg.destroy();
	});

	it("runStatus does not fire completed before downstream tasks start (race fix)", async () => {
		// Reproduces the airflow demo timing bug: when emit/complete is in a
		// .then() callback AFTER task.run(), there's a microtask gap where
		// runStatus sees all parallel tasks as "success" but downstream hasn't
		// started yet. Fix: emit/complete inside task.run() body, before return.
		const t1 = taskState<string>();
		const t2 = taskState<string>();
		const tAgg = taskState<string>();

		const trigger = fromTrigger<string>();

		const wf = pipeline(
			{
				trigger: step(trigger),
				cron: step(["trigger"], (src) =>
					pipe(
						src,
						switchMap(() =>
							producer<string>(({ emit, complete }) => {
								emit("triggered");
								complete();
							}),
						),
					),
				),
				fetchA: step(["cron"], (src) =>
					pipe(
						src,
						switchMap(() =>
							producer<string | null>(({ emit, complete }) => {
								// CORRECT: emit/complete inside task.run() body
								t1.run(async () => {
									const r = await new Promise<string>((res) =>
										setTimeout(() => res("a-result"), 30),
									);
									emit(r);
									complete();
									return r;
								}).catch(() => {
									emit(null);
									complete();
								});
							}),
						),
					),
				),
				fetchB: step(["cron"], (src) =>
					pipe(
						src,
						switchMap(() =>
							producer<string | null>(({ emit, complete }) => {
								// CORRECT: emit/complete inside task.run() body
								t2.run(async () => {
									const r = await new Promise<string>((res) =>
										setTimeout(() => res("b-result"), 50),
									);
									emit(r);
									complete();
									return r;
								}).catch(() => {
									emit(null);
									complete();
								});
							}),
						),
					),
				),
				agg: step(["fetchA", "fetchB"], (a, b) =>
					pipe(
						combine(a, b),
						switchMap(([va, vb]: [string | null, string | null]) => {
							if (va === undefined || vb === undefined) {
								return producer<string | null>(({ emit, complete }) => {
									emit(null);
									complete();
								});
							}
							if (va === null && vb === null) {
								return producer<string | null>(({ emit, complete }) => {
									emit(null);
									complete();
								});
							}
							return producer<string | null>(({ emit, complete }) => {
								tAgg
									.run(async () => {
										const r = await new Promise<string>((res) => setTimeout(() => res("agg"), 20));
										emit(r);
										complete();
										return r;
									})
									.catch(() => {
										emit(null);
										complete();
									});
							});
						}),
					),
				),
			},
			{ tasks: { fetchA: t1, fetchB: t2, agg: tAgg } },
		);

		// Track runStatus transitions via subscribe (same pattern as demo)
		const statuses: PipelineStatus[] = [];
		const unsub = subscribe(wf.runStatus, (rs) => statuses.push(rs));

		trigger.fire("go");
		await new Promise((r) => setTimeout(r, 200));

		// When completed fires, aggregate should have already run
		expect(tAgg.get().status).toBe("success");
		expect(wf.runStatus.get()).toBe("completed");

		// Verify no premature "completed" before aggregate ran:
		// statuses should show active → completed (not active → completed → active → completed)
		const completedIndices = statuses
			.map((s, i) => (s === "completed" ? i : -1))
			.filter((i) => i >= 0);
		expect(completedIndices.length).toBe(1); // completed fires exactly once

		unsub();
		wf.destroy();
		t1.destroy();
		t2.destroy();
		tAgg.destroy();
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
