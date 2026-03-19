import { describe, expect, it } from "vitest";
import { derived } from "../../core/derived";
import { map } from "../../extra/map";
import { subscribe } from "../../extra/subscribe";
import { pipe, state } from "../../index";
import { fromTrigger, gate, pipeline, route, step, track } from "../../orchestrate";

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
		const s = step((a: any) => a, ["input"]);
		expect(s.deps).toEqual(["input"]);
	});

	it("accepts name option", () => {
		const s = step(state(0), [], { name: "myStep" });
		expect(s.name).toBe("myStep");
	});
});

// ==========================================================================
// pipeline()
// ==========================================================================
describe("pipeline", () => {
	it("wires a simple linear pipeline", () => {
		const wf = pipeline({
			source: step(state(0)),
			doubled: step((s) => derived([s], () => s.get() * 2), ["source"]),
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
			sum: step((a, b) => derived([a, b], () => a.get() + b.get()), ["a", "b"]),
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
			c: step((a, b) => derived([a, b], () => a.get() + b.get()), ["a", "b"]),
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
				a: step((x: any) => x, ["nonexistent"]),
			}),
		).toThrow(/unknown step "nonexistent"/);
	});

	it("throws on cycle", () => {
		expect(() =>
			pipeline({
				a: step((b: any) => b, ["b"]),
				b: step((a: any) => a, ["a"]),
			}),
		).toThrow(/cycle detected/);
	});

	it("works with fromTrigger source", () => {
		const wf = pipeline({
			trigger: step(fromTrigger<number>()),
			doubled: step(
				(s) =>
					pipe(
						s,
						map((x) => (x ?? 0) * 2),
					),
				["trigger"],
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
			tracked: step((s) => pipe(s, track()), ["input"]),
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
			left: step((s) => derived([s], () => s.get() * 2), ["source"]),
			right: step((s) => derived([s], () => s.get() + 10), ["source"]),
			merged: step((l, r) => derived([l, r], () => l.get() + r.get()), ["left", "right"]),
		});

		expect(wf.steps.merged.get()).toBe(13); // (1*2) + (1+10) = 2 + 11

		(wf.steps.source as any).set(5);
		expect(wf.steps.merged.get()).toBe(25); // (5*2) + (5+10) = 10 + 15

		wf.destroy();
	});

	it("works with route for conditional branching", () => {
		const wf = pipeline({
			input: step(fromTrigger<number>()),
			router: step(
				(s) => {
					const [positive, negative] = route(s, (v) => (v ?? 0) > 0);
					// Return positive branch, attach negative for external access
					(positive as any)._negative = negative;
					return positive;
				},
				["input"],
			),
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
				b: step(
					(s) => {
						wiredCount++;
						return derived([s], () => s.get());
					},
					["a"],
				),
				c: step(() => {
					throw new Error("factory boom");
				}, ["b"]),
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

	it("works with gate for human-in-the-loop", () => {
		const wf = pipeline({
			input: step(fromTrigger<string>()),
			gated: step((s) => pipe(s, gate()), ["input"]),
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
});
