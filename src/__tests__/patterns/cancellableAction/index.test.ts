import { describe, expect, it, vi } from "vitest";
import { cancellableAction } from "../../../utils/cancellableAction";

// ---------------------------------------------------------------------------
// cancellableAction
// ---------------------------------------------------------------------------
describe("cancellableAction", () => {
	it("executes and stores result", async () => {
		const action = cancellableAction(async (input: string) => {
			return `result: ${input}`;
		});

		const result = await action.execute("hello");
		expect(result).toBe("result: hello");
		expect(action.data.get()).toBe("result: hello");
		expect(action.loading.get()).toBe(false);
		expect(action.error.get()).toBeUndefined();
	});

	it("tracks loading state", async () => {
		const action = cancellableAction(async (input: string) => {
			await new Promise((r) => setTimeout(r, 50));
			return input;
		});

		const promise = action.execute("test");
		expect(action.loading.get()).toBe(true);

		await promise;
		expect(action.loading.get()).toBe(false);
	});

	it("auto-cancels previous execution", async () => {
		const calls: string[] = [];

		const action = cancellableAction(async (input: string, signal) => {
			await new Promise((r) => setTimeout(r, 100));
			if (!signal.aborted) calls.push(input);
			return input;
		});

		action.execute("first");
		await new Promise((r) => setTimeout(r, 20));
		await action.execute("second");

		// Only second should complete
		expect(calls).toEqual(["second"]);
		expect(action.data.get()).toBe("second");
	});

	it("handles errors", async () => {
		const action = cancellableAction(async () => {
			throw new Error("fail");
		});

		const result = await action.execute("test");
		expect(result).toBeUndefined();
		expect(action.error.get()).toBeInstanceOf(Error);
		expect(action.loading.get()).toBe(false);
	});

	it("cancel aborts current execution", async () => {
		const aborted = vi.fn();
		const action = cancellableAction(async (_input: string, signal) => {
			signal.addEventListener("abort", aborted);
			await new Promise((r) => setTimeout(r, 500));
			return "done";
		});

		action.execute("test");
		await new Promise((r) => setTimeout(r, 20));
		action.cancel();

		expect(aborted).toHaveBeenCalled();
		expect(action.loading.get()).toBe(false);
	});

	it("tracks run count", async () => {
		const action = cancellableAction(async (n: number) => n * 2);

		expect(action.runCount.get()).toBe(0);
		await action.execute(1);
		expect(action.runCount.get()).toBe(1);
		await action.execute(2);
		expect(action.runCount.get()).toBe(2);
	});

	it("supports initial data value", () => {
		const action = cancellableAction(async (n: number) => n, {
			initial: 42,
		});
		expect(action.data.get()).toBe(42);
	});

	it("clears data by default when starting new execution", async () => {
		const action = cancellableAction(async (n: number) => {
			await new Promise((r) => setTimeout(r, 50));
			return n;
		});

		await action.execute(42);
		expect(action.data.get()).toBe(42);

		const promise = action.execute(99);
		expect(action.data.get()).toBeUndefined(); // cleared
		await promise;
		expect(action.data.get()).toBe(99);
	});

	it("keepPreviousData preserves old data while loading", async () => {
		const action = cancellableAction(
			async (n: number) => {
				await new Promise((r) => setTimeout(r, 50));
				return n;
			},
			{ keepPreviousData: true },
		);

		await action.execute(42);
		expect(action.data.get()).toBe(42);

		const promise = action.execute(99);
		expect(action.data.get()).toBe(42); // preserved
		await promise;
		expect(action.data.get()).toBe(99);
	});

	it("discards stale results from cancelled executions", async () => {
		const action = cancellableAction(async (n: number) => {
			await new Promise((r) => setTimeout(r, n * 10));
			return n;
		});

		// Start slow execution
		const p1 = action.execute(10); // 100ms
		await new Promise((r) => setTimeout(r, 10));

		// Start fast execution (cancels slow one)
		const p2 = action.execute(1); // 10ms

		await Promise.allSettled([p1, p2]);
		expect(action.data.get()).toBe(1); // fast one wins
	});
});
