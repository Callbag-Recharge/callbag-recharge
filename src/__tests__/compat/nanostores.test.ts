import { describe, expect, it, vi } from "vitest";
import { atom, computed, map } from "../../compat/nanostores";

describe("compat/nanostores", () => {
	// -----------------------------------------------------------------------
	// atom
	// -----------------------------------------------------------------------

	describe("atom", () => {
		it("initializes with a value", () => {
			const a = atom(42);
			expect(a.get()).toBe(42);
		});

		it("set updates the value", () => {
			const a = atom(0);
			a.set(5);
			expect(a.get()).toBe(5);
		});

		it("subscribe calls immediately with current value then on changes", () => {
			const a = atom(10);
			const values: number[] = [];
			const unsub = a.subscribe((v) => values.push(v));

			expect(values).toEqual([10]); // immediate call

			a.set(20);
			expect(values).toEqual([10, 20]);

			a.set(30);
			expect(values).toEqual([10, 20, 30]);

			unsub();
			a.set(40);
			expect(values).toEqual([10, 20, 30]); // no more calls
		});

		it("listen does NOT call immediately, only on changes", () => {
			const a = atom(10);
			const values: number[] = [];
			const unsub = a.listen((v) => values.push(v));

			expect(values).toEqual([]); // no immediate call

			a.set(20);
			expect(values).toEqual([20]);

			unsub();
			a.set(30);
			expect(values).toEqual([20]);
		});

		it("exposes underlying store", () => {
			const a = atom(1);
			expect(a.store).toBeDefined();
			expect(a.store.get()).toBe(1);
		});

		it("subscribe does not lose emissions from mutation inside cb", () => {
			const a = atom(0);
			const values: number[] = [];
			a.subscribe((v) => {
				values.push(v);
				// Mutate inside the immediate cb — should be captured
				if (v === 0) a.set(1);
			});

			// subscribe fires cb(0) immediately, which sets to 1
			// The set(1) should be captured by the subscription
			expect(values).toContain(0);
			expect(values).toContain(1);
		});

		it("equality guard skips duplicate values", () => {
			const a = atom(5);
			const cb = vi.fn();
			a.listen(cb);

			a.set(5); // same value
			expect(cb).not.toHaveBeenCalled();

			a.set(6);
			expect(cb).toHaveBeenCalledWith(6);
		});
	});

	// -----------------------------------------------------------------------
	// computed
	// -----------------------------------------------------------------------

	describe("computed", () => {
		it("computes from a single atom", () => {
			const count = atom(3);
			const doubled = computed(count, (v) => v * 2);
			expect(doubled.get()).toBe(6);
		});

		it("recomputes when dependency changes", () => {
			const count = atom(1);
			const doubled = computed(count, (v) => v * 2);

			count.set(5);
			expect(doubled.get()).toBe(10);
		});

		it("computes from multiple atoms", () => {
			const a = atom(2);
			const b = atom(3);
			const sum = computed([a, b], (x, y) => x + y);
			expect(sum.get()).toBe(5);

			a.set(10);
			expect(sum.get()).toBe(13);
		});

		it("computes from three atoms", () => {
			const a = atom(1);
			const b = atom(2);
			const c = atom(3);
			const total = computed([a, b, c], (x, y, z) => x + y + z);
			expect(total.get()).toBe(6);

			c.set(10);
			expect(total.get()).toBe(13);
		});

		it("subscribe calls immediately then on changes", () => {
			const count = atom(0);
			const doubled = computed(count, (v) => v * 2);
			const values: number[] = [];
			const unsub = doubled.subscribe((v) => values.push(v));

			expect(values).toEqual([0]); // immediate

			count.set(3);
			expect(values).toEqual([0, 6]);

			unsub();
			count.set(5);
			expect(values).toEqual([0, 6]);
		});

		it("listen does not call immediately", () => {
			const count = atom(0);
			const doubled = computed(count, (v) => v * 2);
			const values: number[] = [];
			const unsub = doubled.listen((v) => values.push(v));

			expect(values).toEqual([]);

			count.set(3);
			expect(values).toEqual([6]);

			unsub();
		});

		it("push-phase memoization with equals", () => {
			const count = atom(1);
			const isPositive = computed(count, (v) => v > 0);
			const cb = vi.fn();
			isPositive.listen(cb);

			count.set(2); // still positive — equals(true, true) = true
			expect(cb).not.toHaveBeenCalled();

			count.set(-1); // now false
			expect(cb).toHaveBeenCalledWith(false);
		});
	});

	// -----------------------------------------------------------------------
	// map
	// -----------------------------------------------------------------------

	describe("map", () => {
		it("initializes with an object", () => {
			const m = map({ name: "Alice", age: 30 });
			expect(m.get()).toEqual({ name: "Alice", age: 30 });
		});

		it("set replaces the entire object", () => {
			const m = map({ name: "Alice", age: 30 });
			m.set({ name: "Bob", age: 25 });
			expect(m.get()).toEqual({ name: "Bob", age: 25 });
		});

		it("setKey updates a single key", () => {
			const m = map({ name: "Alice", age: 30 });
			m.setKey("age", 31);
			expect(m.get()).toEqual({ name: "Alice", age: 31 });
		});

		it("setKey preserves other keys", () => {
			const m = map({ x: 1, y: 2, z: 3 });
			m.setKey("y", 20);
			expect(m.get()).toEqual({ x: 1, y: 20, z: 3 });
		});

		it("subscribe calls immediately then on changes", () => {
			const m = map({ count: 0 });
			const values: Array<{ count: number }> = [];
			const unsub = m.subscribe((v) => values.push(v));

			expect(values).toEqual([{ count: 0 }]);

			m.setKey("count", 5);
			expect(values.length).toBe(2);
			expect(values[1]).toEqual({ count: 5 });

			unsub();
		});

		it("listen does not call immediately", () => {
			const m = map({ count: 0 });
			const cb = vi.fn();
			const unsub = m.listen(cb);

			expect(cb).not.toHaveBeenCalled();

			m.setKey("count", 1);
			expect(cb).toHaveBeenCalledTimes(1);

			unsub();
		});

		it("setKey always triggers (no equality guard for map)", () => {
			const m = map({ count: 0 });
			const cb = vi.fn();
			m.listen(cb);

			m.setKey("count", 0); // same value but map always triggers
			expect(cb).toHaveBeenCalledTimes(1);
		});
	});
});
