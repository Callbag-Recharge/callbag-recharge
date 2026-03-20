import { describe, expect, it, vi } from "vitest";
import { state } from "../../core/state";
import { validationPipeline } from "../../utils/validationPipeline";

describe("validationPipeline", () => {
	// -----------------------------------------------------------------------
	// Sync validation
	// -----------------------------------------------------------------------
	describe("sync validation", () => {
		it("runs sync validators immediately", () => {
			const s = state("");
			const v = validationPipeline(s, {
				sync: [(val) => (val.length === 0 ? "Required" : true)],
			});

			expect(v.error.get()).toBe("Required");
			expect(v.valid.get()).toBe(false);
			expect(v.errors.get()).toEqual(["Required"]);
		});

		it("clears error when valid", () => {
			const s = state("");
			const v = validationPipeline(s, {
				sync: [(val) => (val.length === 0 ? "Required" : true)],
			});

			s.set("hello");
			expect(v.error.get()).toBe("");
			expect(v.valid.get()).toBe(true);
			expect(v.errors.get()).toEqual([]);
		});

		it("collects all sync errors", () => {
			const s = state("");
			const v = validationPipeline(s, {
				sync: [
					(val) => (val.length === 0 ? "Required" : true),
					(val) => (val.length < 3 ? "Too short" : true),
				],
			});

			expect(v.errors.get()).toEqual(["Required", "Too short"]);
			expect(v.error.get()).toBe("Required"); // first error

			s.set("ab");
			expect(v.errors.get()).toEqual(["Too short"]);

			s.set("abc");
			expect(v.errors.get()).toEqual([]);
		});

		it("validators can return undefined for valid", () => {
			const s = state("ok");
			const v = validationPipeline(s, {
				sync: [() => undefined],
			});
			expect(v.valid.get()).toBe(true);
		});

		it("reacts to source changes", () => {
			const s = state("");
			const v = validationPipeline(s, {
				sync: [(val) => (val.length === 0 ? "Required" : true)],
			});

			// Verify initial state
			expect(v.error.get()).toBe("Required");

			s.set("a");
			expect(v.error.get()).toBe("");

			s.set("");
			expect(v.error.get()).toBe("Required");

			s.set("b");
			expect(v.error.get()).toBe("");
		});
	});

	// -----------------------------------------------------------------------
	// Async validation
	// -----------------------------------------------------------------------
	describe("async validation", () => {
		it("runs async validators after debounce", async () => {
			vi.useFakeTimers();
			const s = state("test");
			const v = validationPipeline(s, {
				sync: [],
				async: [async (val) => (val === "taken" ? "Already taken" : undefined)],
				debounceMs: 100,
			});

			s.set("taken");
			expect(v.validating.get()).toBe(true);
			expect(v.valid.get()).toBe(false); // validating = not valid

			vi.advanceTimersByTime(100);
			await vi.runAllTimersAsync();

			expect(v.validating.get()).toBe(false);
			expect(v.error.get()).toBe("Already taken");
			expect(v.valid.get()).toBe(false);

			vi.useRealTimers();
		});

		it("cancels previous async validation on new value", async () => {
			vi.useFakeTimers();
			const signals: AbortSignal[] = [];
			const s = state("a");
			const _v = validationPipeline(s, {
				async: [
					async (_val, signal) => {
						signals.push(signal);
						return undefined;
					},
				],
				debounceMs: 100,
			});

			s.set("b"); // starts debounce
			vi.advanceTimersByTime(50);
			s.set("c"); // cancels previous, starts new debounce

			vi.advanceTimersByTime(100);
			await vi.runAllTimersAsync();

			// Only the last value's validator should have run
			// First debounce was cancelled before it fired
			expect(signals.length).toBe(1);

			vi.useRealTimers();
		});

		it("skips async when sync errors exist", async () => {
			vi.useFakeTimers();
			let asyncCalled = false;
			const s = state("");
			const v = validationPipeline(s, {
				sync: [(val) => (val.length === 0 ? "Required" : true)],
				async: [
					async () => {
						asyncCalled = true;
						return undefined;
					},
				],
				debounceMs: 100,
			});

			vi.advanceTimersByTime(200);
			await vi.runAllTimersAsync();

			expect(asyncCalled).toBe(false);
			expect(v.validating.get()).toBe(false);

			vi.useRealTimers();
		});

		it("handles async validator rejection", async () => {
			vi.useFakeTimers();
			const s = state("test");
			const v = validationPipeline(s, {
				async: [
					async () => {
						throw new Error("Network error");
					},
				],
				debounceMs: 0,
			});

			s.set("trigger");
			vi.advanceTimersByTime(0);
			await vi.runAllTimersAsync();

			expect(v.error.get()).toBe("Error: Network error");
			expect(v.validating.get()).toBe(false);

			vi.useRealTimers();
		});

		it("collects multiple async errors", async () => {
			vi.useFakeTimers();
			const s = state("bad");
			const v = validationPipeline(s, {
				async: [
					async (val) => (val === "bad" ? "Error 1" : undefined),
					async (val) => (val === "bad" ? "Error 2" : undefined),
				],
				debounceMs: 0,
			});

			s.set("bad");
			vi.advanceTimersByTime(0);
			await vi.runAllTimersAsync();

			expect(v.errors.get()).toEqual(["Error 1", "Error 2"]);

			vi.useRealTimers();
		});
	});

	// -----------------------------------------------------------------------
	// Manual validate
	// -----------------------------------------------------------------------
	describe("manual validate", () => {
		it("re-runs validation on demand", () => {
			let counter = 0;
			const s = state("x");
			const v = validationPipeline(s, {
				sync: [
					() => {
						counter++;
						return true;
					},
				],
			});

			const before = counter;
			v.validate();
			expect(counter).toBeGreaterThan(before);
		});
	});

	// -----------------------------------------------------------------------
	// No validators
	// -----------------------------------------------------------------------
	describe("no validators", () => {
		it("starts valid with no validators", () => {
			const s = state("anything");
			const v = validationPipeline(s);

			expect(v.valid.get()).toBe(true);
			expect(v.error.get()).toBe("");
			expect(v.errors.get()).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// Dispose
	// -----------------------------------------------------------------------
	describe("dispose", () => {
		it("cleans up timers on dispose", () => {
			vi.useFakeTimers();
			let asyncCalled = false;
			const s = state("a");
			const v = validationPipeline(s, {
				async: [
					async () => {
						asyncCalled = true;
						return undefined;
					},
				],
				debounceMs: 100,
			});

			s.set("b"); // starts debounce
			v.dispose();

			vi.advanceTimersByTime(200);
			// async should not have been called
			expect(asyncCalled).toBe(false);

			vi.useRealTimers();
		});

		it("dispose is idempotent", () => {
			const s = state("x");
			const v = validationPipeline(s);
			v.dispose();
			v.dispose(); // no error
		});

		it("resets validating to false on dispose", () => {
			vi.useFakeTimers();
			const s = state("a");
			const v = validationPipeline(s, {
				async: [async () => undefined],
				debounceMs: 100,
			});

			s.set("b"); // starts debounce, validating = true
			expect(v.validating.get()).toBe(true);

			v.dispose();
			expect(v.validating.get()).toBe(false);

			vi.useRealTimers();
		});

		it("async completion after dispose does not write to stores", async () => {
			const s = state("a");
			let resolveValidator: (v: string | undefined) => void;
			const v = validationPipeline(s, {
				async: [
					(_val, _signal) =>
						new Promise<string | undefined>((r) => {
							resolveValidator = r;
						}),
				],
				debounceMs: 0,
			});

			s.set("trigger");
			// Let the inline async run (debounceMs=0 runs inline)
			expect(v.validating.get()).toBe(true);

			v.dispose();
			expect(v.validating.get()).toBe(false);

			// Resolve the validator after dispose
			resolveValidator!("late error");
			await new Promise((r) => setTimeout(r, 10));

			// Should NOT have written the error
			expect(v.error.get()).toBe("");
		});
	});

	// -----------------------------------------------------------------------
	// debounceMs: 0 (inline)
	// -----------------------------------------------------------------------
	describe("debounceMs: 0", () => {
		it("runs async validation inline without setTimeout", async () => {
			const s = state("test");
			const v = validationPipeline(s, {
				async: [async (val) => (val === "bad" ? "Error" : undefined)],
				debounceMs: 0,
			});

			s.set("bad");
			// With debounceMs=0, async runs inline — no need for timer advancement
			// Just need to await the microtask
			await new Promise((r) => setTimeout(r, 0));

			expect(v.error.get()).toBe("Error");
			expect(v.validating.get()).toBe(false);
		});
	});
});
