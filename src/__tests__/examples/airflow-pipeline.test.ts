/**
 * Airflow pipeline integration tests — validates that task() + workflowNode.simulate()
 * properly propagates both success values and failure errors through the pipeline.
 *
 * Regression tests for: simulate returning CallbagSource that was incorrectly
 * `await`-ed, causing failures to never trigger and tasks to complete instantly.
 */
import { describe, expect, it, vi } from "vitest";
import { fromTrigger } from "../../extra/fromTrigger";
import { pipeline, source, task, workflowNode } from "../../orchestrate/index";
import { TASK_STATE } from "../../orchestrate/types";
import { firstValueFrom } from "../../raw/firstValueFrom";

describe("airflow pipeline failure propagation", () => {
	it("task with simulate failure sets taskState to error", async () => {
		const wn = workflowNode("fail-node", "Always Fails");
		const trigger = fromTrigger<string>({ name: "trigger" });

		const taskDef = task(
			["trigger"],
			async (signal) => {
				return firstValueFrom(wn.simulate([0, 0], 1, signal)); // 100% failure
			},
			{ name: "fail-task" },
		);

		const wf = pipeline({ trigger: source(trigger), "fail-task": taskDef }, { name: "fail-wf" });

		trigger.fire("go");

		const ts = (taskDef as any)[TASK_STATE];
		await vi.waitFor(() => {
			expect(ts.status.get()).toBe("error");
		});

		expect(ts.error.get()).toBeInstanceOf(Error);
		expect((ts.error.get() as Error).message).toContain("Always Fails failed");

		wn.destroy();
		wf.destroy();
	});

	it("task with simulate success emits the result value", async () => {
		const wn = workflowNode("ok-node", "Always OK");
		const trigger = fromTrigger<string>({ name: "trigger" });

		const taskDef = task(
			["trigger"],
			async (signal) => {
				return firstValueFrom(wn.simulate([0, 0], 0, signal)); // 0% failure
			},
			{ name: "ok-task" },
		);

		const wf = pipeline({ trigger: source(trigger), "ok-task": taskDef }, { name: "ok-wf" });

		trigger.fire("go");

		const ts = (taskDef as any)[TASK_STATE];
		await vi.waitFor(() => {
			expect(ts.status.get()).toBe("success");
		});

		expect(ts.result.get()).toBe("Always OK result");

		wn.destroy();
		wf.destroy();
	});

	it("simulate logs events on success and failure", async () => {
		const okNode = workflowNode("ok", "OK Node");
		const failNode = workflowNode("fail", "Fail Node");

		await firstValueFrom(okNode.simulate([0, 0], 0));
		const okLogs = okNode.log.toArray().map((e) => e.value);
		expect(okLogs.some((l) => l.includes("[OK]"))).toBe(true);

		try {
			await firstValueFrom(failNode.simulate([0, 0], 1));
		} catch {
			// expected
		}
		const failLogs = failNode.log.toArray().map((e) => e.value);
		expect(failLogs.some((l) => l.includes("[ERROR]"))).toBe(true);

		okNode.destroy();
		failNode.destroy();
	});

	it("downstream tasks skip when upstream fails (pipeline skip propagation)", async () => {
		const upNode = workflowNode("up", "Upstream");
		const downNode = workflowNode("down", "Downstream");
		const trigger = fromTrigger<string>({ name: "trigger" });

		const upDef = task(
			["trigger"],
			async (signal) => {
				return firstValueFrom(upNode.simulate([0, 0], 1, signal)); // always fails
			},
			{ name: "upstream" },
		);

		const downDef = task(
			["upstream"],
			async (signal) => {
				return firstValueFrom(downNode.simulate([0, 0], 0, signal));
			},
			{ name: "downstream" },
		);

		const wf = pipeline(
			{ trigger: source(trigger), upstream: upDef, downstream: downDef },
			{ name: "skip-wf" },
		);

		trigger.fire("go");

		const upTs = (upDef as any)[TASK_STATE];
		const downTs = (downDef as any)[TASK_STATE];

		await vi.waitFor(() => {
			expect(upTs.status.get()).toBe("error");
		});

		await vi.waitFor(() => {
			expect(downTs.status.get()).toBe("skipped");
		});

		upNode.destroy();
		downNode.destroy();
		wf.destroy();
	});

	it("breaker records failures correctly", async () => {
		const node = workflowNode("breaker-test", "Breaker", {
			failureThreshold: 3,
			cooldownMs: 60000,
		});

		// First failure
		try {
			await firstValueFrom(node.simulate([0, 0], 1));
		} catch {
			// expected
		}
		expect(node.breaker.state).toBe("closed");

		// Second failure
		try {
			await firstValueFrom(node.simulate([0, 0], 1));
		} catch {
			// expected
		}
		expect(node.breaker.state).toBe("closed");

		// Third failure — should trip the breaker
		try {
			await firstValueFrom(node.simulate([0, 0], 1));
		} catch {
			// expected
		}
		expect(node.breakerState.get()).toBe("open");
		expect(node.breaker.canExecute()).toBe(false);

		node.destroy();
	});
});
