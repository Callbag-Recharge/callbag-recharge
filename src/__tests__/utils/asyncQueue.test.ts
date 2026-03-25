import { describe, expect, it } from "vitest";
import { firstValueFrom } from "../../raw/firstValueFrom";
import { rawSubscribe } from "../../raw/subscribe";
import { asyncQueue } from "../../utils/asyncQueue";

/** Helper: subscribe to a callbag source and return a Promise of the first value. */
function toPromise<T>(source: (type: number, payload?: any) => void): Promise<T> {
	return firstValueFrom<T>(source);
}

describe("asyncQueue", () => {
	// -----------------------------------------------------------------------
	// Basic operation
	// -----------------------------------------------------------------------
	describe("basic operation", () => {
		it("processes a single task", async () => {
			const q = asyncQueue(async (n: number) => n * 2);

			const result = await toPromise<number>(q.enqueue(5));
			expect(result).toBe(10);
			expect(q.completed.get()).toBe(1);
			expect(q.failed.get()).toBe(0);
			expect(q.running.get()).toBe(0);
		});

		it("returns task result via callbag source", async () => {
			const q = asyncQueue(async (s: string) => s.toUpperCase());

			const result = await toPromise<string>(q.enqueue("hello"));
			expect(result).toBe("HELLO");
		});

		it("errors on task failure", async () => {
			const q = asyncQueue(async () => {
				throw new Error("task failed");
			});

			await expect(toPromise(q.enqueue(null))).rejects.toThrow("task failed");
			expect(q.completed.get()).toBe(0);
			expect(q.failed.get()).toBe(1);
		});
	});

	// -----------------------------------------------------------------------
	// Concurrency
	// -----------------------------------------------------------------------
	describe("concurrency", () => {
		it("defaults to concurrency 1 (sequential)", async () => {
			const order: string[] = [];
			const q = asyncQueue(async (label: string) => {
				order.push(`start:${label}`);
				await new Promise((r) => setTimeout(r, 10));
				order.push(`end:${label}`);
				return label;
			});

			const p1 = toPromise(q.enqueue("a"));
			const p2 = toPromise(q.enqueue("b"));

			expect(q.running.get()).toBe(1);
			expect(q.size.get()).toBe(1); // 'b' is queued

			await Promise.all([p1, p2]);

			expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
		});

		it("respects concurrency limit", async () => {
			let maxConcurrent = 0;
			let current = 0;

			const q = asyncQueue(
				async (n: number) => {
					current++;
					maxConcurrent = Math.max(maxConcurrent, current);
					await new Promise((r) => setTimeout(r, 10));
					current--;
					return n;
				},
				{ concurrency: 3 },
			);

			const promises = Array.from({ length: 6 }, (_, i) => toPromise(q.enqueue(i)));
			await Promise.all(promises);

			expect(maxConcurrent).toBe(3);
			expect(q.completed.get()).toBe(6);
		});

		it("fills slots as tasks complete", async () => {
			const q = asyncQueue(
				async (n: number) => {
					await new Promise((r) => setTimeout(r, n));
					return n;
				},
				{ concurrency: 2 },
			);

			const p1 = toPromise(q.enqueue(10)); // finishes first
			const p2 = toPromise(q.enqueue(50));
			const p3 = toPromise(q.enqueue(10)); // starts when p1 finishes

			expect(q.running.get()).toBe(2);
			expect(q.size.get()).toBe(1);

			await p1;
			// p3 should now be running
			expect(q.running.get()).toBe(2); // p2 + p3

			await Promise.all([p2, p3]);
			expect(q.running.get()).toBe(0);
		});

		it("clamps concurrency below 1 to 1", async () => {
			const q = asyncQueue(async (n: number) => n, { concurrency: 0 });
			const result = await toPromise<number>(q.enqueue(42));
			expect(result).toBe(42);
			expect(q.completed.get()).toBe(1);
		});

		it("clamps negative concurrency to 1", async () => {
			const q = asyncQueue(async (n: number) => n, { concurrency: -5 });
			const result = await toPromise<number>(q.enqueue(7));
			expect(result).toBe(7);
		});
	});

	// -----------------------------------------------------------------------
	// LIFO strategy
	// -----------------------------------------------------------------------
	describe("lifo strategy", () => {
		it("processes latest task first", async () => {
			const order: number[] = [];
			const q = asyncQueue(
				async (n: number) => {
					order.push(n);
					return n;
				},
				{ concurrency: 1, strategy: "lifo" },
			);

			// First enqueue starts immediately (concurrency=1)
			const p1 = toPromise(q.enqueue(1));
			// These queue up
			const p2 = toPromise(q.enqueue(2));
			const p3 = toPromise(q.enqueue(3));

			await Promise.all([p1, p2, p3]);

			// 1 runs first (immediately), then 3 (lifo), then 2
			expect(order).toEqual([1, 3, 2]);
		});
	});

	// -----------------------------------------------------------------------
	// Synchronous throw
	// -----------------------------------------------------------------------
	describe("synchronous throw", () => {
		it("handles fn() that throws synchronously", async () => {
			let callCount = 0;
			const q = asyncQueue((n: number) => {
				callCount++;
				if (n === 1) throw new Error("sync boom");
				return Promise.resolve(n * 2);
			});

			await expect(toPromise(q.enqueue(1))).rejects.toThrow("sync boom");
			expect(q.failed.get()).toBe(1);
			expect(q.completed.get()).toBe(0);

			// Queue should still be functional
			const result = await toPromise<number>(q.enqueue(2));
			expect(result).toBe(4);
			expect(q.completed.get()).toBe(1);
			expect(q.failed.get()).toBe(1);
			expect(callCount).toBe(2);
		});
	});

	// -----------------------------------------------------------------------
	// Pause / Resume
	// -----------------------------------------------------------------------
	describe("pause / resume", () => {
		it("pauses processing", async () => {
			const q = asyncQueue(async (n: number) => n);

			q.pause();
			expect(q.paused.get()).toBe(true);

			const p = toPromise<number>(q.enqueue(1));
			expect(q.size.get()).toBe(1);
			expect(q.running.get()).toBe(0);

			q.resume();
			expect(q.paused.get()).toBe(false);

			const result = await p;
			expect(result).toBe(1);
		});

		it("in-flight tasks continue when paused", async () => {
			let resolve: () => void;
			const q = asyncQueue(async () => {
				await new Promise<void>((r) => {
					resolve = r;
				});
				return "done";
			});

			const p = toPromise<string>(q.enqueue(null));
			expect(q.running.get()).toBe(1);

			q.pause();
			resolve!();
			const result = await p;

			expect(result).toBe("done");
			expect(q.running.get()).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// Clear
	// -----------------------------------------------------------------------
	describe("clear", () => {
		it("clears pending tasks and errors their sources", async () => {
			const q = asyncQueue(
				async (n: number) => {
					await new Promise((r) => setTimeout(r, 50));
					return n;
				},
				{ concurrency: 1 },
			);

			const p1 = toPromise<number>(q.enqueue(1)); // running
			const p2 = toPromise(q.enqueue(2)); // pending
			const p3 = toPromise(q.enqueue(3)); // pending

			q.clear();

			expect(q.size.get()).toBe(0);

			await expect(p2).rejects.toThrow("Queue cleared");
			await expect(p3).rejects.toThrow("Queue cleared");

			// p1 is still running and should complete
			const result = await p1;
			expect(result).toBe(1);
		});
	});

	// -----------------------------------------------------------------------
	// Dispose
	// -----------------------------------------------------------------------
	describe("dispose", () => {
		it("errors new enqueues after dispose", async () => {
			const q = asyncQueue(async (n: number) => n);
			q.dispose();

			await expect(toPromise(q.enqueue(1))).rejects.toThrow("Queue is disposed");
		});

		it("clears pending tasks on dispose", async () => {
			const q = asyncQueue(
				async (n: number) => {
					await new Promise((r) => setTimeout(r, 50));
					return n;
				},
				{ concurrency: 1 },
			);

			toPromise(q.enqueue(1)); // running
			const p2 = toPromise(q.enqueue(2)); // pending

			q.dispose();

			await expect(p2).rejects.toThrow("Queue cleared");
		});

		it("in-flight tasks do not write to stores after dispose", async () => {
			let resolve: (v: string) => void;
			const q = asyncQueue(async () => {
				return new Promise<string>((r) => {
					resolve = r;
				});
			});

			rawSubscribe(q.enqueue(null), () => {}); // starts running
			expect(q.running.get()).toBe(1);

			q.dispose();

			// Complete the in-flight task after dispose
			resolve!("late");

			// Let the microtask settle
			await new Promise((r) => setTimeout(r, 10));

			// Stores should not have been updated by the late completion
			// running still shows 1 because dispose didn't decrement it
			// (the task completion was silently ignored)
			expect(q.completed.get()).toBe(0);
		});

		it("dispose is idempotent", () => {
			const q = asyncQueue(async (n: number) => n);
			q.dispose();
			q.dispose(); // no error
		});
	});

	// -----------------------------------------------------------------------
	// Callbag cancellation
	// -----------------------------------------------------------------------
	describe("callbag cancellation", () => {
		it("unsubscribing before task completes suppresses result", async () => {
			let resolve: (v: string) => void;
			const q = asyncQueue(async () => {
				return new Promise<string>((r) => {
					resolve = r;
				});
			});

			const values: string[] = [];
			const sub = rawSubscribe(q.enqueue(null), (v: string) => values.push(v));

			// Cancel before task finishes
			sub.unsubscribe();

			// Complete the task after cancel
			resolve!("late");
			await new Promise((r) => setTimeout(r, 10));

			// Value should NOT have been delivered
			expect(values).toEqual([]);
			// But the task still completed internally
			expect(q.completed.get()).toBe(1);
		});

		it("unsubscribing does not affect other enqueued tasks", async () => {
			const q = asyncQueue(
				async (n: number) => {
					await new Promise((r) => setTimeout(r, 10));
					return n * 2;
				},
				{ concurrency: 2 },
			);

			const values1: number[] = [];
			const sub1 = rawSubscribe(q.enqueue(1), (v: number) => values1.push(v));
			const p2 = toPromise<number>(q.enqueue(2));

			// Cancel first task's subscription
			sub1.unsubscribe();

			// Second task should still complete
			const result2 = await p2;
			expect(result2).toBe(4);
			expect(values1).toEqual([]); // cancelled
		});
	});

	// -----------------------------------------------------------------------
	// Reactive stores
	// -----------------------------------------------------------------------
	describe("reactive stores", () => {
		it("size tracks queue length", async () => {
			const q = asyncQueue(
				async (n: number) => {
					await new Promise((r) => setTimeout(r, 20));
					return n;
				},
				{ concurrency: 1 },
			);

			expect(q.size.get()).toBe(0);

			rawSubscribe(q.enqueue(1), () => {});
			expect(q.size.get()).toBe(0); // immediately started, not queued

			rawSubscribe(q.enqueue(2), () => {});
			expect(q.size.get()).toBe(1);

			rawSubscribe(q.enqueue(3), () => {});
			expect(q.size.get()).toBe(2);
		});

		it("running tracks active task count", async () => {
			const q = asyncQueue(
				async (n: number) => {
					await new Promise((r) => setTimeout(r, 10));
					return n;
				},
				{ concurrency: 2 },
			);

			rawSubscribe(q.enqueue(1), () => {});
			rawSubscribe(q.enqueue(2), () => {});
			expect(q.running.get()).toBe(2);

			rawSubscribe(q.enqueue(3), () => {});
			expect(q.running.get()).toBe(2); // still 2, third is queued
		});

		it("completed and failed track successes and errors separately", async () => {
			const q = asyncQueue(async (n: number) => {
				if (n % 2 === 0) throw new Error("even");
				return n;
			});

			await toPromise(q.enqueue(1)); // success
			await expect(toPromise(q.enqueue(2))).rejects.toThrow("even");
			await toPromise(q.enqueue(3)); // success
			await expect(toPromise(q.enqueue(4))).rejects.toThrow("even");

			expect(q.completed.get()).toBe(2);
			expect(q.failed.get()).toBe(2);
		});
	});
});
