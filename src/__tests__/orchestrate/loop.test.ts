import { describe, expect, it, vi } from "vitest";
import { subscribe } from "../../core/subscribe";
import { fromTrigger } from "../../extra/fromTrigger";
import { toD2, toMermaid } from "../../orchestrate/diagram";
import { loop } from "../../orchestrate/loop";
import { pipeline, step } from "../../orchestrate/pipeline";
import { task } from "../../orchestrate/task";

/** Collect all emitted values from a store subscription. */
function collect<T>(store: import("../../core/types").Store<T>): {
	values: T[];
	unsub: () => void;
} {
	const values: T[] = [];
	const unsub = subscribe(store, (v) => {
		values.push(v);
	});
	return { values, unsub };
}

describe("loop", () => {
	it("iterates until predicate returns true", async () => {
		const trigger = fromTrigger<number>();
		const wf = pipeline({
			trigger: step(trigger),
			iterate: loop(["trigger"], (_signal, [n]: [number]) => ({
				steps: {
					double: task([], async (_signal) => n * 2),
				},
				output: "double",
				predicate: (v) => v >= 100,
			})),
		});

		const { values } = collect(wf.steps.iterate);

		trigger.fire(10); // 10→20→40→80→160 (done at 160)
		await vi.waitFor(() => expect(values).toContain(160));

		wf.destroy();
	});

	it("emits immediately if predicate is true on first iteration", async () => {
		const trigger = fromTrigger<number>();
		const wf = pipeline({
			trigger: step(trigger),
			iterate: loop(["trigger"], (_signal, [n]: [number]) => ({
				steps: {
					pass: task([], async (_signal) => n),
				},
				output: "pass",
				predicate: () => true,
			})),
		});

		const { values } = collect(wf.steps.iterate);

		trigger.fire(42);
		await vi.waitFor(() => expect(values).toContain(42));

		wf.destroy();
	});

	it("errors when maxIterations exceeded", async () => {
		const trigger = fromTrigger<number>();
		const steps = {
			trigger: step(trigger),
			iterate: loop(
				["trigger"],
				(_signal, [n]: [number]) => ({
					steps: {
						inc: task([], async (_signal) => n + 1),
					},
					output: "inc",
					predicate: () => false, // never done
				}),
				{ maxIterations: 5 },
			),
		};
		const wf = pipeline(steps);

		const { values } = collect(wf.steps.iterate);

		trigger.fire(0);
		await vi.waitFor(() => {
			expect(values).toContain(undefined); // error → undefined emission
			expect(steps.iterate.error.get()).toBeDefined();
		});

		wf.destroy();
	});

	it("cancels on re-trigger (switchMap)", async () => {
		const trigger = fromTrigger<number>();
		const wf = pipeline({
			trigger: step(trigger),
			iterate: loop(["trigger"], (_signal, [n]: [number]) => {
				let count = 0;
				return {
					steps: {
						inc: task([], async (_signal) => {
							count++;
							return n + count;
						}),
					},
					output: "inc",
					predicate: (v) => v >= 100,
				};
			}),
		});

		const { values } = collect(wf.steps.iterate);

		trigger.fire(1);
		// Immediately re-trigger — should cancel previous loop
		trigger.fire(99);

		// The second trigger starts at 99, so 99+1=100 (done in 1 iteration)
		await vi.waitFor(() => {
			const meaningful = values.filter((v) => v !== undefined);
			expect(meaningful).toContain(100);
		});

		wf.destroy();
	});

	it("tracks task status through lifecycle", async () => {
		const trigger = fromTrigger<number>();
		const steps = {
			trigger: step(trigger),
			iterate: loop(
				["trigger"],
				(_signal, [n]: [number]) => ({
					steps: {
						pass: task([], async (_signal) => n),
					},
					output: "pass",
					predicate: () => true,
					name: "testLoop",
				}),
				{ name: "testLoop" },
			),
		};
		const wf = pipeline(steps);

		subscribe(wf.steps.iterate, () => {});

		expect(steps.iterate.status.get()).toBe("idle");

		trigger.fire(1);
		await vi.waitFor(() => expect(steps.iterate.status.get()).toBe("success"));

		wf.destroy();
	});

	it("passes previous output to next iteration", async () => {
		const receivedValues: number[] = [];

		const trigger = fromTrigger<number>();
		const wf = pipeline({
			trigger: step(trigger),
			iterate: loop(["trigger"], (_signal, [n]: [number]) => {
				receivedValues.push(n);
				return {
					steps: {
						inc: task([], async (_signal) => n + 10),
					},
					output: "inc",
					predicate: (v) => v >= 50,
				};
			}),
		});

		const { values } = collect(wf.steps.iterate);

		trigger.fire(5); // 5→15→25→35→45→55
		await vi.waitFor(() => expect(values).toContain(55));

		// Factory should have received: 5, 15, 25, 35, 45
		expect(receivedValues).toEqual([5, 15, 25, 35, 45]);

		wf.destroy();
	});

	it("provides iteration index to predicate", async () => {
		const iterations: number[] = [];

		const trigger = fromTrigger<string>();
		const wf = pipeline({
			trigger: step(trigger),
			iterate: loop(["trigger"], (_signal, [v]: [string]) => ({
				steps: {
					echo: task([], async (_signal) => v),
				},
				output: "echo",
				predicate: (_val, iter) => {
					iterations.push(iter);
					return iter >= 2; // stop after 3 iterations (0, 1, 2)
				},
			})),
		});

		const { values } = collect(wf.steps.iterate);

		trigger.fire("x");
		await vi.waitFor(() => expect(values).toContain("x"));
		expect(iterations).toEqual([0, 1, 2]);

		wf.destroy();
	});

	it("handles multiple deps", async () => {
		const t1 = fromTrigger<number>();
		const t2 = fromTrigger<number>();
		const wf = pipeline({
			a: step(t1),
			b: step(t2),
			iterate: loop(["a", "b"], (_signal, [a, b]: [number, number]) => ({
				steps: {
					sum: task([], async (_signal) => a + b),
				},
				output: "sum",
				predicate: (v) => v >= 10,
			})),
		});

		const { values } = collect(wf.steps.iterate);

		t1.fire(3);
		t2.fire(7); // 3+7=10, predicate true on first iteration

		await vi.waitFor(() => expect(values).toContain(10));

		wf.destroy();
	});

	it("skips undefined upstream values", () => {
		const trigger = fromTrigger<number>();
		const wf = pipeline({
			trigger: step(trigger),
			iterate: loop(["trigger"], (_signal, [n]: [number]) => ({
				steps: { pass: task([], async (_signal) => n) },
				output: "pass",
				predicate: () => true,
			})),
		});

		// fromTrigger starts with undefined — guard skips, store stays at initial undefined
		expect(wf.steps.iterate.get()).toBe(undefined);

		wf.destroy();
	});

	it("renders correctly in diagrams", () => {
		const steps = {
			trigger: step(fromTrigger<number>()),
			iterate: loop(
				["trigger"],
				(_signal, [n]: [number]) => ({
					steps: { pass: task([], async (_signal) => n) },
					output: "pass",
					predicate: () => true,
				}),
				{ name: "iterate" },
			),
		};

		const mermaid = toMermaid(steps);
		expect(mermaid).toContain("loop");

		const d2 = toD2(steps);
		expect(d2).toContain("loop");
		expect(d2).toContain("hexagon");
	});

	it("cleans up child pipeline on destroy", async () => {
		const trigger = fromTrigger<number>();
		const wf = pipeline({
			trigger: step(trigger),
			iterate: loop(["trigger"], (_signal, [n]: [number]) => ({
				steps: {
					slow: task([], async (_signal) => {
						await new Promise((r) => setTimeout(r, 5000));
						return n;
					}),
				},
				output: "slow",
				predicate: () => true,
			})),
		});

		subscribe(wf.steps.iterate, () => {});
		trigger.fire(1);

		// Allow the loop to start
		await new Promise((r) => setTimeout(r, 50));

		// Destroy should not throw
		wf.destroy();
	});
});
