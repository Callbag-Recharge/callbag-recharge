import { describe, expect, it } from "vitest";
import { fromTrigger } from "../../extra/fromTrigger";
import { subscribe } from "../../extra/subscribe";
import { branch, pipeline, step, task } from "../../orchestrate";

// ==========================================================================
// branch() — step definition
// ==========================================================================
describe("branch", () => {
	it("creates a step def with single dep", () => {
		const b = branch("input", (v: number) => v > 0);
		expect(b.deps).toEqual(["input"]);
		expect(b.factory).toBeDefined();
		expect(b._failStore).toBeDefined();
	});

	it("accepts name option", () => {
		const b = branch("input", (v: number) => v > 0, { name: "myBranch" });
		expect(b.name).toBe("myBranch");
	});
});

// ==========================================================================
// branch() in pipeline — basic routing
// ==========================================================================
describe("branch in pipeline — basic routing", () => {
	it("routes matching values to pass branch", () => {
		const trigger = fromTrigger<number>();

		const wf = pipeline({
			input: step(trigger),
			check: branch("input", (v: number) => v > 0),
		});

		const passValues: (number | undefined)[] = [];
		const unsub = subscribe(wf.steps.check, (v) => passValues.push(v));

		trigger.fire(5);
		trigger.fire(-3);
		trigger.fire(10);

		// Only positive values pass through
		expect(passValues).toEqual([5, 10]);

		unsub();
		wf.destroy();
	});

	it("routes non-matching values to .fail branch", () => {
		const trigger = fromTrigger<number>();

		const wf = pipeline({
			input: step(trigger),
			check: branch("input", (v: number) => v > 0),
		});

		const failValues: (number | undefined)[] = [];
		const failStore = wf.steps["check.fail" as keyof typeof wf.steps];
		expect(failStore).toBeDefined();
		const unsub = subscribe(failStore, (v) => failValues.push(v));

		trigger.fire(5);
		trigger.fire(-3);
		trigger.fire(10);

		// Only negative values go to fail branch
		expect(failValues).toEqual([-3]);

		unsub();
		wf.destroy();
	});
});

// ==========================================================================
// branch() with task() downstream
// ==========================================================================
describe("branch with task downstream", () => {
	it("pass branch feeds downstream task", async () => {
		const trigger = fromTrigger<number>();

		const wf = pipeline({
			input: step(trigger),
			check: branch("input", (v: number) => v > 0),
			process: task(["check"], (_signal, [v]: [number | undefined]) => `good:${v}`),
		});

		const values: any[] = [];
		subscribe(wf.steps.process, (v) => values.push(v));

		trigger.fire(5);
		await new Promise((r) => setTimeout(r, 50));

		expect(values).toContain("good:5");

		wf.destroy();
	});

	it("fail branch feeds downstream task via compound dep", async () => {
		const trigger = fromTrigger<number>();

		const wf = pipeline({
			input: step(trigger),
			check: branch("input", (v: number) => v > 0),
			reject: task(["check.fail"], (_signal, [v]: [number | undefined]) => `bad:${v}`),
		});

		const values: any[] = [];
		subscribe(wf.steps.reject, (v) => values.push(v));

		trigger.fire(-3);
		await new Promise((r) => setTimeout(r, 50));

		expect(values).toContain("bad:-3");

		wf.destroy();
	});

	it("both branches work in same pipeline", async () => {
		const trigger = fromTrigger<number>();

		const wf = pipeline({
			input: step(trigger),
			validate: branch("input", (v: number) => v > 0),
			process: task(["validate"], (_signal, [v]: [number | undefined]) => `processed:${v}`),
			reject: task(["validate.fail"], (_signal, [v]: [number | undefined]) => `rejected:${v}`),
		});

		const processValues: any[] = [];
		const rejectValues: any[] = [];
		subscribe(wf.steps.process, (v) => processValues.push(v));
		subscribe(wf.steps.reject, (v) => rejectValues.push(v));

		trigger.fire(5);
		await new Promise((r) => setTimeout(r, 50));

		trigger.fire(-3);
		await new Promise((r) => setTimeout(r, 50));

		expect(processValues).toContain("processed:5");
		expect(rejectValues).toContain("rejected:-3");

		wf.destroy();
	});
});

// ==========================================================================
// branch() — topological order
// ==========================================================================
describe("branch — topological order", () => {
	it("compound deps resolve to parent in topo sort", () => {
		const trigger = fromTrigger<number>();

		const wf = pipeline({
			input: step(trigger),
			check: branch("input", (v: number) => v > 0),
			reject: task(["check.fail"], (_signal, [v]: [number | undefined]) => `bad:${v}`),
		});

		// check should come before reject in order
		const checkIdx = wf.inner.order.indexOf("check");
		const rejectIdx = wf.inner.order.indexOf("reject");
		expect(checkIdx).toBeLessThan(rejectIdx);

		wf.destroy();
	});
});
