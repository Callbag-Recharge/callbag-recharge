import { describe, expect, it } from "vitest";
import { effect } from "../../core/effect";
import { taskState } from "../../orchestrate/taskState";

/** Flush microtasks so rawFromPromise callbacks fire */
const flush = () => new Promise((r) => setTimeout(r, 0));

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

	it("tracks sync task success", () => {
		const task = taskState<number>();
		task.run(() => 42);
		// Sync tasks complete synchronously via rawFromAny plain-value path
		expect(task.status.get()).toBe("success");
		expect(task.result.get()).toBe(42);
		expect(task.runCount.get()).toBe(1);
		expect(task.duration.get()).toBeGreaterThanOrEqual(0);
		expect(task.lastRun.get()).toBeGreaterThan(0);
		task.destroy();
	});

	it("tracks sync task error", () => {
		const task = taskState<number>();
		const err = new Error("boom");
		task.run(() => {
			throw err;
		});
		expect(task.status.get()).toBe("error");
		expect(task.error.get()).toBe(err);
		expect(task.runCount.get()).toBe(1);
		task.destroy();
	});

	// --- Async run ---

	it("tracks async task success", async () => {
		const task = taskState<string>();
		task.run(async () => {
			return "done";
		});
		await flush();
		expect(task.status.get()).toBe("success");
		expect(task.result.get()).toBe("done");
		task.destroy();
	});

	it("tracks async task error", async () => {
		const task = taskState<string>();
		task.run(async () => {
			throw new Error("async fail");
		});
		await flush();
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

		task.run(() => 1);

		expect(statusLog).toContain("running");
		expect(statusLog).toContain("success");

		dispose();
		task.destroy();
	});

	it("rejects concurrent runs", async () => {
		const task = taskState<number>();
		let resolve: (v: number) => void;
		task.run(
			() =>
				new Promise<number>((r) => {
					resolve = r;
				}),
		);

		expect(() => task.run(() => 2)).toThrow("already running");

		resolve!(1);
		await flush();
		task.destroy();
	});

	// --- Reset ---

	it("reset during in-flight run discards result (generation guard)", async () => {
		const task = taskState<number>();
		let resolve: (v: number) => void;
		task.run(
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
		await flush();
		expect(task.status.get()).toBe("idle");
		expect(task.runCount.get()).toBe(0);
		task.destroy();
	});

	it("reset returns to idle", () => {
		const task = taskState<number>();
		task.run(() => 42);
		expect(task.status.get()).toBe("success");

		task.reset();
		expect(task.status.get()).toBe("idle");
		expect(task.runCount.get()).toBe(0);
		expect(task.result.get()).toBeUndefined();
		task.destroy();
	});

	it("restart preserves runCount, result, lastRun but resets status", () => {
		const task = taskState<number>();
		task.run(() => 42);
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
		task.run(
			() =>
				new Promise<number>((r) => {
					resolve = r;
				}),
		);

		task.restart();
		resolve(99);
		await flush();

		// Result should be discarded — status stays idle from restart
		expect(task.status.get()).toBe("idle");
		expect(task.runCount.get()).toBe(0); // preserved from before run (was 0)
		task.destroy();
	});

	// --- Multiple runs ---

	it("increments runCount across runs", () => {
		const task = taskState<number>();
		task.run(() => 1);
		expect(task.runCount.get()).toBe(1);

		task.run(() => 2);
		expect(task.runCount.get()).toBe(2);
		expect(task.result.get()).toBe(2);
		task.destroy();
	});

	it("preserves previous result on error", () => {
		const task = taskState<number>();
		task.run(() => 42);

		task.run(() => {
			throw new Error("fail");
		});
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

	it("version increments on run completion", () => {
		const task = taskState<number>();
		expect(task.version).toBe(0);

		task.run(() => 1);
		expect(task.version).toBe(1);

		task.run(() => {
			throw new Error();
		});
		expect(task.version).toBe(2);

		task.reset();
		expect(task.version).toBe(3);

		task.destroy();
	});

	// --- Snapshot ---

	it("snapshot returns serializable representation", () => {
		const task = taskState<number>({ id: "snap-task" });
		task.run(() => 99);

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

	it("from() restores from snapshot", () => {
		const task1 = taskState<number>({ id: "t1" });
		task1.run(() => 42);
		const snap = task1.snapshot();
		task1.destroy();

		const task2 = taskState.from(snap);
		expect(task2.id).toBe("t1");
		expect(task2.status.get()).toBe("success");
		expect(task2.result.get()).toBe(42);
		task2.destroy();
	});

	it("from() marks running tasks as errored", () => {
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

	it("destroy prevents further runs", () => {
		const task = taskState<number>();
		task.destroy();
		expect(() => task.run(() => 1)).toThrow("destroyed");
	});

	it("destroy is idempotent", () => {
		const task = taskState();
		task.destroy();
		task.destroy(); // no throw
	});

	it("destroy during in-flight run discards status transition", async () => {
		const task = taskState<string>();
		let resolve: (v: string) => void;
		task.run(() => new Promise<string>((r) => (resolve = r)));
		expect(task.status.get()).toBe("running");

		task.destroy();
		resolve!("done");
		await flush();

		// Status was NOT updated (destroyed guard) — frozen at running
		expect(task.status.get()).toBe("running");
	});

	it("destroy during in-flight error discards error transition", async () => {
		const task = taskState<string>();
		let reject: (e: Error) => void;
		task.run(() => new Promise<string>((_, r) => (reject = r)));
		expect(task.status.get()).toBe("running");

		task.destroy();
		reject!(new Error("boom"));
		await flush();

		// Error is discarded — status was NOT updated (destroyed guard)
		expect(task.status.get()).toBe("running"); // frozen
	});

	// --- Reactive ---

	it("effect fires on status transitions", () => {
		const task = taskState<number>();
		const log: string[] = [];
		const dispose = effect([task.status], () => {
			log.push(task.status.get());
			return undefined;
		});

		task.run(() => 123);
		expect(log).toContain("idle"); // initial
		expect(log).toContain("running");
		expect(log).toContain("success");

		dispose();
		task.destroy();
	});

	// --- AbortController ---

	it("run() passes AbortSignal to fn", () => {
		const task = taskState<string>();
		let receivedSignal: AbortSignal | undefined;
		task.run((signal) => {
			receivedSignal = signal;
			return "ok";
		});
		expect(receivedSignal).toBeInstanceOf(AbortSignal);
		expect(receivedSignal!.aborted).toBe(false);
		task.destroy();
	});

	it("reset() aborts in-flight task", async () => {
		const task = taskState<string>();
		let receivedSignal: AbortSignal | undefined;
		let resolve: (v: string) => void;
		task.run((signal) => {
			receivedSignal = signal;
			return new Promise<string>((r) => {
				resolve = r;
			});
		});

		expect(receivedSignal!.aborted).toBe(false);
		task.reset();
		expect(receivedSignal!.aborted).toBe(true);

		resolve!("ignored");
		await flush();
		expect(task.status.get()).toBe("idle");
		task.destroy();
	});

	it("restart() aborts in-flight task", async () => {
		const task = taskState<string>();
		let receivedSignal: AbortSignal | undefined;
		let resolve: (v: string) => void;
		task.run((signal) => {
			receivedSignal = signal;
			return new Promise<string>((r) => {
				resolve = r;
			});
		});

		expect(receivedSignal!.aborted).toBe(false);
		task.restart();
		expect(receivedSignal!.aborted).toBe(true);

		resolve!("ignored");
		await flush();
		expect(task.status.get()).toBe("idle");
		task.destroy();
	});

	it("destroy() aborts in-flight task", async () => {
		const task = taskState<string>();
		let receivedSignal: AbortSignal | undefined;
		let resolve: (v: string) => void;
		task.run((signal) => {
			receivedSignal = signal;
			return new Promise<string>((r) => {
				resolve = r;
			});
		});

		expect(receivedSignal!.aborted).toBe(false);
		task.destroy();
		expect(receivedSignal!.aborted).toBe(true);

		resolve!("ignored");
		await flush();
	});

	it("signal is not aborted on successful completion", () => {
		const task = taskState<number>();
		let receivedSignal: AbortSignal | undefined;
		task.run((signal) => {
			receivedSignal = signal;
			return 42;
		});
		expect(receivedSignal!.aborted).toBe(false);
		task.destroy();
	});

	it("signal is not aborted on error completion", () => {
		const task = taskState<number>();
		let receivedSignal: AbortSignal | undefined;
		task.run((signal) => {
			receivedSignal = signal;
			throw new Error("fail");
		});
		expect(receivedSignal!.aborted).toBe(false);
		task.destroy();
	});

	it("each run gets a fresh AbortSignal", () => {
		const task = taskState<number>();
		const signals: AbortSignal[] = [];

		task.run((signal) => {
			signals.push(signal);
			return 1;
		});
		task.run((signal) => {
			signals.push(signal);
			return 2;
		});

		expect(signals).toHaveLength(2);
		expect(signals[0]).not.toBe(signals[1]);
		expect(signals[0].aborted).toBe(false);
		expect(signals[1].aborted).toBe(false);
		task.destroy();
	});

	it("fn can use signal to abort fetch-like operations", async () => {
		const task = taskState<string>();
		let abortReason: any;

		task.run((signal) => {
			return new Promise<string>((_, reject) => {
				signal.addEventListener("abort", () => {
					abortReason = signal.reason;
					reject(new DOMException("Aborted", "AbortError"));
				});
			});
		});

		task.reset();
		expect(abortReason).toBeDefined();

		await flush();
		expect(task.status.get()).toBe("idle"); // reset state persists
		task.destroy();
	});

	// --- Companion stores ---

	it("individual companion stores are independently subscribable", () => {
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

		task.run(() => 42);

		expect(statusLog).toContain("running");
		expect(statusLog).toContain("success");
		expect(errorLog).toContain(undefined);

		d1();
		d2();
		task.destroy();
	});
});
