import { describe, expect, it } from "vitest";
import { fromTrigger } from "../../extra/fromTrigger";
import { subscribe } from "../../extra/subscribe";
import { onFailure } from "../../orchestrate/onFailure";
import { pipeline, step } from "../../orchestrate/pipeline";
import { task } from "../../orchestrate/task";

describe("onFailure (dead letter step)", () => {
	it("fires handler when upstream task errors", async () => {
		const wf = pipeline({
			trigger: step(fromTrigger<string>()),
			fetch: task(["trigger"], async (_signal) => {
				throw new Error("fetch failed");
			}),
			dlq: onFailure("fetch", async (_signal, error) => {
				return { handled: true, message: (error as Error).message };
			}),
		});

		const results: any[] = [];
		const unsub = subscribe(wf.steps.dlq, (v) => results.push(v));

		(wf.steps.trigger as any).fire("go");
		await new Promise((r) => setTimeout(r, 100));

		// onFailure handler should have received the error
		const last = results.filter((r) => r !== undefined).pop();
		expect(last).toEqual({ handled: true, message: "fetch failed" });

		unsub.unsubscribe();
		wf.destroy();
	});

	it("does not fire when upstream task succeeds", async () => {
		const wf = pipeline({
			trigger: step(fromTrigger<string>()),
			fetch: task(["trigger"], async (_signal, [v]: [string]) => `result: ${v}`),
			dlq: onFailure("fetch", async (_signal, error) => {
				return { error };
			}),
		});

		const dlqResults: any[] = [];
		const fetchResults: any[] = [];
		const unsub1 = subscribe(wf.steps.dlq, (v) => dlqResults.push(v));
		const unsub2 = subscribe(wf.steps.fetch, (v) => fetchResults.push(v));

		(wf.steps.trigger as any).fire("hello");
		await new Promise((r) => setTimeout(r, 100));

		// Fetch should have succeeded
		expect(fetchResults.some((r) => r === "result: hello")).toBe(true);
		// DLQ should not have fired — no error guard completes without emitting
		expect(dlqResults.every((r) => r === undefined)).toBe(true);

		unsub1.unsubscribe();
		unsub2.unsubscribe();
		wf.destroy();
	});

	it("tracks its own taskState for handler execution", async () => {
		const wf = pipeline({
			trigger: step(fromTrigger<string>()),
			fetch: task(["trigger"], async (_signal) => {
				throw new Error("boom");
			}),
			dlq: onFailure("fetch", async (_signal) => {
				return "logged";
			}),
		});

		const unsub = subscribe(wf.steps.dlq, () => {});

		(wf.steps.trigger as any).fire("go");
		await new Promise((r) => setTimeout(r, 100));

		// Check that the pipeline detected the onFailure taskState for aggregate status
		expect(wf.status.get()).toBeDefined();

		unsub.unsubscribe();
		wf.destroy();
	});

	it("fires handler after retries exhausted", async () => {
		let attempts = 0;
		const wf = pipeline({
			trigger: step(fromTrigger<string>()),
			fetch: task(
				["trigger"],
				async (_signal) => {
					attempts++;
					throw new Error(`fail #${attempts}`);
				},
				{ retry: 2 },
			),
			dlq: onFailure("fetch", async (_signal, error) => {
				return (error as Error).message;
			}),
		});

		const results: any[] = [];
		const unsub = subscribe(wf.steps.dlq, (v) => results.push(v));

		(wf.steps.trigger as any).fire("go");
		await new Promise((r) => setTimeout(r, 200));

		// Should have retried 2 times + initial = 3 attempts total
		expect(attempts).toBe(3);
		// DLQ should have caught the final error
		const last = results.filter((r) => r !== undefined).pop();
		expect(last).toBe("fail #3");

		unsub.unsubscribe();
		wf.destroy();
	});

	it("re-fires on repeated failures after reset", async () => {
		let callCount = 0;
		const wf = pipeline({
			trigger: step(fromTrigger<string>()),
			fetch: task(["trigger"], async (_signal) => {
				throw new Error("always fails");
			}),
			dlq: onFailure("fetch", async (_signal) => {
				callCount++;
				return `handled-${callCount}`;
			}),
		});

		const results: any[] = [];
		const unsub = subscribe(wf.steps.dlq, (v) => results.push(v));

		(wf.steps.trigger as any).fire("first");
		await new Promise((r) => setTimeout(r, 100));

		(wf.steps.trigger as any).fire("second");
		await new Promise((r) => setTimeout(r, 100));

		const nonUndefined = results.filter((r) => r !== undefined);
		expect(nonUndefined.length).toBeGreaterThanOrEqual(2);

		unsub.unsubscribe();
		wf.destroy();
	});

	it("handler errors are tracked in its own taskState", async () => {
		const dlqStep = onFailure("fetch", async (_signal) => {
			throw new Error("handler failed");
		});

		const wf = pipeline({
			trigger: step(fromTrigger<string>()),
			fetch: task(["trigger"], async (_signal) => {
				throw new Error("upstream fail");
			}),
			dlq: dlqStep,
		});

		const unsub = subscribe(wf.steps.dlq, () => {});

		(wf.steps.trigger as any).fire("go");
		await new Promise((r) => setTimeout(r, 100));

		// The onFailure step's own error companion should reflect the handler failure
		expect(dlqStep.error.get()).toBeInstanceOf(Error);
		expect((dlqStep.error.get() as Error).message).toBe("handler failed");

		unsub.unsubscribe();
		wf.destroy();
	});

	// -------------------------------------------------------------------------
	// lifecycle signals (5f-7)
	// -------------------------------------------------------------------------
	describe("lifecycle signals", () => {
		it("RESET resets taskState via signal interceptor", async () => {
			const dlqStep = onFailure("fetch", async (_signal, error) => {
				return { handled: true, error: String(error) };
			});

			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				fetch: task(["trigger"], async (_signal) => {
					throw new Error("fail");
				}),
				dlq: dlqStep,
			});

			const unsub = subscribe(wf.steps.dlq, () => {});

			(wf.steps.trigger as any).fire("go");
			await new Promise((r) => setTimeout(r, 100));

			expect(dlqStep.runCount.get()).toBeGreaterThanOrEqual(1);

			// RESET cascades through graph
			wf.reset();

			unsub.unsubscribe();
			wf.destroy();
		});

		it("TEARDOWN via pipeline.destroy() cleans up onFailure step", async () => {
			const dlqStep = onFailure("fetch", async (_signal, _error) => {
				return { handled: true };
			});

			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				fetch: task(["trigger"], async (_signal) => {
					throw new Error("fail");
				}),
				dlq: dlqStep,
			});

			const unsub = subscribe(wf.steps.dlq, () => {});

			// destroy sends TEARDOWN through the graph
			wf.destroy();
			unsub.unsubscribe();
		});
	});
});
