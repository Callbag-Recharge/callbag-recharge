import { describe, expect, it } from "vitest";
import { fromTrigger } from "../../extra/fromTrigger";
import { subscribe } from "../../extra/subscribe";
import { join } from "../../orchestrate/join";
import { pipeline, step } from "../../orchestrate/pipeline";
import { task } from "../../orchestrate/task";

describe("join (merge strategies step)", () => {
	// -------------------------------------------------------------------------
	// append strategy
	// -------------------------------------------------------------------------
	describe("append", () => {
		it("concatenates arrays from multiple deps", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				left: task(["trigger"], (_signal) => [1, 2, 3]),
				right: task(["trigger"], (_signal) => [4, 5, 6]),
				merged: join(["left", "right"], "append"),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.merged, (v) => results.push(v));

			(wf.steps.trigger as any).fire("go");
			await new Promise((r) => setTimeout(r, 50));

			expect(results.length).toBeGreaterThan(0);
			const last = results[results.length - 1];
			expect(last).toEqual([1, 2, 3, 4, 5, 6]);

			unsub();
			wf.destroy();
		});

		it("handles empty arrays", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				left: task(["trigger"], (_signal) => [1]),
				right: task(["trigger"], (_signal) => [] as number[]),
				merged: join(["left", "right"], "append"),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.merged, (v) => results.push(v));

			(wf.steps.trigger as any).fire("go");
			await new Promise((r) => setTimeout(r, 50));

			const last = results[results.length - 1];
			expect(last).toEqual([1]);

			unsub();
			wf.destroy();
		});

		it("works with 3+ deps", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				a: task(["trigger"], (_signal) => [1]),
				b: task(["trigger"], (_signal) => [2]),
				c: task(["trigger"], (_signal) => [3]),
				merged: join(["a", "b", "c"], "append"),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.merged, (v) => results.push(v));

			(wf.steps.trigger as any).fire("go");
			await new Promise((r) => setTimeout(r, 50));

			const last = results[results.length - 1];
			expect(last).toEqual([1, 2, 3]);

			unsub();
			wf.destroy();
		});
	});

	// -------------------------------------------------------------------------
	// merge strategy (full outer join by key)
	// -------------------------------------------------------------------------
	describe("merge (full outer join)", () => {
		it("merges objects by key from two deps", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				users: task(["trigger"], (_signal) => [
					{ id: 1, name: "Alice" },
					{ id: 2, name: "Bob" },
				]),
				scores: task(["trigger"], (_signal) => [
					{ id: 1, score: 100 },
					{ id: 3, score: 200 },
				]),
				merged: join(["users", "scores"], { merge: (item: any) => item.id }),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.merged, (v) => results.push(v));

			(wf.steps.trigger as any).fire("go");
			await new Promise((r) => setTimeout(r, 50));

			const last = results[results.length - 1];
			expect(last).toEqual([
				{ id: 1, name: "Alice", score: 100 },
				{ id: 2, name: "Bob" },
				{ id: 3, score: 200 },
			]);

			unsub();
			wf.destroy();
		});

		it("later dep overrides earlier on conflicting fields", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				a: task(["trigger"], (_signal) => [{ id: 1, val: "old" }]),
				b: task(["trigger"], (_signal) => [{ id: 1, val: "new" }]),
				merged: join(["a", "b"], { merge: (item: any) => item.id }),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.merged, (v) => results.push(v));

			(wf.steps.trigger as any).fire("go");
			await new Promise((r) => setTimeout(r, 50));

			const last = results[results.length - 1];
			expect(last).toEqual([{ id: 1, val: "new" }]);

			unsub();
			wf.destroy();
		});

		it("preserves encounter order for keys", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				a: task(["trigger"], (_signal) => [
					{ id: 3, x: 1 },
					{ id: 1, x: 2 },
				]),
				b: task(["trigger"], (_signal) => [
					{ id: 2, y: 3 },
					{ id: 1, y: 4 },
				]),
				merged: join(["a", "b"], { merge: (item: any) => item.id }),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.merged, (v) => results.push(v));

			(wf.steps.trigger as any).fire("go");
			await new Promise((r) => setTimeout(r, 50));

			const last = results[results.length - 1];
			// Order: 3 first (from a), then 1 (from a), then 2 (from b, new key)
			expect(last.map((i: any) => i.id)).toEqual([3, 1, 2]);

			unsub();
			wf.destroy();
		});
	});

	// -------------------------------------------------------------------------
	// intersect strategy (inner join by key)
	// -------------------------------------------------------------------------
	describe("intersect (inner join)", () => {
		it("keeps only items whose key exists in ALL deps", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				users: task(["trigger"], (_signal) => [
					{ id: 1, name: "Alice" },
					{ id: 2, name: "Bob" },
				]),
				scores: task(["trigger"], (_signal) => [
					{ id: 1, score: 100 },
					{ id: 3, score: 200 },
				]),
				merged: join(["users", "scores"], { intersect: (item: any) => item.id }),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.merged, (v) => results.push(v));

			(wf.steps.trigger as any).fire("go");
			await new Promise((r) => setTimeout(r, 50));

			const last = results[results.length - 1];
			// Only id=1 exists in both
			expect(last).toEqual([{ id: 1, name: "Alice", score: 100 }]);

			unsub();
			wf.destroy();
		});

		it("returns empty when no common keys", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				a: task(["trigger"], (_signal) => [{ id: 1, x: 1 }]),
				b: task(["trigger"], (_signal) => [{ id: 2, y: 2 }]),
				merged: join(["a", "b"], { intersect: (item: any) => item.id }),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.merged, (v) => results.push(v));

			(wf.steps.trigger as any).fire("go");
			await new Promise((r) => setTimeout(r, 50));

			const last = results[results.length - 1];
			expect(last).toEqual([]);

			unsub();
			wf.destroy();
		});

		it("intersects across 3 deps", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				a: task(["trigger"], (_signal) => [
					{ id: 1, x: 1 },
					{ id: 2, x: 2 },
				]),
				b: task(["trigger"], (_signal) => [
					{ id: 1, y: 10 },
					{ id: 3, y: 30 },
				]),
				c: task(["trigger"], (_signal) => [
					{ id: 1, z: 100 },
					{ id: 2, z: 200 },
				]),
				merged: join(["a", "b", "c"], { intersect: (item: any) => item.id }),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.merged, (v) => results.push(v));

			(wf.steps.trigger as any).fire("go");
			await new Promise((r) => setTimeout(r, 50));

			const last = results[results.length - 1];
			// Only id=1 exists in all three
			expect(last).toEqual([{ id: 1, x: 1, y: 10, z: 100 }]);

			unsub();
			wf.destroy();
		});
	});

	// -------------------------------------------------------------------------
	// Lifecycle & error handling
	// -------------------------------------------------------------------------
	describe("lifecycle", () => {
		it("tracks task status through lifecycle", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				a: task(["trigger"], (_signal) => [1, 2]),
				b: task(["trigger"], (_signal) => [3, 4]),
				merged: join(["a", "b"], "append"),
			});

			const unsub = subscribe(wf.steps.merged, () => {});

			(wf.steps.trigger as any).fire("go");
			await new Promise((r) => setTimeout(r, 50));

			expect(wf.status.get()).toBe("completed");

			unsub();
			wf.destroy();
		});

		it("waits for all deps before joining (undefined guard)", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				a: task(["trigger"], async (_signal) => {
					await new Promise((r) => setTimeout(r, 30));
					return [1, 2];
				}),
				b: task(["trigger"], (_signal) => [3, 4]),
				merged: join(["a", "b"], "append"),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.merged, (v) => results.push(v));

			(wf.steps.trigger as any).fire("go");
			await new Promise((r) => setTimeout(r, 100));

			// Should have the merged result after both deps resolve
			const realResults = results.filter((r) => Array.isArray(r) && r.length > 0);
			expect(realResults.length).toBeGreaterThan(0);
			expect(realResults[realResults.length - 1]).toEqual([1, 2, 3, 4]);

			unsub();
			wf.destroy();
		});

		it("emits null and tracks error for non-array input", async () => {
			const merged = join(["a", "b"], "append");

			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				a: task(["trigger"], (_signal) => "not-an-array" as any),
				b: task(["trigger"], (_signal) => [1, 2]),
				merged,
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.merged, (v) => results.push(v));

			(wf.steps.trigger as any).fire("go");
			await new Promise((r) => setTimeout(r, 50));

			// Should have emitted null at some point
			expect(results).toContain(null);

			// Error should be tracked in taskState
			expect(merged.error.get()).toBeInstanceOf(TypeError);

			unsub();
			wf.destroy();
		});

		it("throws on fewer than 2 deps", () => {
			expect(() => join(["a"], "append")).toThrow("at least 2 deps");
		});

		it("re-triggers on new upstream values", async () => {
			const wf = pipeline({
				trigger: step(fromTrigger<string>()),
				a: task(["trigger"], (_signal) => [10, 20]),
				b: task(["trigger"], (_signal) => [30, 40]),
				merged: join(["a", "b"], "append"),
			});

			const results: any[] = [];
			const unsub = subscribe(wf.steps.merged, (v) => {
				if (v !== null) results.push(v);
			});

			(wf.steps.trigger as any).fire("go1");
			await new Promise((r) => setTimeout(r, 50));

			(wf.steps.trigger as any).fire("go2");
			await new Promise((r) => setTimeout(r, 50));

			// Should have at least 2 real results from 2 triggers
			expect(results.length).toBeGreaterThanOrEqual(2);

			unsub();
			wf.destroy();
		});
	});
});
