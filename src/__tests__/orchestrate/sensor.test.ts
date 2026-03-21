import { describe, expect, it, vi } from "vitest";
import { subscribe } from "../../core/subscribe";
import { fromTrigger } from "../../extra/fromTrigger";
import { toD2, toMermaid } from "../../orchestrate/diagram";
import { pipeline, step } from "../../orchestrate/pipeline";
import { sensor } from "../../orchestrate/sensor";
import { task } from "../../orchestrate/task";

/** Collect non-undefined values. */
function collect<T>(store: import("../../core/types").Store<T>) {
	const values: T[] = [];
	const unsub = subscribe(store, (v) => {
		if (v !== undefined) values.push(v);
	});
	return { values, unsub };
}

describe("sensor", () => {
	it("forwards value when poll returns true immediately", async () => {
		const trigger = fromTrigger<string>();
		const wf = pipeline({
			trigger: step(trigger),
			ready: sensor("trigger", (_signal) => true, { interval: 100 }),
		});

		const { values } = collect(wf.steps.ready);

		trigger.fire("hello");
		await vi.waitFor(() => expect(values).toContain("hello"));

		wf.destroy();
	});

	it("polls until condition is met then forwards upstream value", async () => {
		let pollCount = 0;

		const trigger = fromTrigger<number>();
		const wf = pipeline({
			trigger: step(trigger),
			ready: sensor(
				"trigger",
				(_signal) => {
					pollCount++;
					return pollCount >= 3;
				},
				{ interval: 50 },
			),
		});

		const { values } = collect(wf.steps.ready);

		trigger.fire(42);
		// Wait for 3 polls: immediate + 2 interval ticks
		await vi.waitFor(() => {
			expect(values.filter((v) => v !== null)).toEqual([42]);
		});

		wf.destroy();
	});

	it("errors on timeout", async () => {
		const trigger = fromTrigger<string>();
		const steps = {
			trigger: step(trigger),
			ready: sensor("trigger", (_signal) => false, {
				interval: 50,
				timeout: 150,
			}),
		};
		const wf = pipeline(steps);

		const { values } = collect(wf.steps.ready);

		trigger.fire("test");

		await vi.waitFor(() => {
			expect(values).toContain(null);
			expect(steps.ready.error.get()).toBeDefined();
		});

		wf.destroy();
	});

	it("cancels polling on re-trigger (switchMap)", async () => {
		let pollCount = 0;

		const trigger = fromTrigger<string>();
		const wf = pipeline({
			trigger: step(trigger),
			ready: sensor(
				"trigger",
				(_signal, v) => {
					pollCount++;
					return v === "go" && pollCount >= 2;
				},
				{ interval: 50 },
			),
		});

		const { values } = collect(wf.steps.ready);

		trigger.fire("wait");
		// Let first poll run
		await new Promise((r) => setTimeout(r, 30));
		pollCount = 0;

		// Re-trigger cancels previous polling loop
		trigger.fire("go");
		await vi.waitFor(() => {
			const meaningful = values.filter((v) => v !== null);
			expect(meaningful).toContain("go");
		});

		wf.destroy();
	});

	it("tracks task status through lifecycle", async () => {
		const trigger = fromTrigger<string>();
		const steps = {
			trigger: step(trigger),
			ready: sensor("trigger", (_signal) => false, {
				interval: 50,
				name: "readySensor",
			}),
		};
		const wf = pipeline(steps);

		subscribe(wf.steps.ready, () => {});

		expect(steps.ready.status.get()).toBe("idle");

		trigger.fire("test");
		await vi.waitFor(() => expect(steps.ready.status.get()).toBe("running"));

		wf.destroy();
	});

	it("works with async poll function", async () => {
		const trigger = fromTrigger<number>();
		const wf = pipeline({
			trigger: step(trigger),
			ready: sensor(
				"trigger",
				async (_signal, v) => {
					await new Promise((r) => setTimeout(r, 10));
					return v > 5;
				},
				{ interval: 50 },
			),
		});

		const { values } = collect(wf.steps.ready);

		trigger.fire(10);
		await vi.waitFor(() => expect(values).toContain(10));

		wf.destroy();
	});

	it("cleans up timers on destroy", async () => {
		const trigger = fromTrigger<string>();
		const wf = pipeline({
			trigger: step(trigger),
			ready: sensor("trigger", (_signal) => false, { interval: 50 }),
		});

		subscribe(wf.steps.ready, () => {});
		trigger.fire("test");
		await new Promise((r) => setTimeout(r, 30));

		// Destroy should clean up all timers — no throw
		wf.destroy();

		// Brief wait to confirm no lingering callbacks throw
		await new Promise((r) => setTimeout(r, 100));
	});

	it("skips undefined upstream values", () => {
		const trigger = fromTrigger<string>();
		const wf = pipeline({
			trigger: step(trigger),
			ready: sensor("trigger", (_signal) => true, { interval: 100 }),
		});

		expect(wf.steps.ready.get()).toBe(undefined);

		wf.destroy();
	});

	it("renders correctly in diagrams", () => {
		const steps = {
			trigger: step(fromTrigger<string>()),
			ready: sensor("trigger", (_signal) => true, { name: "ready" }),
			process: task(["ready"], async (_signal, [v]) => v),
		};

		const mermaid = toMermaid(steps);
		expect(mermaid).toContain("sensor");

		const d2 = toD2(steps);
		expect(d2).toContain("sensor");
		expect(d2).toContain("hexagon");
	});

	it("transitions to success status after poll succeeds", async () => {
		const trigger = fromTrigger<number>();
		const steps = {
			trigger: step(trigger),
			ready: sensor("trigger", (_signal) => true, { name: "s" }),
		};
		const wf = pipeline(steps);

		subscribe(wf.steps.ready, () => {});
		trigger.fire(1);

		await vi.waitFor(() => expect(steps.ready.status.get()).toBe("success"));
		expect(steps.ready.runCount.get()).toBe(1);

		wf.destroy();
	});

	it("handles poll function that throws", async () => {
		const trigger = fromTrigger<string>();
		const steps = {
			trigger: step(trigger),
			ready: sensor(
				"trigger",
				(_signal) => {
					throw new Error("poll failed");
				},
				{ interval: 50 },
			),
		};
		const wf = pipeline(steps);

		const { values } = collect(wf.steps.ready);

		trigger.fire("test");
		await vi.waitFor(() => {
			expect(values).toContain(null);
			expect(steps.ready.error.get()).toBeDefined();
		});

		wf.destroy();
	});
});
