import { describe, expect, it, vi } from "vitest";
import { cancellableAction } from "../../../utils/cancellableAction";
import { tokenBucket } from "../../../utils/rateLimiter";

const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// cancellableAction
// ---------------------------------------------------------------------------
describe("cancellableAction", () => {
	it("executes and stores result", async () => {
		const action = cancellableAction(async (input: string) => {
			return `result: ${input}`;
		});

		action.execute("hello");
		await flush();
		expect(action.data.get()).toBe("result: hello");
		expect(action.loading.get()).toBe(false);
		expect(action.error.get()).toBeUndefined();
	});

	it("tracks loading state", async () => {
		const action = cancellableAction(async (input: string) => {
			await new Promise((r) => setTimeout(r, 50));
			return input;
		});

		action.execute("test");
		expect(action.loading.get()).toBe(true);

		await new Promise((r) => setTimeout(r, 80));
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
		action.execute("second");

		await new Promise((r) => setTimeout(r, 150));

		// Only second should complete
		expect(calls).toEqual(["second"]);
		expect(action.data.get()).toBe("second");
	});

	it("handles errors", async () => {
		const action = cancellableAction(async () => {
			throw new Error("fail");
		});

		action.execute("test");
		await flush();
		expect(action.data.get()).toBeUndefined();
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
		action.execute(1);
		await flush();
		expect(action.runCount.get()).toBe(1);
		action.execute(2);
		await flush();
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

		action.execute(42);
		await new Promise((r) => setTimeout(r, 80));
		expect(action.data.get()).toBe(42);

		action.execute(99);
		expect(action.data.get()).toBeUndefined(); // cleared
		await new Promise((r) => setTimeout(r, 80));
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

		action.execute(42);
		await new Promise((r) => setTimeout(r, 80));
		expect(action.data.get()).toBe(42);

		action.execute(99);
		expect(action.data.get()).toBe(42); // preserved
		await new Promise((r) => setTimeout(r, 80));
		expect(action.data.get()).toBe(99);
	});

	it("waits for rateLimiter before executing", async () => {
		let time = 0;
		const rl = tokenBucket({ rate: 10, burst: 1, now: () => time });
		rl.tryAcquire(); // exhaust the single token

		const action = cancellableAction(async (n: number) => n * 2, { rateLimiter: rl });

		action.execute(5);
		expect(action.loading.get()).toBe(true);

		// Simulate time passing so token refills
		time = 100;
		// The rate limiter polls internally; wait for it to fire
		await new Promise((r) => setTimeout(r, 120));

		expect(action.data.get()).toBe(10);
		expect(action.loading.get()).toBe(false);
	});

	it("cancelling during rateLimiter wait aborts cleanly", async () => {
		const time = 0;
		const rl = tokenBucket({ rate: 1, burst: 1, now: () => time });
		rl.tryAcquire(); // exhaust

		const action = cancellableAction(async (n: number) => n, { rateLimiter: rl });

		action.execute(42);
		expect(action.loading.get()).toBe(true);

		// Cancel while waiting for rate limiter
		action.cancel();

		await flush();
		expect(action.data.get()).toBeUndefined();
		expect(action.loading.get()).toBe(false);
	});

	it("discards stale results from cancelled executions", async () => {
		const action = cancellableAction(async (n: number) => {
			await new Promise((r) => setTimeout(r, n * 10));
			return n;
		});

		// Start slow execution
		action.execute(10); // 100ms
		await new Promise((r) => setTimeout(r, 10));

		// Start fast execution (cancels slow one)
		action.execute(1); // 10ms

		await new Promise((r) => setTimeout(r, 150));
		expect(action.data.get()).toBe(1); // fast one wins
	});
});
