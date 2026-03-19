import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formField } from "../../../patterns/formField";

describe("formField", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// -----------------------------------------------------------------------
	// Initial state
	// -----------------------------------------------------------------------

	it("initializes with the given value", () => {
		const field = formField("hello");
		expect(field.value.get()).toBe("hello");
	});

	it("starts as not dirty, not touched, valid", () => {
		const field = formField("");
		expect(field.dirty.get()).toBe(false);
		expect(field.touched.get()).toBe(false);
		expect(field.valid.get()).toBe(true);
		expect(field.error.get()).toBe("");
	});

	// -----------------------------------------------------------------------
	// Set / dirty
	// -----------------------------------------------------------------------

	it("set updates value and marks dirty", () => {
		const field = formField("initial");

		field.set("changed");
		expect(field.value.get()).toBe("changed");
		expect(field.dirty.get()).toBe(true);
	});

	it("setting back to initial clears dirty", () => {
		const field = formField("initial");

		field.set("changed");
		expect(field.dirty.get()).toBe(true);

		field.set("initial");
		expect(field.dirty.get()).toBe(false);
	});

	// -----------------------------------------------------------------------
	// Touched
	// -----------------------------------------------------------------------

	it("touch marks the field as touched", () => {
		const field = formField("");
		expect(field.touched.get()).toBe(false);

		field.touch();
		expect(field.touched.get()).toBe(true);
	});

	// -----------------------------------------------------------------------
	// Sync validation
	// -----------------------------------------------------------------------

	it("sync validation runs on set and reports errors", () => {
		const field = formField("", {
			validate: (v) => (v.length < 3 ? "Too short" : true),
		});

		// Initial value fails validation
		expect(field.error.get()).toBe("Too short");
		expect(field.valid.get()).toBe(false);

		field.set("abc");
		expect(field.error.get()).toBe("");
		expect(field.valid.get()).toBe(true);

		field.set("ab");
		expect(field.error.get()).toBe("Too short");
		expect(field.valid.get()).toBe(false);
	});

	it("sync validation returning undefined means valid", () => {
		const field = formField("ok", {
			validate: () => undefined,
		});

		expect(field.error.get()).toBe("");
		expect(field.valid.get()).toBe(true);
	});

	// -----------------------------------------------------------------------
	// Async validation
	// -----------------------------------------------------------------------

	it("async validation runs after debounce", async () => {
		const field = formField("", {
			asyncValidate: async (value, _signal) => {
				if (value === "taken") return "Already taken";
				return undefined;
			},
			debounceMs: 100,
		});

		field.set("taken");

		// Before debounce
		expect(field.validating.get()).toBe(true);
		expect(field.error.get()).toBe("");

		// After debounce
		vi.advanceTimersByTime(100);
		await vi.waitFor(() => {
			expect(field.validating.get()).toBe(false);
		});
		expect(field.error.get()).toBe("Already taken");
	});

	it("async validation cancels previous on new value", async () => {
		const calls: string[] = [];

		const field = formField("", {
			asyncValidate: async (value, signal) => {
				calls.push(value);
				await new Promise((r) => setTimeout(r, 100));
				if (signal.aborted) return undefined;
				return value === "bad" ? "error" : undefined;
			},
			debounceMs: 50,
		});

		field.set("first");
		vi.advanceTimersByTime(50); // debounce fires for "first"

		// Change value before async completes — cancels previous
		field.set("bad");
		vi.advanceTimersByTime(50); // debounce fires for "bad"
		vi.advanceTimersByTime(100); // async for "bad" completes

		await vi.waitFor(() => {
			expect(field.validating.get()).toBe(false);
		});
		expect(field.error.get()).toBe("error");
	});

	it("validating state is true during async validation", async () => {
		const field = formField("", {
			asyncValidate: async () => {
				await new Promise((r) => setTimeout(r, 200));
				return undefined;
			},
			debounceMs: 50,
		});

		field.set("test");
		expect(field.validating.get()).toBe(true);

		vi.advanceTimersByTime(50); // debounce fires
		expect(field.validating.get()).toBe(true);

		vi.advanceTimersByTime(200); // async completes
		await vi.waitFor(() => {
			expect(field.validating.get()).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// Valid store
	// -----------------------------------------------------------------------

	it("valid is derived from error being empty", () => {
		const field = formField(0, {
			validate: (v) => (v < 0 ? "Negative" : true),
		});

		expect(field.valid.get()).toBe(true);

		field.set(-1);
		expect(field.valid.get()).toBe(false);

		field.set(1);
		expect(field.valid.get()).toBe(true);
	});

	// -----------------------------------------------------------------------
	// Reset
	// -----------------------------------------------------------------------

	it("reset restores initial value and clears all state", () => {
		const field = formField("initial", {
			validate: (v) => (v.length < 3 ? "Too short" : true),
		});

		field.set("changed value");
		field.touch();

		expect(field.dirty.get()).toBe(true);
		expect(field.touched.get()).toBe(true);

		field.reset();

		expect(field.value.get()).toBe("initial");
		expect(field.dirty.get()).toBe(false);
		expect(field.touched.get()).toBe(false);
		expect(field.error.get()).toBe("");
		expect(field.validating.get()).toBe(false);
	});

	it("reset cancels pending async validation", async () => {
		let _callCount = 0;
		const field = formField("", {
			asyncValidate: async () => {
				_callCount++;
				await new Promise((r) => setTimeout(r, 200));
				return "error";
			},
			debounceMs: 50,
		});

		field.set("test");
		vi.advanceTimersByTime(50);

		field.reset();

		vi.advanceTimersByTime(200);
		await vi.waitFor(() => {
			expect(field.validating.get()).toBe(false);
		});
		expect(field.error.get()).toBe("");
	});
});
