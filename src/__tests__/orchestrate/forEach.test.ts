import { describe, expect, it } from "vitest";
import { fromTrigger } from "../../extra/fromTrigger";
import { subscribe } from "../../extra/subscribe";
import { forEach } from "../../orchestrate/forEach";
import { pipeline, step } from "../../orchestrate/pipeline";

describe("forEach (fan-out step)", () => {
	it("maps each item in parallel and emits results array", async () => {
		const wf = pipeline({
			trigger: step(fromTrigger<number[]>()),
			doubled: forEach("trigger", async (_signal, n: number) => n * 2),
		});

		const results: any[] = [];
		const unsub = subscribe(wf.steps.doubled, (v) => results.push(v));

		(wf.steps.trigger as any).fire([1, 2, 3]);

		// Wait for async
		await new Promise((r) => setTimeout(r, 50));

		expect(results.length).toBeGreaterThan(0);
		const last = results[results.length - 1];
		expect(last).toEqual([2, 4, 6]);

		unsub();
		wf.destroy();
	});

	it("handles empty array", async () => {
		const wf = pipeline({
			trigger: step(fromTrigger<string[]>()),
			processed: forEach("trigger", async (_signal, s: string) => s.toUpperCase()),
		});

		const results: any[] = [];
		const unsub = subscribe(wf.steps.processed, (v) => results.push(v));

		(wf.steps.trigger as any).fire([]);
		await new Promise((r) => setTimeout(r, 50));

		expect(results.some((r) => Array.isArray(r) && r.length === 0)).toBe(true);

		unsub();
		wf.destroy();
	});

	it("tracks task status through lifecycle", async () => {
		const wf = pipeline({
			trigger: step(fromTrigger<number[]>()),
			processed: forEach(
				"trigger",
				async (_signal, n: number) => {
					await new Promise((r) => setTimeout(r, 20));
					return n + 1;
				},
				{ name: "processor" },
			),
		});

		const unsub = subscribe(wf.steps.processed, () => {});

		// Before firing: idle

		(wf.steps.trigger as any).fire([1, 2]);
		await new Promise((r) => setTimeout(r, 100));

		// Pipeline detected the taskState — status should be completed
		expect(wf.status.get()).toBe("completed");

		unsub();
		wf.destroy();
	});

	it("respects concurrency limit", async () => {
		let maxConcurrent = 0;
		let currentConcurrent = 0;

		const wf = pipeline({
			trigger: step(fromTrigger<number[]>()),
			processed: forEach(
				"trigger",
				async (_signal, n: number) => {
					currentConcurrent++;
					if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
					await new Promise((r) => setTimeout(r, 30));
					currentConcurrent--;
					return n;
				},
				{ concurrency: 2 },
			),
		});

		const results: any[] = [];
		const unsub = subscribe(wf.steps.processed, (v) => results.push(v));

		(wf.steps.trigger as any).fire([1, 2, 3, 4, 5]);
		await new Promise((r) => setTimeout(r, 300));

		expect(maxConcurrent).toBeLessThanOrEqual(2);
		const last = results[results.length - 1];
		expect(last).toEqual([1, 2, 3, 4, 5]);

		unsub();
		wf.destroy();
	});

	it("uses fallback on per-item error", async () => {
		const wf = pipeline({
			trigger: step(fromTrigger<number[]>()),
			processed: forEach(
				"trigger",
				async (_signal, n: number) => {
					if (n === 2) throw new Error("bad");
					return n * 10;
				},
				{ fallback: -1 },
			),
		});

		const results: any[] = [];
		const unsub = subscribe(wf.steps.processed, (v) => results.push(v));

		(wf.steps.trigger as any).fire([1, 2, 3]);
		await new Promise((r) => setTimeout(r, 50));

		const last = results[results.length - 1];
		expect(last).toEqual([10, -1, 30]);

		unsub();
		wf.destroy();
	});

	it("fallback factory receives error and index", async () => {
		const wf = pipeline({
			trigger: step(fromTrigger<number[]>()),
			processed: forEach(
				"trigger",
				async (_signal, n: number) => {
					if (n === 3) throw new Error("oops");
					return n;
				},
				{ fallback: (_err, idx) => idx * -1 },
			),
		});

		const results: any[] = [];
		const unsub = subscribe(wf.steps.processed, (v) => results.push(v));

		(wf.steps.trigger as any).fire([1, 2, 3]);
		await new Promise((r) => setTimeout(r, 50));

		const last = results[results.length - 1];
		expect(last).toEqual([1, 2, -2]); // index 2 → -2

		unsub();
		wf.destroy();
	});

	it("errors propagate when no fallback", async () => {
		const forEachDef = forEach("trigger", async (_signal, n: number) => {
			if (n === 2) throw new Error("fail");
			return n;
		});

		const wf = pipeline({
			trigger: step(fromTrigger<number[]>()),
			processed: forEachDef,
		});

		const unsub = subscribe(wf.steps.processed, () => {});

		(wf.steps.trigger as any).fire([1, 2, 3]);
		await new Promise((r) => setTimeout(r, 50));

		// taskState should capture the error
		expect(forEachDef.error.get()).toBeDefined();

		unsub();
		wf.destroy();
	});

	it("re-trigger cancels previous batch (switchMap semantics)", async () => {
		const wf = pipeline({
			trigger: step(fromTrigger<number[]>()),
			processed: forEach("trigger", async (_signal, n: number) => {
				await new Promise((r) => setTimeout(r, 50));
				return n;
			}),
		});

		const results: any[] = [];
		const unsub = subscribe(wf.steps.processed, (v) => results.push(v));

		// Fire twice quickly — first batch should be cancelled
		(wf.steps.trigger as any).fire([1, 2]);
		await new Promise((r) => setTimeout(r, 10));
		(wf.steps.trigger as any).fire([3, 4]);
		await new Promise((r) => setTimeout(r, 150));

		// Only second batch should complete
		const last = results[results.length - 1];
		expect(last).toEqual([3, 4]);

		unsub();
		wf.destroy();
	});

	it("runCount accumulates across re-triggers", async () => {
		const forEachDef = forEach("trigger", async (_signal, n: number) => n);

		const wf = pipeline({
			trigger: step(fromTrigger<number[]>()),
			processed: forEachDef,
		});

		const unsub = subscribe(wf.steps.processed, () => {});

		(wf.steps.trigger as any).fire([1]);
		await new Promise((r) => setTimeout(r, 50));
		expect(forEachDef.runCount.get()).toBe(1);

		(wf.steps.trigger as any).fire([2]);
		await new Promise((r) => setTimeout(r, 50));
		expect(forEachDef.runCount.get()).toBe(2);

		(wf.steps.trigger as any).fire([3]);
		await new Promise((r) => setTimeout(r, 50));
		expect(forEachDef.runCount.get()).toBe(3);

		unsub();
		wf.destroy();
	});
});
