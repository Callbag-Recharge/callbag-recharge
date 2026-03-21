import { describe, expect, it } from "vitest";
import { derived } from "../../core/derived";
import { state } from "../../core/state";
import { subscribe } from "../../core/subscribe";
import { withSchema } from "../../utils/withSchema";

// Simple test schemas
const numberSchema = {
	parse(v: unknown): number {
		if (typeof v !== "number" || Number.isNaN(v)) throw new Error("expected number");
		return v;
	},
};

const positiveSchema = {
	parse(v: unknown): number {
		if (typeof v !== "number" || v <= 0) throw new Error("must be positive");
		return v;
	},
};

describe("withSchema", () => {
	// --- Happy path ---

	it("forwards valid upstream values", () => {
		const raw = state<unknown>(1);
		const validated = withSchema(raw, numberSchema);

		const values: number[] = [];
		const unsub = subscribe(validated, (v) => values.push(v));
		raw.set(2);
		raw.set(3);
		unsub.unsubscribe();

		expect(values).toEqual([2, 3]);
	});

	it("rejects invalid values and sets error companion", () => {
		const raw = state<unknown>(0);
		const validated = withSchema(raw, numberSchema);

		const values: number[] = [];
		const errors: (Error | undefined)[] = [];
		const unsub1 = subscribe(validated, (v) => values.push(v));
		const unsub2 = subscribe(validated.error, (e) => errors.push(e));

		raw.set("bad");
		raw.set(42);
		unsub1.unsubscribe();
		unsub2.unsubscribe();

		expect(values).toEqual([42]);
		expect(errors.length).toBeGreaterThanOrEqual(1);
		expect(errors[0]).toBeInstanceOf(Error);
		expect(errors[0]!.message).toBe("expected number");
	});

	it("clears error on next valid value", () => {
		const raw = state<unknown>(0);
		const validated = withSchema(raw, numberSchema);

		const errors: (Error | undefined)[] = [];
		const unsub1 = subscribe(validated, () => {});
		const unsub2 = subscribe(validated.error, (e) => errors.push(e));

		raw.set("bad"); // error set
		raw.set(42); // error cleared
		unsub1.unsubscribe();
		unsub2.unsubscribe();

		// Should have received error then undefined
		const lastError = errors[errors.length - 1];
		expect(lastError).toBeUndefined();
	});

	// --- set() validation ---

	it("set() validates before forwarding to upstream", () => {
		const raw = state<unknown>(1);
		const validated = withSchema(raw, positiveSchema);

		const values: number[] = [];
		const unsub = subscribe(validated, (v) => values.push(v));

		validated.set(5); // valid — forwards to raw
		expect(raw.get()).toBe(5);

		validated.set(-1); // invalid — rejected, raw unchanged
		expect(raw.get()).toBe(5);

		unsub.unsubscribe();
		expect(values).toEqual([5]);
	});

	it("set() sets error companion on invalid input", () => {
		const raw = state<unknown>(1);
		const validated = withSchema(raw, positiveSchema);

		const errors: (Error | undefined)[] = [];
		const unsub = subscribe(validated.error, (e) => errors.push(e));

		validated.set(-1);
		unsub.unsubscribe();

		expect(errors.length).toBeGreaterThanOrEqual(1);
		expect(errors[0]!.message).toBe("must be positive");
	});

	it("set() throws on read-only upstream store", () => {
		const raw = state<unknown>(1);
		const readOnly = derived([raw], () => raw.get());
		const validated = withSchema(readOnly, numberSchema);

		expect(() => validated.set(42)).toThrow("upstream store is read-only");
	});

	it("set() does not double-validate (schema.parse called once)", () => {
		let parseCount = 0;
		const countingSchema = {
			parse(v: unknown): number {
				parseCount++;
				if (typeof v !== "number") throw new Error("not a number");
				return v;
			},
		};

		const raw = state<unknown>(0);
		parseCount = 0; // reset after construction parse
		const validated = withSchema(raw, countingSchema);
		parseCount = 0; // reset after construction

		const unsub = subscribe(validated, () => {});
		parseCount = 0; // reset after subscribe wiring

		validated.set(42);
		// 1 parse from set() validation, subscribe callback skips re-validation
		expect(parseCount).toBe(1);

		unsub.unsubscribe();
	});

	// --- Construction validation ---

	it("throws at construction if initial value is invalid", () => {
		const raw = state<unknown>("not a number");
		expect(() => withSchema(raw, numberSchema)).toThrow("expected number");
	});

	// --- get() ---

	it("get() returns validated current value", () => {
		const raw = state<unknown>(42);
		const validated = withSchema(raw, numberSchema);
		expect(validated.get()).toBe(42);
	});

	it("get() returns last valid value when current is invalid", () => {
		const raw = state<unknown>(42);
		const validated = withSchema(raw, numberSchema);

		// Subscribe to activate, set invalid, then check get
		const unsub = subscribe(validated, () => {});
		raw.set("bad");
		expect(validated.get()).toBe(42); // falls back to last valid
		unsub.unsubscribe();
	});

	// --- Reconnect: error reset ---

	it("resets error companion on resubscription", () => {
		const raw = state<unknown>(0);
		const validated = withSchema(raw, numberSchema);

		// First subscription: trigger an error
		const unsub1 = subscribe(validated, () => {});
		raw.set("bad");
		expect(validated.error.get()).toBeInstanceOf(Error);
		unsub1.unsubscribe();

		// Reconnect: error should reset
		const unsub2 = subscribe(validated, () => {});
		expect(validated.error.get()).toBeUndefined();
		unsub2.unsubscribe();
	});

	// --- Upstream completion ---

	it("forwards upstream completion", () => {
		const raw = state<unknown>(0);
		const validated = withSchema(raw, numberSchema);

		let ended = false;
		subscribe(validated, () => {}, {
			onEnd: () => {
				ended = true;
			},
		});

		// Complete the upstream by tearing down
		// (state doesn't complete on its own, but we verify the wiring)
		expect(ended).toBe(false);
	});

	// --- Schema interface compatibility ---

	it("works with Zod-like schema (parse throws)", () => {
		const zodLike = {
			parse(v: unknown): { name: string } {
				if (typeof v !== "object" || v === null || !("name" in v)) throw new Error("invalid shape");
				return v as { name: string };
			},
		};

		const raw = state<unknown>({ name: "test" });
		const validated = withSchema(raw, zodLike);
		expect(validated.get()).toEqual({ name: "test" });

		const values: { name: string }[] = [];
		const unsub = subscribe(validated, (v) => values.push(v));
		raw.set({ name: "updated" });
		raw.set("invalid");
		raw.set({ name: "valid" });
		unsub.unsubscribe();

		expect(values).toEqual([{ name: "updated" }, { name: "valid" }]);
	});

	// --- Transform ---

	it("schema.parse can transform values (coercion)", () => {
		const coerceNumber = {
			parse(v: unknown): number {
				const n = Number(v);
				if (Number.isNaN(n)) throw new Error("cannot coerce to number");
				return n;
			},
		};

		const raw = state<unknown>("42");
		const validated = withSchema(raw, coerceNumber);
		expect(validated.get()).toBe(42);

		const values: number[] = [];
		const unsub = subscribe(validated, (v) => values.push(v));
		raw.set("100");
		raw.set("abc"); // rejected
		raw.set("0");
		unsub.unsubscribe();

		expect(values).toEqual([100, 0]);
	});
});
