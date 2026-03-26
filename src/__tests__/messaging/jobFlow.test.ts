import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jobFlow } from "../../messaging/jobFlow";
import { jobQueue } from "../../messaging/jobQueue";

describe("jobFlow", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	// -----------------------------------------------------------------------
	// 5e-8: Multi-queue workflows
	// -----------------------------------------------------------------------

	describe("basic wiring", () => {
		it("chains two queues via completion event", async () => {
			const secondQueueData: number[] = [];

			const q1 = jobQueue<string, number>("step1", async (_s, d) => {
				return d.length; // string length
			});

			const q2 = jobQueue<number, void>("step2", async (_s, d) => {
				secondQueueData.push(d);
			});

			const flow = jobFlow({ step1: q1, step2: q2 }, [{ from: "step1", to: "step2" }]);

			q1.add("hello");

			// Process step1, then step2
			await vi.advanceTimersByTimeAsync(1000);

			expect(secondQueueData).toEqual([5]);
			flow.destroy();
			q1.destroy();
			q2.destroy();
		});

		it("supports transform function on edges", async () => {
			const results: string[] = [];

			const q1 = jobQueue<number, number>("source", async (_s, d) => d * 2);
			const q2 = jobQueue<string, void>("sink", async (_s, d) => {
				results.push(d);
			});

			const flow = jobFlow({ source: q1, sink: q2 }, [
				{ from: "source", to: "sink", transform: (n: number) => `val:${n}` },
			]);

			q1.add(5);
			await vi.advanceTimersByTimeAsync(1000);

			expect(results).toEqual(["val:10"]);
			flow.destroy();
			q1.destroy();
			q2.destroy();
		});

		it("supports multi-step chains (A → B → C)", async () => {
			const finalResults: string[] = [];

			const qA = jobQueue<string, string>("A", async (_s, d) => d.toUpperCase());
			const qB = jobQueue<string, string>("B", async (_s, d) => `[${d}]`);
			const qC = jobQueue<string, void>("C", async (_s, d) => {
				finalResults.push(d);
			});

			const flow = jobFlow({ A: qA, B: qB, C: qC }, [
				{ from: "A", to: "B" },
				{ from: "B", to: "C" },
			]);

			qA.add("hello");
			await vi.advanceTimersByTimeAsync(2000);

			expect(finalResults).toEqual(["[HELLO]"]);
			flow.destroy();
			qA.destroy();
			qB.destroy();
			qC.destroy();
		});

		it("supports fan-out (one source to multiple destinations)", async () => {
			const logData: number[] = [];
			const notifyData: number[] = [];

			const qSource = jobQueue<number, number>("source", async (_s, d) => d);
			const qLog = jobQueue<number, void>("log", async (_s, d) => {
				logData.push(d);
			});
			const qNotify = jobQueue<number, void>("notify", async (_s, d) => {
				notifyData.push(d);
			});

			const flow = jobFlow({ source: qSource, log: qLog, notify: qNotify }, [
				{ from: "source", to: "log" },
				{ from: "source", to: "notify" },
			]);

			qSource.add(42);
			await vi.advanceTimersByTimeAsync(1000);

			expect(logData).toEqual([42]);
			expect(notifyData).toEqual([42]);
			flow.destroy();
			qSource.destroy();
			qLog.destroy();
			qNotify.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Fan-out (SA-4)
	// -----------------------------------------------------------------------

	describe("fanOut edges", () => {
		it("fans out array results into individual jobs (1:N)", async () => {
			const sinkData: string[] = [];

			const q1 = jobQueue<string, string[]>("splitter", async (_s, d) => {
				return d.split(","); // "a,b,c" → ["a", "b", "c"]
			});

			const q2 = jobQueue<string, void>("collector", async (_s, d) => {
				sinkData.push(d);
			});

			const flow = jobFlow({ splitter: q1, collector: q2 }, [
				{ from: "splitter", to: "collector", fanOut: true },
			]);

			q1.add("x,y,z");
			await vi.advanceTimersByTimeAsync(2000);

			expect(sinkData).toEqual(expect.arrayContaining(["x", "y", "z"]));
			expect(sinkData).toHaveLength(3);
			flow.destroy();
			q1.destroy();
			q2.destroy();
		});

		it("fanOut with transform produces N jobs from transformed array", async () => {
			const results: number[] = [];

			const q1 = jobQueue<string, string>("source", async (_s, d) => d);
			const q2 = jobQueue<number, void>("sink", async (_s, d) => {
				results.push(d);
			});

			const flow = jobFlow({ source: q1, sink: q2 }, [
				{
					from: "source",
					to: "sink",
					fanOut: true,
					transform: (s: string) => s.split("").map((c) => c.charCodeAt(0)),
				},
			]);

			q1.add("AB");
			await vi.advanceTimersByTimeAsync(2000);

			expect(results).toEqual(expect.arrayContaining([65, 66]));
			expect(results).toHaveLength(2);
			flow.destroy();
			q1.destroy();
			q2.destroy();
		});

		it("fanOut with empty array produces no jobs", async () => {
			const results: string[] = [];

			const q1 = jobQueue<string, string[]>("src", async () => []);
			const q2 = jobQueue<string, void>("dst", async (_s, d) => {
				results.push(d);
			});

			const flow = jobFlow({ src: q1, dst: q2 }, [{ from: "src", to: "dst", fanOut: true }]);

			q1.add("trigger");
			await vi.advanceTimersByTimeAsync(1000);

			expect(results).toEqual([]);
			flow.destroy();
			q1.destroy();
			q2.destroy();
		});

		it("Mermaid diagram labels fan-out edges", () => {
			const q1 = jobQueue<string>("a", async () => {});
			const q2 = jobQueue<string>("b", async () => {});

			const flow = jobFlow({ a: q1, b: q2 }, [{ from: "a", to: "b", fanOut: true }]);

			expect(flow.toMermaid()).toContain("|fan-out|");
			expect(flow.toD2()).toContain(": fan-out");
			flow.destroy();
			q1.destroy();
			q2.destroy();
		});

		it("fanOut strict-fails when output is not an array", async () => {
			const results: string[] = [];
			const q1 = jobQueue<string, string>("src", async (_s, d) => d);
			const q2 = jobQueue<string, void>("dst", async (_s, d) => {
				results.push(d);
			});

			const flow = jobFlow({ src: q1, dst: q2 }, [{ from: "src", to: "dst", fanOut: true }]);
			q1.add("not-an-array");
			await vi.advanceTimersByTimeAsync(1000);

			// strict fail: non-array fanOut payload is dropped and not enqueued
			expect(results).toEqual([]);
			flow.destroy();
			q1.destroy();
			q2.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Validation
	// -----------------------------------------------------------------------

	describe("validation", () => {
		it("throws on unknown source queue", () => {
			const q = jobQueue<string>("real", async () => {});
			expect(() => {
				jobFlow({ real: q }, [{ from: "missing", to: "real" }]);
			}).toThrow('source queue "missing" not found');
			q.destroy();
		});

		it("throws on unknown destination queue", () => {
			const q = jobQueue<string>("real", async () => {});
			expect(() => {
				jobFlow({ real: q }, [{ from: "real", to: "missing" }]);
			}).toThrow('destination queue "missing" not found');
			q.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Diagram export
	// -----------------------------------------------------------------------

	describe("diagram export", () => {
		it("exports Mermaid diagram", () => {
			const q1 = jobQueue<string>("fetch", async () => {});
			const q2 = jobQueue<string>("process", async () => {});

			const flow = jobFlow({ fetch: q1, process: q2 }, [{ from: "fetch", to: "process" }]);

			const mermaid = flow.toMermaid();
			expect(mermaid).toContain("graph LR");
			expect(mermaid).toContain('fetch["fetch"]');
			expect(mermaid).toContain('process["process"]');
			expect(mermaid).toContain("fetch --> process");
			flow.destroy();
			q1.destroy();
			q2.destroy();
		});

		it("exports Mermaid with transform label", () => {
			const q1 = jobQueue<string>("a", async () => {});
			const q2 = jobQueue<string>("b", async () => {});

			const flow = jobFlow({ a: q1, b: q2 }, [{ from: "a", to: "b", transform: (x: any) => x }]);

			const mermaid = flow.toMermaid();
			expect(mermaid).toContain("|transform|");
			flow.destroy();
			q1.destroy();
			q2.destroy();
		});

		it("exports D2 diagram", () => {
			const q1 = jobQueue<string>("fetch", async () => {});
			const q2 = jobQueue<string>("process", async () => {});

			const flow = jobFlow({ fetch: q1, process: q2 }, [{ from: "fetch", to: "process" }]);

			const d2 = flow.toD2();
			expect(d2).toContain("fetch: fetch");
			expect(d2).toContain("process: process");
			expect(d2).toContain("fetch -> process");
			flow.destroy();
			q1.destroy();
			q2.destroy();
		});

		it("exports D2 with transform label", () => {
			const q1 = jobQueue<string>("a", async () => {});
			const q2 = jobQueue<string>("b", async () => {});

			const flow = jobFlow({ a: q1, b: q2 }, [{ from: "a", to: "b", transform: (x: any) => x }]);

			const d2 = flow.toD2();
			expect(d2).toContain("a -> b: transform");
			flow.destroy();
			q1.destroy();
			q2.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	describe("lifecycle", () => {
		it("destroy unwires edges but does not destroy queues", async () => {
			const results: number[] = [];
			const q1 = jobQueue<number, number>("src", async (_s, d) => d);
			const q2 = jobQueue<number, void>("dst", async (_s, d) => {
				results.push(d);
			});

			const flow = jobFlow({ src: q1, dst: q2 }, [{ from: "src", to: "dst" }]);

			flow.destroy();

			// Queues still work after flow destroy (flow doesn't own them)
			q1.add(42);
			await vi.advanceTimersByTimeAsync(500);
			// But wiring is disconnected, so q2 should NOT have received the result
			expect(results).toEqual([]);

			// No errors on double destroy
			expect(() => flow.destroy()).not.toThrow();

			// Clean up queues manually
			q1.destroy();
			q2.destroy();
		});

		it("exposes flow name", () => {
			const q = jobQueue<string>("q", async () => {});
			const flow = jobFlow({ q }, [], { name: "my-flow" });
			expect(flow.name).toBe("my-flow");
			flow.destroy();
			q.destroy();
		});

		it("exposes queues record", () => {
			const q1 = jobQueue<string>("a", async () => {});
			const q2 = jobQueue<string>("b", async () => {});
			const flow = jobFlow({ a: q1, b: q2 }, []);
			expect(flow.queues.a).toBe(q1);
			expect(flow.queues.b).toBe(q2);
			flow.destroy();
			q1.destroy();
			q2.destroy();
		});
	});
});
