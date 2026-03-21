import { describe, expect, it } from "vitest";
import { state } from "../../core/state";
import { fromTrigger } from "../../extra/fromTrigger";
import { subscribe } from "../../extra/subscribe";
import { pipeline, step } from "../../orchestrate/pipeline";
import { task } from "../../orchestrate/task";
import { wait } from "../../orchestrate/wait";

describe("wait (intentional pause step)", () => {
	describe("duration mode", () => {
		it("delays forwarding by specified milliseconds", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				pause: wait("trigger", 50),
				process: task(["pause"], async (_signal, [v]: [string]) => `done: ${v}`),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.process, (v) => results.push(v));

			(wf.steps.trigger as any).fire("hello");

			// Should not be immediate
			await new Promise((r) => setTimeout(r, 20));
			expect(results.filter((r) => r === "done: hello")).toHaveLength(0);

			// Should arrive after delay
			await new Promise((r) => setTimeout(r, 60));
			expect(results.some((r) => r === "done: hello")).toBe(true);

			unsub.unsubscribe();
			wf.destroy();
		});

		it("cancels pending wait on re-trigger (switchMap)", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				pause: wait("trigger", 80),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.pause, (v) => {
				if (v !== undefined) results.push(v);
			});

			(wf.steps.trigger as any).fire("first");
			await new Promise((r) => setTimeout(r, 30));

			// Re-trigger before first wait completes
			(wf.steps.trigger as any).fire("second");
			await new Promise((r) => setTimeout(r, 120));

			// Only "second" should have arrived (first was cancelled)
			expect(results).toEqual(["second"]);

			unsub.unsubscribe();
			wf.destroy();
		});

		it("passes value through unchanged", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<{ data: number }>()),
				pause: wait("trigger", 10),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.pause, (v) => {
				if (v !== undefined) results.push(v);
			});

			const obj = { data: 42 };
			(wf.steps.trigger as any).fire(obj);
			await new Promise((r) => setTimeout(r, 50));

			expect(results[0]).toBe(obj); // Same reference

			unsub.unsubscribe();
			wf.destroy();
		});
	});

	describe("signal mode", () => {
		it("holds value until signal emits truthy", async () => {
			const ready = state(false);
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				pause: wait("trigger", ready),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.pause, (v) => {
				if (v !== undefined) results.push(v);
			});

			(wf.steps.trigger as any).fire("waiting");
			await new Promise((r) => setTimeout(r, 30));

			// Value should be held (signal is falsy)
			expect(results).toHaveLength(0);

			// Release the signal
			ready.set(true);
			await new Promise((r) => setTimeout(r, 30));

			expect(results).toEqual(["waiting"]);

			unsub.unsubscribe();
			wf.destroy();
		});

		it("forwards immediately if signal is already truthy", async () => {
			const ready = state(true);
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				pause: wait("trigger", ready),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.pause, (v) => {
				if (v !== undefined) results.push(v);
			});

			(wf.steps.trigger as any).fire("instant");
			await new Promise((r) => setTimeout(r, 30));

			expect(results).toEqual(["instant"]);

			unsub.unsubscribe();
			wf.destroy();
		});

		it("cancels pending wait on re-trigger", async () => {
			const ready = state(false);
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				pause: wait("trigger", ready),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.pause, (v) => {
				if (v !== undefined) results.push(v);
			});

			(wf.steps.trigger as any).fire("first");
			await new Promise((r) => setTimeout(r, 20));

			(wf.steps.trigger as any).fire("second");
			await new Promise((r) => setTimeout(r, 20));

			// Release — only "second" should come through
			ready.set(true);
			await new Promise((r) => setTimeout(r, 30));

			expect(results).toEqual(["second"]);

			unsub.unsubscribe();
			wf.destroy();
		});
	});
});
