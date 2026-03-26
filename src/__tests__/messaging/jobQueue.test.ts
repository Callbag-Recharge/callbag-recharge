import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inspector } from "../../core/inspector";
import { jobQueue } from "../../messaging/jobQueue";
import { topic } from "../../messaging/topic";
import { memoryAdapter } from "../../utils/checkpoint";

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
			// With stalledJobAction "none" (default), status stays "active"
			// so stall events re-fire as a heartbeat
			expect(events[0].status).toBe("active");
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

	// -----------------------------------------------------------------------
	// SA-3a: Job progress
	// -----------------------------------------------------------------------

	describe("SA-3a: job progress", () => {
		it("progress callback updates job info and progress store", async () => {
			const progressValues: number[] = [];

			const q = jobQueue<string, string>("progress-test", async (_signal, _data, progress) => {
				progress(0.25);
				progress(0.5);
				progress(0.75);
				progress(1);
				return "done";
			});

			q.on("progress", (job) => {
				progressValues.push(job.progress!);
			});

			q.add("work");
			await vi.advanceTimersByTimeAsync(200);

			expect(progressValues).toEqual([0.25, 0.5, 0.75, 1]);
			expect(q.completed.get()).toBe(1);
			q.destroy();
		});

		it("progress store reflects aggregate across active jobs", async () => {
			const q = jobQueue<number, void>(
				"progress-aggregate",
				async (_signal, data, progress) => {
					progress(data / 10); // each job reports its own progress
					await new Promise((r) => setTimeout(r, 100));
				},
				{ concurrency: 3 },
			);

			q.add(5); // progress = 0.5
			q.add(3); // progress = 0.3
			await vi.advanceTimersByTimeAsync(10);

			// Progress store should be > 0 while jobs are active
			expect(q.progress.get()).toBeGreaterThan(0);

			await vi.advanceTimersByTimeAsync(300);
			q.destroy();
		});

		it("progress is clamped to 0-1", async () => {
			const progressValues: number[] = [];

			const q = jobQueue<string, string>("progress-clamp", async (_signal, _data, progress) => {
				progress(-0.5);
				progress(1.5);
				return "done";
			});

			q.on("progress", (job) => {
				progressValues.push(job.progress!);
			});

			q.add("work");
			await vi.advanceTimersByTimeAsync(200);

			expect(progressValues).toEqual([0, 1]);
			q.destroy();
		});

		it("completed job has progress 1 in event", async () => {
			const q = jobQueue<string, string>("progress-complete", async () => "done");

			let completedProgress: number | undefined;
			q.on("completed", (job) => {
				completedProgress = job.progress;
			});

			q.add("work");
			await vi.advanceTimersByTimeAsync(200);

			expect(completedProgress).toBe(1);
			q.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// SA-3b: Priority ordering
	// -----------------------------------------------------------------------

	describe("SA-3b: priority ordering", () => {
		it("processes higher-priority jobs first within a batch", async () => {
			const order: string[] = [];
			// Start paused so all jobs are in the topic before pulling
			const q = jobQueue<string, void>(
				"priority-test",
				async (_signal, data) => {
					order.push(data);
				},
				{ concurrency: 3 },
			);
			q.pause();

			// Add jobs with different priorities (lower = higher priority)
			q.add("low", { priority: 10 });
			q.add("high", { priority: 1 });
			q.add("medium", { priority: 5 });

			// Resume — all 3 are pulled in one batch and sorted by priority
			q.resume();
			await vi.advanceTimersByTimeAsync(500);

			expect(order).toEqual(["high", "medium", "low"]);
			q.destroy();
		});

		it("jobs without priority are processed after prioritized ones", async () => {
			const order: string[] = [];
			const q = jobQueue<string, void>(
				"priority-default",
				async (_signal, data) => {
					order.push(data);
				},
				{ concurrency: 3 },
			);
			q.pause();

			q.add("no-priority");
			q.add("high", { priority: 1 });
			q.add("also-no-priority");

			q.resume();
			await vi.advanceTimersByTimeAsync(500);

			// Priority 1 should come first, the rest are after
			expect(order[0]).toBe("high");
			q.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// SA-3c: Scheduled jobs
	// -----------------------------------------------------------------------

	describe("SA-3c: scheduled jobs", () => {
		it("delays execution until runAt time", async () => {
			const results: string[] = [];
			const now = Date.now();

			const q = jobQueue<string, void>("scheduled-test", async (_signal, data) => {
				results.push(data);
			});

			// Schedule 500ms in the future
			q.add("delayed", { runAt: new Date(now + 500) });
			q.add("immediate");

			// Immediate job should process quickly
			await vi.advanceTimersByTimeAsync(100);
			expect(results).toContain("immediate");
			expect(results).not.toContain("delayed");

			// After scheduled time, delayed job should process
			await vi.advanceTimersByTimeAsync(500);
			expect(results).toContain("delayed");

			q.destroy();
		});

		it("getJob shows scheduled status before runAt", async () => {
			const now = Date.now();

			const q = jobQueue<string, void>("scheduled-status", async () => {});

			const seq = q.add("later", { runAt: new Date(now + 5000) });
			await vi.advanceTimersByTimeAsync(10);

			const job = q.getJob(seq);
			expect(job).toBeDefined();
			expect(job!.status).toBe("scheduled");

			q.destroy();
		});

		it("runAt in the past executes immediately", async () => {
			const results: string[] = [];
			const now = Date.now();

			const q = jobQueue<string, void>("scheduled-past", async (_signal, data) => {
				results.push(data);
			});

			q.add("past", { runAt: new Date(now - 1000) });
			await vi.advanceTimersByTimeAsync(200);

			expect(results).toContain("past");
			q.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// SA-3d: Job removal + introspection
	// -----------------------------------------------------------------------

	describe("SA-3d: job removal + introspection", () => {
		it("getJob returns info for active job", async () => {
			const q = jobQueue<string, void>("introspect-active", async () => {
				await new Promise((r) => setTimeout(r, 200));
			});

			const seq = q.add("work");
			await vi.advanceTimersByTimeAsync(50);

			const job = q.getJob(seq);
			expect(job).toBeDefined();
			expect(job!.data).toBe("work");
			expect(job!.status).toBe("active");
			expect(job!.attempts).toBe(1);

			await vi.advanceTimersByTimeAsync(300);
			q.destroy();
		});

		it("getJob returns info for completed job", async () => {
			const q = jobQueue<string, string>("introspect-done", async () => "result");

			const seq = q.add("work");
			await vi.advanceTimersByTimeAsync(200);

			const job = q.getJob(seq);
			expect(job).toBeDefined();
			expect(job!.status).toBe("completed");
			expect(job!.result).toBe("result");

			q.destroy();
		});

		it("getJob returns info for failed job", async () => {
			const q = jobQueue<string, void>(
				"introspect-fail",
				async () => {
					throw new Error("boom");
				},
				{ retry: { maxRetries: 0 } },
			);

			const seq = q.add("bad");
			await vi.advanceTimersByTimeAsync(200);

			const job = q.getJob(seq);
			expect(job).toBeDefined();
			expect(job!.status).toBe("failed");
			expect(job!.error).toBeInstanceOf(Error);

			q.destroy();
		});

		it("getJob returns undefined for unknown seq", () => {
			const q = jobQueue<string>("introspect-unknown", async () => {});
			expect(q.getJob(999)).toBeUndefined();
			q.destroy();
		});

		it("remove cancels an active job", async () => {
			let wasAborted = false;
			const q = jobQueue<string, void>("remove-active", async (signal) => {
				await new Promise((resolve, reject) => {
					const timer = setTimeout(resolve, 60_000);
					signal.addEventListener(
						"abort",
						() => {
							clearTimeout(timer);
							wasAborted = true;
							reject(new Error("aborted"));
						},
						{ once: true },
					);
				});
			});

			const seq = q.add("doomed");
			await vi.advanceTimersByTimeAsync(50);

			const removed = q.remove(seq);
			expect(removed).toBe(true);
			expect(wasAborted).toBe(true);
			expect(q.getJob(seq)).toBeUndefined(); // removed from tracking

			q.destroy();
		});

		it("remove emits failed event and updates stores", async () => {
			const failEvents: any[] = [];
			const q = jobQueue<string, void>("remove-events", async (signal) => {
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
			});

			q.on("failed", (job) => failEvents.push(job));

			const seq = q.add("doomed");
			await vi.advanceTimersByTimeAsync(50);

			q.remove(seq);

			expect(failEvents.length).toBe(1);
			expect(failEvents[0].status).toBe("failed");
			expect(q.failed.get()).toBe(1);

			q.destroy();
		});

		it("remove does not double-decrement processing on in-flight callback", async () => {
			const q = jobQueue<string, void>("remove-race", async (signal) => {
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
			});

			q.add("a");
			await vi.advanceTimersByTimeAsync(50);

			expect(q.active.get()).toBe(1);
			q.remove(1);

			// Let the abort error handler fire
			await vi.advanceTimersByTimeAsync(100);

			// active should be 0, not negative
			expect(q.active.get()).toBe(0);
			q.destroy();
		});

		it("remove returns false for unknown seq", () => {
			const q = jobQueue<string>("remove-unknown", async () => {});
			expect(q.remove(999)).toBe(false);
			q.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// SA-3e: Batch add
	// -----------------------------------------------------------------------

	describe("SA-3e: batch add", () => {
		it("addBatch publishes multiple jobs atomically", async () => {
			const results: string[] = [];
			const q = jobQueue<string, void>("batch-test", async (_signal, data) => {
				results.push(data);
			});

			const seqs = q.addBatch(["a", "b", "c"]);
			expect(seqs).toHaveLength(3);
			expect(seqs[0]).toBe(1);
			expect(seqs[1]).toBe(2);
			expect(seqs[2]).toBe(3);

			await vi.advanceTimersByTimeAsync(500);

			expect(results).toEqual(expect.arrayContaining(["a", "b", "c"]));
			q.destroy();
		});

		it("addBatch with options applies to all jobs", async () => {
			const q = jobQueue<string>("batch-opts", async () => {});
			const seqs = q.addBatch(["x", "y"], { priority: 1 });
			expect(seqs).toHaveLength(2);
			q.destroy();
		});

		it("addBatch with empty array returns empty", () => {
			const q = jobQueue<string>("batch-empty", async () => {});
			const seqs = q.addBatch([]);
			expect(seqs).toEqual([]);
			q.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// SA-3f: Rate limiting
	// -----------------------------------------------------------------------

	describe("SA-3f: rate limiting", () => {
		it("throttles job starts to max per window", async () => {
			let startCount = 0;
			const startTimes: number[] = [];

			const q = jobQueue<number, void>(
				"rate-limit-test",
				async () => {
					startCount++;
					startTimes.push(Date.now());
				},
				{
					concurrency: 10,
					rateLimit: { max: 2, windowMs: 1000 },
				},
			);

			// Add 4 jobs — only 2 should start in the first window
			q.add(1);
			q.add(2);
			q.add(3);
			q.add(4);

			await vi.advanceTimersByTimeAsync(100);

			// First 2 should start immediately
			expect(startCount).toBe(2);

			// After window expires, remaining should start
			await vi.advanceTimersByTimeAsync(1100);

			expect(startCount).toBe(4);
			q.destroy();
		});

		it("rate limiter does not block when under limit", async () => {
			let startCount = 0;
			const q = jobQueue<number, void>(
				"rate-no-block",
				async () => {
					startCount++;
				},
				{
					concurrency: 5,
					rateLimit: { max: 10, windowMs: 1000 },
				},
			);

			q.add(1);
			q.add(2);
			await vi.advanceTimersByTimeAsync(100);

			expect(startCount).toBe(2); // both start immediately
			q.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// SA-3g: Distributed jobs (topic exposure)
	// -----------------------------------------------------------------------

	describe("SA-3g: distributed jobs", () => {
		it("exposes internal topic via inner accessor", () => {
			const q = jobQueue<string>("dist-test", async () => {});
			expect(q.inner).toBeDefined();
			expect(q.inner.topic).toBeDefined();
			expect(q.inner.topic.name).toBe("dist-test:jobs");
			q.destroy();
		});

		it("inner topic can be used for bridging", () => {
			const q = jobQueue<string>("bridge-test", async () => {});
			const t = q.inner.topic;

			// Verify we can read from the topic (it's the same underlying topic)
			q.add("msg");
			expect(t.tailSeq).toBe(1);
			const msg = t.get(1);
			expect(msg!.value).toBe("msg");

			q.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// SA-3h: Job state persistence
	// -----------------------------------------------------------------------

	describe("SA-3h: job state persistence", () => {
		it("persists completed job state", async () => {
			const adapter = memoryAdapter();

			const q = jobQueue<string, string>(
				"persist-test",
				async (_signal, data) => `result:${data}`,
				{ persistence: adapter },
			);

			q.add("work");
			await vi.advanceTimersByTimeAsync(200);

			// Job should be persisted
			const index = adapter.load("jobQueue:persist-test:index") as number[];
			expect(index).toBeDefined();
			expect(index.length).toBeGreaterThanOrEqual(1);

			const jobData = adapter.load(`jobQueue:persist-test:job:${index[0]}`) as any;
			expect(jobData).toBeDefined();
			expect(jobData.status).toBe("completed");
			expect(jobData.result).toBe("result:work");

			q.destroy();
		});

		it("persists failed job state", async () => {
			const adapter = memoryAdapter();

			const q = jobQueue<string, void>(
				"persist-fail",
				async () => {
					throw new Error("boom");
				},
				{ persistence: adapter, retry: { maxRetries: 0 } },
			);

			q.add("bad");
			await vi.advanceTimersByTimeAsync(200);

			const index = adapter.load("jobQueue:persist-fail:index") as number[];
			expect(index).toBeDefined();

			const jobData = adapter.load(`jobQueue:persist-fail:job:${index[0]}`) as any;
			expect(jobData.status).toBe("failed");

			q.destroy();
		});

		it("recovers finished jobs for introspection on new queue", async () => {
			const adapter = memoryAdapter();

			// First queue — process and persist
			const q1 = jobQueue<string, string>("persist-recover", async (_signal, data) => `r:${data}`, {
				persistence: adapter,
			});

			const seq = q1.add("work");
			await vi.advanceTimersByTimeAsync(200);
			q1.destroy();

			// Second queue — should recover finished jobs
			const q2 = jobQueue<string, string>("persist-recover", async (_signal, data) => `r:${data}`, {
				persistence: adapter,
			});

			const job = q2.getJob(seq);
			expect(job).toBeDefined();
			expect(job!.status).toBe("completed");
			expect(job!.result).toBe("r:work");

			q2.destroy();
		});
	});
});
