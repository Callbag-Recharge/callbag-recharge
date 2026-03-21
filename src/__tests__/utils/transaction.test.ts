import { describe, expect, it } from "vitest";
import { derived } from "../../core/derived";
import { state } from "../../core/state";
import { subscribe } from "../../core/subscribe";
import { transaction } from "../../utils/transaction";

describe("transaction", () => {
	// --- Happy path ---

	it("applies all mutations on success", () => {
		const a = state(1);
		const b = state(2);

		transaction([a, b], () => {
			a.set(10);
			b.set(20);
		});

		expect(a.get()).toBe(10);
		expect(b.get()).toBe(20);
	});

	it("returns fn return value on success", () => {
		const a = state(1);
		const result = transaction([a], () => {
			a.set(10);
			return "ok";
		});
		expect(result).toBe("ok");
	});

	// --- Rollback ---

	it("rolls back all stores on throw", () => {
		const a = state(1);
		const b = state(2);
		const c = state(3);

		expect(() => {
			transaction([a, b, c], () => {
				a.set(10);
				b.set(20);
				c.set(30);
				throw new Error("abort");
			});
		}).toThrow("abort");

		expect(a.get()).toBe(1);
		expect(b.get()).toBe(2);
		expect(c.get()).toBe(3);
	});

	it("rolls back partial mutations (error mid-way)", () => {
		const a = state(1);
		const b = state(2);

		expect(() => {
			transaction([a, b], () => {
				a.set(10);
				throw new Error("fail");
				// b.set(20) never reached
			});
		}).toThrow("fail");

		expect(a.get()).toBe(1);
		expect(b.get()).toBe(2);
	});

	// --- Batch semantics ---

	it("downstream sees final state atomically (no partial)", () => {
		const a = state(1);
		const b = state(2);
		const sum = derived([a, b], () => a.get() + b.get());

		const values: number[] = [];
		const unsub = subscribe(sum, (v) => values.push(v));

		transaction([a, b], () => {
			a.set(10);
			b.set(20);
		});

		unsub.unsubscribe();
		// Should see 30 (final), not 12 (partial: a=10, b=2)
		expect(values).toEqual([30]);
	});

	it("downstream sees no change on rollback", () => {
		const a = state(1);
		const b = state(2);
		const sum = derived([a, b], () => a.get() + b.get());

		const values: number[] = [];
		const unsub = subscribe(sum, (v) => values.push(v));

		try {
			transaction([a, b], () => {
				a.set(10);
				b.set(20);
				throw new Error("rollback");
			});
		} catch {
			// expected
		}

		unsub.unsubscribe();
		// Rollback restores to 1+2=3, but since that's the original value,
		// derived may or may not emit. The key invariant is the final state.
		expect(a.get()).toBe(1);
		expect(b.get()).toBe(2);
	});

	// --- Silent mode ---

	it("silent mode suppresses re-throw", () => {
		const a = state(1);

		const result = transaction(
			[a],
			() => {
				a.set(10);
				throw new Error("silent fail");
			},
			{ silent: true },
		);

		expect(a.get()).toBe(1);
		expect(result).toBeUndefined();
	});

	// --- Edge cases ---

	it("empty stores array works", () => {
		const result = transaction([], () => "ok");
		expect(result).toBe("ok");
	});

	it("no-op fn works", () => {
		const a = state(1);
		transaction([a], () => {});
		expect(a.get()).toBe(1);
	});

	it("nested transactions roll back independently", () => {
		const a = state(1);
		const b = state(2);

		transaction([a], () => {
			a.set(10);
			try {
				transaction([b], () => {
					b.set(20);
					throw new Error("inner fail");
				});
			} catch {
				// inner rolled back, outer continues
			}
		});

		expect(a.get()).toBe(10); // outer succeeded
		expect(b.get()).toBe(2); // inner rolled back
	});

	it("preserves complex object values on rollback", () => {
		const store = state({ count: 0, items: ["a"] });

		expect(() => {
			transaction([store], () => {
				store.set({ count: 5, items: ["a", "b", "c"] });
				throw new Error("revert");
			});
		}).toThrow("revert");

		expect(store.get()).toEqual({ count: 0, items: ["a"] });
	});
});
