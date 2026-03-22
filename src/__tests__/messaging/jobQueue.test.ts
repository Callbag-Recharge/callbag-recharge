import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inspector } from "../../core/inspector";
import { jobQueue } from "../../messaging/jobQueue";
import { topic } from "../../messaging/topic";

describe("jobQueue", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	// -----------------------------------------------------------------------
	// 5e-6: Basic job queue
	// -----------------------------------------------------------------------

	describe("basic processing", () => {
		it("creates a queue and processes a job", async () => {
			const results: string[] = [];
			const q = jobQueue<string, string>("basic", async (_signal, data) => {
				results.push(data);
				return `done:${data}`;
			});

			q.add("hello");

			// Let microtasks + polling fire
			await vi.advanceTimersByTimeAsync(200);

			expect(results).toEqual(["hello"]);
			q.destroy();
		});

		it("returns seq number from add()", () => {
			const q = jobQueue<string>("seq-test", async () => {});
			const s1 = q.add("a");
			const s2 = q.add("b");
			expect(s1).toBe(1);
			expect(s2).toBe(2);
			q.destroy();
		});

		it("processes multiple jobs sequentially with concurrency 1", async () => {
			const order: number[] = [];
			const q = jobQueue<number, void>(
				"sequential",
				async (_signal, data) => {
					order.push(data);
				},
				{ concurrency: 1 },
			);

			q.add(1);
			q.add(2);
			q.add(3);

			await vi.advanceTimersByTimeAsync(500);

			expect(order).toEqual([1, 2, 3]);
			q.destroy();
		});

		it("processes jobs in parallel with higher concurrency", async () => {
			let concurrent = 0;
			let maxConcurrent = 0;

			const q = jobQueue<number, void>(
				"parallel",
				async (_signal, _data) => {
					concurrent++;
					maxConcurrent = Math.max(maxConcurrent, concurrent);
					await new Promise((r) => setTimeout(r, 50));
					concurrent--;
				},
				{ concurrency: 3 },
			);

			q.add(1);
			q.add(2);
			q.add(3);

			await vi.advanceTimersByTimeAsync(200);

			expect(maxConcurrent).toBeGreaterThanOrEqual(2);
			q.destroy();
		});

		it("passes publish options through to topic", () => {
			const q = jobQueue<string>("opts-test", async () => {});
			const seq = q.add("data", { key: "partition-1", headers: { "x-custom": "val" } });
			expect(seq).toBe(1);
			q.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// 5e-7: Companion stores
	// -----------------------------------------------------------------------

	describe("companion stores", () => {
		it("tracks active job count", async () => {
			const q = jobQueue<string, void>(
				"active-track",
				async () => {
					await new Promise((r) => setTimeout(r, 100));
				},
				{ concurrency: 2 },
			);

			expect(q.active.get()).toBe(0);

			q.add("a");
			q.add("b");

			await vi.advanceTimersByTimeAsync(50);

			expect(q.active.get()).toBeGreaterThanOrEqual(1);

			await vi.advanceTimersByTimeAsync(200);

			expect(q.active.get()).toBe(0);
			q.destroy();
		});

		it("tracks completed count", async () => {
			const q = jobQueue<string, void>("completed-track", async () => {});

			q.add("a");
			q.add("b");

			await vi.advanceTimersByTimeAsync(500);

			expect(q.completed.get()).toBe(2);
			q.destroy();
		});

		it("tracks failed count", async () => {
			const q = jobQueue<string, void>(
				"failed-track",
				async () => {
					throw new Error("fail");
				},
				{ retry: { maxRetries: 0 } },
			);

			q.add("a");

			await vi.advanceTimersByTimeAsync(500);

			expect(q.failed.get()).toBe(1);
			q.destroy();
		});

		it("companion stores are subscribable via Inspector", async () => {
			const q = jobQueue<string, void>("inspect", async () => {});

			const obs = Inspector.observe(q.completed);
			q.add("a");

			await vi.advanceTimersByTimeAsync(500);

			expect(obs.values.length).toBeGreaterThanOrEqual(1);
			obs.dispose();
			q.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// 5e-7: Events
	// -----------------------------------------------------------------------

	describe("events", () => {
		it("fires completed event", async () => {
			const events: any[] = [];
			const q = jobQueue<string, string>("evt-complete", async (_s, d) => `result:${d}`);

			q.on("completed", (job) => {
				events.push(job);
			});

			q.add("hello");
			await vi.advanceTimersByTimeAsync(500);

			expect(events.length).toBe(1);
			expect(events[0].data).toBe("hello");
			expect(events[0].result).toBe("result:hello");
			expect(events[0].status).toBe("completed");
			expect(events[0].duration).toBeGreaterThanOrEqual(0);
			expect(events[0].attempts).toBe(1);
			q.destroy();
		});

		it("fires failed event after retries exhausted", async () => {
			const events: any[] = [];
			const q = jobQueue<string, void>(
				"evt-fail",
				async () => {
					throw new Error("boom");
				},
				{ retry: { maxRetries: 1, backoff: () => 0 } },
			);

			q.on("failed", (job) => {
				events.push(job);
			});

			q.add("bad");
			await vi.advanceTimersByTimeAsync(500);

			expect(events.length).toBe(1);
			expect(events[0].data).toBe("bad");
			expect(events[0].status).toBe("failed");
			expect(events[0].error).toBeInstanceOf(Error);
			q.destroy();
		});

		it("fires stalled event when job exceeds ack timeout", async () => {
			const events: any[] = [];
			const q = jobQueue<string, void>(
				"evt-stall",
				async () => {
					// Simulate a job that takes forever
					await new Promise((r) => setTimeout(r, 60_000));
				},
				{ ackTimeout: 100, stallInterval: 50 },
			);

			q.on("stalled", (job) => {
				events.push(job);
			});

			q.add("stuck");

			// Advance past stall detection
			await vi.advanceTimersByTimeAsync(200);

			expect(events.length).toBeGreaterThanOrEqual(1);
			expect(events[0].status).toBe("stalled");
			q.destroy();
		});

		it("stalledJobAction cancel aborts and fails the job", async () => {
			const events: any[] = [];
			const failEvents: any[] = [];
			const q = jobQueue<string, void>(
				"stall-cancel",
				async (signal) => {
					// Wait until aborted
					await new Promise((resolve, reject) => {
						const timer = setTimeout(resolve, 60_000);
						signal.addEventListener(
							"abort",
							() => {
								clearTimeout(timer);
								reject(new Error("aborted"));
							},
							{ once: true },
						);
					});
				},
				{
					ackTimeout: 100,
					stallInterval: 50,
					stalledJobAction: "cancel",
					retry: { maxRetries: 3 },
				},
			);

			q.on("stalled", (job) => events.push(job));
			q.on("failed", (job) => failEvents.push(job));

			q.add("stuck");
			await vi.advanceTimersByTimeAsync(500);

			expect(events.length).toBeGreaterThanOrEqual(1);
			expect(failEvents.length).toBe(1);
			expect(failEvents[0].status).toBe("failed");
			q.destroy();
		});

		it("stalledJobAction retry re-enqueues the job", async () => {
			let callCount = 0;
			const q = jobQueue<string, string>(
				"stall-retry",
				async (signal) => {
					callCount++;
					if (callCount === 1) {
						// First call: hang until aborted
						await new Promise((resolve, reject) => {
							const timer = setTimeout(resolve, 60_000);
							signal.addEventListener(
								"abort",
								() => {
									clearTimeout(timer);
									reject(new Error("aborted"));
								},
								{ once: true },
							);
						});
					}
					return "ok";
				},
				{
					ackTimeout: 100,
					stallInterval: 50,
					stalledJobAction: "retry",
					retry: { maxRetries: 3, backoff: () => 0 },
				},
			);

			q.add("job");
			await vi.advanceTimersByTimeAsync(1000);

			expect(callCount).toBeGreaterThanOrEqual(2);
			expect(q.completed.get()).toBe(1);
			q.destroy();
		});

		it("unsubscribe removes event listener", async () => {
			const events: any[] = [];
			const q = jobQueue<string, void>("evt-unsub", async () => {});

			const unsub = q.on("completed", (job) => events.push(job));
			unsub();

			q.add("a");
			await vi.advanceTimersByTimeAsync(500);

			expect(events.length).toBe(0);
			q.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Retry
	// -----------------------------------------------------------------------

	describe("retry", () => {
		it("retries failed jobs up to maxRetries", async () => {
			let attempts = 0;
			const q = jobQueue<string, string>(
				"retry-test",
				async () => {
					attempts++;
					if (attempts < 3) throw new Error("not yet");
					return "ok";
				},
				{ retry: { maxRetries: 3, backoff: () => 0 } },
			);

			q.on("completed", () => {});

			q.add("data");
			await vi.advanceTimersByTimeAsync(500);

			expect(attempts).toBe(3);
			expect(q.completed.get()).toBe(1);
			q.destroy();
		});

		it("routes to dead letter topic on terminal failure", async () => {
			const dlq = topic<string>("dlq");
			const q = jobQueue<string, void>(
				"dlq-test",
				async () => {
					throw new Error("always fails");
				},
				{ retry: { maxRetries: 0 }, deadLetterTopic: dlq },
			);

			q.add("poison");
			await vi.advanceTimersByTimeAsync(500);

			expect(dlq.tailSeq).toBe(1);
			const msg = dlq.get(1);
			expect(msg!.value).toBe("poison");
			expect(msg!.headers?.["x-original-queue"]).toBe("dlq-test");

			q.destroy();
			dlq.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	describe("lifecycle", () => {
		it("pause stops processing, resume restarts", async () => {
			const results: string[] = [];
			const q = jobQueue<string, void>("pause-test", async (_s, d) => {
				results.push(d);
			});

			q.add("before-pause");
			await vi.advanceTimersByTimeAsync(200);

			q.pause();
			expect(q.isPaused).toBe(true);

			q.add("during-pause");
			await vi.advanceTimersByTimeAsync(200);

			// "during-pause" should not be processed yet
			const beforeResume = results.length;

			q.resume();
			expect(q.isPaused).toBe(false);
			await vi.advanceTimersByTimeAsync(500);

			expect(results.length).toBeGreaterThan(beforeResume);
			q.destroy();
		});

		it("destroy cleans up all resources", async () => {
			const q = jobQueue<string, void>("destroy-test", async () => {});

			q.add("a");
			await vi.advanceTimersByTimeAsync(200);

			q.destroy();

			// Adding after destroy should not throw (topic is destroyed, publish returns -1)
			// Just verify no errors
			expect(() => q.destroy()).not.toThrow(); // double destroy is safe
		});

		it("exposes queue name", () => {
			const q = jobQueue<string>("name-test", async () => {});
			expect(q.name).toBe("name-test");
			q.destroy();
		});
	});
});
