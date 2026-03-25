/**
 * workflowNode.simulate() integration tests — validates that the callbag-based
 * simulate correctly emits values and errors through the callbag protocol,
 * and that firstValueFrom properly bridges them to Promises for task() callbacks.
 *
 * Regression tests for: simulate returning CallbagSource that was incorrectly
 * `await`-ed as a plain value (resolves to function, never subscribes).
 */
import { describe, expect, it, vi } from "vitest";
import { workflowNode } from "../../orchestrate/workflowNode";
import { firstValueFrom } from "../../raw/firstValueFrom";
import { rawSubscribe } from "../../raw/subscribe";

describe("workflowNode.simulate callbag protocol", () => {
	it("emits result string on success via rawSubscribe", async () => {
		const node = workflowNode("test", "Test Node");
		const values: string[] = [];
		let ended = false;

		rawSubscribe(node.simulate([0, 0], 0), (v: string) => values.push(v), {
			onEnd: (err) => {
				ended = true;
				expect(err).toBeUndefined();
			},
		});

		await vi.waitFor(() => {
			expect(values).toHaveLength(1);
		});
		expect(values[0]).toBe("Test Node result");
		expect(ended).toBe(true);
		node.destroy();
	});

	it("emits error via END(err) when failure rate is 1.0", async () => {
		const node = workflowNode("test", "Fail Node");
		let error: unknown = null;
		let gotValue = false;

		rawSubscribe(
			node.simulate([0, 0], 1),
			() => {
				gotValue = true;
			},
			{
				onEnd: (err) => {
					error = err;
				},
			},
		);

		await vi.waitFor(() => {
			expect(error).not.toBeNull();
		});
		expect(gotValue).toBe(false);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("Fail Node failed");
		node.destroy();
	});

	it("firstValueFrom bridges simulate success to Promise", async () => {
		const node = workflowNode("test", "Bridge");
		const result = await firstValueFrom(node.simulate([0, 0], 0));
		expect(result).toBe("Bridge result");
		node.destroy();
	});

	it("firstValueFrom rejects on simulate failure", async () => {
		const node = workflowNode("test", "FailBridge");
		await expect(firstValueFrom(node.simulate([0, 0], 1))).rejects.toThrow("FailBridge failed");
		node.destroy();
	});

	it("records breaker state on success", async () => {
		const node = workflowNode("test", "BreakerOk");
		await firstValueFrom(node.simulate([0, 0], 0));
		expect(node.breakerState.get()).toBe("closed");
		expect(node.breaker.state).toBe("closed");
		node.destroy();
	});

	it("records breaker state on failure", async () => {
		const node = workflowNode("test", "BreakerFail");
		try {
			await firstValueFrom(node.simulate([0, 0], 1));
		} catch {
			// expected
		}
		// Breaker should have recorded the failure
		expect(node.breaker.state).toBe("closed"); // single failure doesn't open
		node.destroy();
	});

	it("respects AbortSignal (cancel before start)", async () => {
		const node = workflowNode("test", "Abort");
		const ac = new AbortController();
		ac.abort();

		await expect(firstValueFrom(node.simulate([100, 100], 0, ac.signal))).rejects.toThrow(
			"Abort aborted",
		);
		node.destroy();
	});

	it("logs events during simulate", async () => {
		const node = workflowNode("test", "Logger");
		await firstValueFrom(node.simulate([0, 0], 0));
		const entries = node.log.toArray();
		expect(entries.some((e) => e.value.includes("[OK]"))).toBe(true);
		node.destroy();
	});

	it("logs error events on failure", async () => {
		const node = workflowNode("test", "ErrLogger");
		try {
			await firstValueFrom(node.simulate([0, 0], 1));
		} catch {
			// expected
		}
		const entries = node.log.toArray();
		expect(entries.some((e) => e.value.includes("[ERROR]"))).toBe(true);
		node.destroy();
	});
});

describe("workflowNode.simulate + task integration", () => {
	it("await on raw CallbagSource is a bug — resolves to function, not value", async () => {
		const node = workflowNode("test", "AwaitBug");
		// This demonstrates the bug pattern: awaiting a CallbagSource directly
		const result = await node.simulate([0, 0], 0);
		// BUG: result is the callbag function, not the emitted value
		expect(typeof result).toBe("function");
		expect(result).not.toBe("AwaitBug result");
		node.destroy();
	});

	it("await firstValueFrom(simulate) is the correct pattern", async () => {
		const node = workflowNode("test", "Correct");
		const result = await firstValueFrom(node.simulate([0, 0], 0));
		expect(typeof result).toBe("string");
		expect(result).toBe("Correct result");
		node.destroy();
	});
});
