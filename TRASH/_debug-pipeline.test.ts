import { describe, expect, it, vi } from "vitest";
import { fromTrigger } from "../../extra/fromTrigger";
import { pipeline, source, task } from "../../orchestrate/index";
import { TASK_STATE } from "../../orchestrate/types";

describe("debug pipeline", () => {
	it("basic trigger + sync task", () => {
		const trigger = fromTrigger<string>();
		const taskDef = task(["trigger"], async (_signal, [v]) => `got-${v}`, { name: "work" });
		const wf = pipeline({ trigger: source(trigger), work: taskDef });

		const ts = (taskDef as any)[TASK_STATE];
		console.log("Before fire - status:", ts.status.get());

		trigger.fire("go");
		console.log("After fire - status:", ts.status.get());
		console.log("After fire - result:", ts.result.get());

		expect(ts.status.get()).toBe("success");
		wf.destroy();
	});

	it("trigger<void> + sync task", () => {
		const trigger = fromTrigger<void>();
		const taskDef = task(["trigger"], async (_signal) => "done", { name: "work" });
		const wf = pipeline({ trigger: source(trigger), work: taskDef });

		const ts = (taskDef as any)[TASK_STATE];
		trigger.fire();
		console.log("void trigger - status:", ts.status.get());

		expect(ts.status.get()).toBe("success");
		wf.destroy();
	});

	it("trigger + async task with setTimeout", async () => {
		const trigger = fromTrigger<string>();
		const taskDef = task(
			["trigger"],
			async (_signal) => {
				await new Promise((r) => setTimeout(r, 10));
				return "async-done";
			},
			{ name: "work" },
		);
		const wf = pipeline({ trigger: source(trigger), work: taskDef });

		const ts = (taskDef as any)[TASK_STATE];
		trigger.fire("go");
		console.log("async before wait - status:", ts.status.get());

		await vi.waitFor(() => {
			expect(ts.status.get()).toBe("success");
		});
		console.log("async after wait - result:", ts.result.get());

		wf.destroy();
	});
});
