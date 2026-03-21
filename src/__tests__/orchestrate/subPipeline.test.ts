import { describe, expect, it } from "vitest";
import { fromTrigger } from "../../extra/fromTrigger";
import { subscribe } from "../../extra/subscribe";
import { pipeline, step } from "../../orchestrate/pipeline";
import { subPipeline } from "../../orchestrate/subPipeline";
import { task } from "../../orchestrate/task";

describe("subPipeline (nested pipeline invocation)", () => {
	it("creates child pipeline, runs to completion, emits output", async () => {
		const wf = pipeline({
			trigger: step(fromTrigger<number>()),
			sub: subPipeline(["trigger"], (n: number) => ({
				steps: {
					double: task([], async () => n * 2),
					add: task(["double"], async (d: number) => d + 10),
				},
				output: "add",
			})),
		});

		const results: any[] = [];
		const unsub = subscribe(wf.steps.sub, (v) => results.push(v));

		(wf.steps.trigger as any).fire(5);
		await new Promise((r) => setTimeout(r, 200));

		const nonNull = results.filter((r) => r !== null);
		expect(nonNull).toContain(20); // 5 * 2 + 10

		unsub();
		wf.destroy();
	});

	it("defaults output to last step in topological order", async () => {
		const wf = pipeline({
			trigger: step(fromTrigger<string>()),
			sub: subPipeline(["trigger"], (v: string) => ({
				steps: {
					first: task([], async () => `step1: ${v}`),
					last: task(["first"], async (s: string) => `step2: ${s}`),
				},
				// No output specified — should default to "last"
			})),
		});

		const results: any[] = [];
		const unsub = subscribe(wf.steps.sub, (v) => results.push(v));

		(wf.steps.trigger as any).fire("hello");
		await new Promise((r) => setTimeout(r, 200));

		const nonNull = results.filter((r) => r !== null);
		expect(nonNull.some((r) => typeof r === "string" && r.includes("step2"))).toBe(true);

		unsub();
		wf.destroy();
	});

	it("tracks task status through lifecycle", async () => {
		const subStep = subPipeline(["trigger"], (v: number) => ({
			steps: {
				work: task([], async () => {
					await new Promise((r) => setTimeout(r, 30));
					return v * 3;
				}),
			},
			output: "work",
		}));

		const wf = pipeline({
			trigger: step(fromTrigger<number>()),
			sub: subStep,
		});

		const unsub = subscribe(wf.steps.sub, () => {});

		expect(subStep.status.get()).toBe("idle");

		(wf.steps.trigger as any).fire(7);
		await new Promise((r) => setTimeout(r, 10));

		// Should be running
		expect(subStep.status.get()).toBe("running");

		await new Promise((r) => setTimeout(r, 100));

		// Should be success
		expect(subStep.status.get()).toBe("success");

		unsub();
		wf.destroy();
	});

	it("destroys child pipeline on re-trigger", async () => {
		let childCount = 0;
		const wf = pipeline({
			trigger: step(fromTrigger<number>()),
			sub: subPipeline(["trigger"], (v: number) => {
				childCount++;
				return {
					steps: {
						work: task([], async () => {
							await new Promise((r) => setTimeout(r, 50));
							return v;
						}),
					},
					output: "work",
				};
			}),
		});

		const results: any[] = [];
		const unsub = subscribe(wf.steps.sub, (v) => results.push(v));

		(wf.steps.trigger as any).fire(1);
		await new Promise((r) => setTimeout(r, 20));

		// Re-trigger before first completes
		(wf.steps.trigger as any).fire(2);
		await new Promise((r) => setTimeout(r, 150));

		// Two children were created
		expect(childCount).toBe(2);

		// Only the second result should be emitted (first cancelled)
		const nonNull = results.filter((r) => r !== null);
		expect(nonNull[nonNull.length - 1]).toBe(2);

		unsub();
		wf.destroy();
	});

	it("handles child pipeline errors", async () => {
		const subStep = subPipeline(["trigger"], () => ({
			steps: {
				fail: task([], async () => {
					throw new Error("child boom");
				}),
			},
			output: "fail",
		}));

		const wf = pipeline({
			trigger: step(fromTrigger<string>()),
			sub: subStep,
		});

		const results: any[] = [];
		const unsub = subscribe(wf.steps.sub, (v) => results.push(v));

		(wf.steps.trigger as any).fire("go");
		await new Promise((r) => setTimeout(r, 200));

		// subPipeline should have tracked the error
		expect(subStep.status.get()).toBe("error");
		expect(subStep.error.get()).toBeInstanceOf(Error);

		unsub();
		wf.destroy();
	});

	it("handles multiple deps with combine", async () => {
		const wf = pipeline({
			a: step(fromTrigger<number>()),
			b: step(fromTrigger<string>()),
			sub: subPipeline(["a", "b"], (num: number, str: string) => ({
				steps: {
					merge: task([], async () => `${str}-${num}`),
				},
				output: "merge",
			})),
		});

		const results: any[] = [];
		const unsub = subscribe(wf.steps.sub, (v) => results.push(v));

		(wf.steps.a as any).fire(42);
		(wf.steps.b as any).fire("hello");
		await new Promise((r) => setTimeout(r, 200));

		const nonNull = results.filter((r) => r !== null);
		expect(nonNull.some((r) => r === "hello-42")).toBe(true);

		unsub();
		wf.destroy();
	});

	it("destroys child pipeline on parent destroy", async () => {
		const wf = pipeline({
			trigger: step(fromTrigger<number>()),
			sub: subPipeline(["trigger"], (v: number) => ({
				steps: {
					work: task([], async () => {
						await new Promise((r) => setTimeout(r, 500));
						return v;
					}),
				},
			})),
		});

		const unsub = subscribe(wf.steps.sub, () => {});

		(wf.steps.trigger as any).fire(1);
		await new Promise((r) => setTimeout(r, 20));

		// Destroy parent while child is running — should not throw
		wf.destroy();
		unsub();
	});
});
