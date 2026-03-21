import { describe, expect, it } from "vitest";
import { effect } from "../../core/effect";
import { taskState } from "../../orchestrate/taskState";

describe("taskState", () => {
	// --- Initial state ---

	it("starts idle with zero runCount", () => {
		const task = taskState();
		expect(task.status.get()).toBe("idle");
		expect(task.runCount.get()).toBe(0);
		expect(task.result.get()).toBeUndefined();
		expect(task.error.get()).toBeUndefined();
		expect(task.lastRun.get()).toBeUndefined();
		expect(task.duration.get()).toBeUndefined();
		task.destroy();
	});

	it("get() returns composed TaskMeta", () => {
		const task = taskState();
		const meta = task.get();
		expect(meta.status).toBe("idle");
		expect(meta.runCount).toBe(0);
		expect(meta.result).toBeUndefined();
		expect(meta.error).toBeUndefined();
		task.destroy();
	});

	// --- Sync run ---

	it("tracks sync task success", async () => {
		const task = taskState<number>();
		const result = await task.run(() => 42);
		expect(result).toBe(42);
		expect(task.status.get()).toBe("success");
		expect(task.result.get()).toBe(42);
		expect(task.runCount.get()).toBe(1);
		expect(task.duration.get()).toBeGreaterThanOrEqual(0);
		expect(task.lastRun.get()).toBeGreaterThan(0);
		task.destroy();
	});

	it("tracks sync task error", async () => {
		const task = taskState<number>();
		const err = new Error("boom");
		await expect(
			task.run(() => {
				throw err;
			}),
		).rejects.toThrow("boom");
		expect(task.status.get()).toBe("error");
		expect(task.error.get()).toBe(err);
		expect(task.runCount.get()).toBe(1);
		task.destroy();
	});

	// --- Async run ---

	it("tracks async task success", async () => {
		const task = taskState<string>();
		const result = await task.run(async () => {
			return "done";
		});
		expect(result).toBe("done");
		expect(task.status.get()).toBe("success");
		expect(task.result.get()).toBe("done");
		task.destroy();
	});

	it("tracks async task error", async () => {
		const task = taskState<string>();
		await expect(
			task.run(async () => {
				throw new Error("async fail");
			}),
		).rejects.toThrow("async fail");
		expect(task.status.get()).toBe("error");
		expect(task.error.get()).toBeInstanceOf(Error);
		task.destroy();
	});

	// --- Running state ---

	it("transitions through running state", async () => {
		const task = taskState<number>();
		const statusLog: string[] = [];

		const dispose = effect([task.status], () => {
			statusLog.push(task.status.get());
			return undefined;
		});

		await task.run(() => 1);

		expect(statusLog).toContain("running");
		expect(statusLog).toContain("success");

		dispose();
		task.destroy();
	});

	it("rejects concurrent runs", async () => {
		const task = taskState<number>();
		let resolve: (v: number) => void;
		const p = task.run(
			() =>
				new Promise<number>((r) => {
					resolve = r;
				}),
		);

		await expect(task.run(() => 2)).rejects.toThrow("already running");

		resolve!(1);
		await p;
		task.destroy();
	});

	// --- Reset ---

	it("reset during in-flight run discards result (generation guard)", async () => {
		const task = taskState<number>();
		let resolve: (v: number) => void;
		const p = task.run(
			() =>
				new Promise<number>((r) => {
					resolve = r;
				}),
		);

		expect(task.status.get()).toBe("running");
		task.reset();
		expect(task.status.get()).toBe("idle");

		// Resolve the in-flight promise — should NOT overwrite the idle state
		resolve!(42);
		await p;
		expect(task.status.get()).toBe("idle");
		expect(task.runCount.get()).toBe(0);
		task.destroy();
	});

	it("reset returns to idle", async () => {
		const task = taskState<number>();
		await task.run(() => 42);
		expect(task.status.get()).toBe("success");

		task.reset();
		expect(task.status.get()).toBe("idle");
		expect(task.runCount.get()).toBe(0);
		expect(task.result.get()).toBeUndefined();
		task.destroy();
	});

	it("restart preserves runCount, result, lastRun but resets status", async () => {
		const task = taskState<number>();
		await task.run(() => 42);
		expect(task.status.get()).toBe("success");
		expect(task.runCount.get()).toBe(1);
		expect(task.result.get()).toBe(42);
		expect(task.lastRun.get()).toBeDefined();

		task.restart();
		expect(task.status.get()).toBe("idle");
		expect(task.error.get()).toBeUndefined();
		expect(task.duration.get()).toBeUndefined();
		// Preserved:
		expect(task.runCount.get()).toBe(1);
		expect(task.result.get()).toBe(42);
		expect(task.lastRun.get()).toBeDefined();
		task.destroy();
	});

	it("restart bumps generation (discards in-flight run)", async () => {
		const task = taskState<number>();
		let resolve!: (v: number) => void;
		const p = task.run(
			() =>
				new Promise<number>((r) => {
					resolve = r;
				}),
		);

		task.restart();
		resolve(99);
		await p;

		// Result should be discarded — status stays idle from restart
		expect(task.status.get()).toBe("idle");
		expect(task.runCount.get()).toBe(0); // preserved from before run (was 0)
		task.destroy();
	});

	// --- Multiple runs ---

	it("increments runCount across runs", async () => {
		const task = taskState<number>();
		await task.run(() => 1);
		expect(task.runCount.get()).toBe(1);

		await task.run(() => 2);
		expect(task.runCount.get()).toBe(2);
		expect(task.result.get()).toBe(2);
		task.destroy();
	});

	it("preserves previous result on error", async () => {
		const task = taskState<number>();
		await task.run(() => 42);

		await expect(
			task.run(() => {
				throw new Error("fail");
			}),
		).rejects.toThrow();
		expect(task.status.get()).toBe("error");
		expect(task.result.get()).toBe(42); // previous result preserved
		task.destroy();
	});

	// --- NodeV0 ---

	it("auto-generates id", () => {
		const task = taskState();
		expect(task.id).toMatch(/^task-/);
		task.destroy();
	});

	it("accepts custom id", () => {
		const task = taskState({ id: "my-task" });
		expect(task.id).toBe("my-task");
		task.destroy();
	});

	it("version increments on run completion", async () => {
		const task = taskState<number>();
		expect(task.version).toBe(0);

		await task.run(() => 1);
		expect(task.version).toBe(1);

		await expect(
			task.run(() => {
				throw new Error();
			}),
		).rejects.toThrow();
		expect(task.version).toBe(2);

		task.reset();
		expect(task.version).toBe(3);

		task.destroy();
	});

	// --- Snapshot ---

	it("snapshot returns serializable representation", async () => {
		const task = taskState<number>({ id: "snap-task" });
		await task.run(() => 99);

		const snap = task.snapshot();
		expect(snap.type).toBe("taskState");
		expect(snap.id).toBe("snap-task");
		expect(snap.meta.status).toBe("success");
		expect(snap.meta.result).toBe(99);

		const json = JSON.stringify(snap);
		const parsed = JSON.parse(json);
		expect(parsed.meta.result).toBe(99);

		task.destroy();
	});

	// --- from() ---

	it("from() restores from snapshot", async () => {
		const task1 = taskState<number>({ id: "t1" });
		await task1.run(() => 42);
		const snap = task1.snapshot();
		task1.destroy();

		const task2 = taskState.from(snap);
		expect(task2.id).toBe("t1");
		expect(task2.status.get()).toBe("success");
		expect(task2.result.get()).toBe(42);
		task2.destroy();
	});

	it("from() marks running tasks as errored", async () => {
		// Manually create a snapshot with running status
		const snap = {
			type: "taskState" as const,
			id: "t2",
			version: 1,
			meta: { status: "running" as const, runCount: 1, lastRun: Date.now() },
		};

		const task2 = taskState.from(snap);
		expect(task2.status.get()).toBe("error");
		expect(task2.error.get()).toBeInstanceOf(Error);
		task2.destroy();
	});

	// --- Lifecycle ---

	it("destroy prevents further runs", async () => {
		const task = taskState<number>();
		task.destroy();
		await expect(task.run(() => 1)).rejects.toThrow("destroyed");
	});

	it("destroy is idempotent", () => {
		const task = taskState();
		task.destroy();
		task.destroy(); // no throw
	});

	it("destroy during in-flight run discards status transition", async () => {
		const task = taskState<string>();
		let resolve: (v: string) => void;
		const p = task.run(() => new Promise<string>((r) => (resolve = r)));
		expect(task.status.get()).toBe("running");

		task.destroy();
		resolve!("done");
		const result = await p;

		// Result is returned but status was NOT updated (destroyed guard)
		expect(result).toBe("done");
		expect(task.status.get()).toBe("running"); // frozen — state store torn down
	});

	it("destroy during in-flight error discards error transition", async () => {
		const task = taskState<string>();
		let reject: (e: Error) => void;
		const p = task.run(() => new Promise<string>((_, r) => (reject = r)));
		expect(task.status.get()).toBe("running");

		task.destroy();
		reject!(new Error("boom"));
		await expect(p).rejects.toThrow("boom");

		// Error is re-thrown but status was NOT updated (destroyed guard)
		expect(task.status.get()).toBe("running"); // frozen
	});

	// --- Reactive ---

	it("effect fires on status transitions", async () => {
		const task = taskState<number>();
		const log: string[] = [];
		const dispose = effect([task.status], () => {
			log.push(task.status.get());
			return undefined;
		});

		await task.run(() => 123);
		expect(log).toContain("idle"); // initial
		expect(log).toContain("running");
		expect(log).toContain("success");

		dispose();
		task.destroy();
	});

	// --- Companion stores ---

	it("individual companion stores are independently subscribable", async () => {
		const task = taskState<number>();
		const statusLog: string[] = [];
		const errorLog: (unknown | undefined)[] = [];

		const d1 = effect([task.status], () => {
			statusLog.push(task.status.get());
			return undefined;
		});
		const d2 = effect([task.error], () => {
			errorLog.push(task.error.get());
			return undefined;
		});

		await task.run(() => 42);

		expect(statusLog).toContain("running");
		expect(statusLog).toContain("success");
		expect(errorLog).toContain(undefined);

		d1();
		d2();
		task.destroy();
	});
});
