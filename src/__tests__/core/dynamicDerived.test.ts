import { beforeEach, describe, expect, it, vi } from "vitest";
import { dynamicDerived } from "../../core/dynamicDerived";
import { Inspector } from "../../core/inspector";
import { batch, teardown } from "../../core/protocol";
import { state } from "../../core/state";
import { subscribe } from "../../core/subscribe";

beforeEach(() => {
	Inspector._reset();
});

describe("dynamicDerived", () => {
	// -----------------------------------------------------------------------
	// Basic computation
	// -----------------------------------------------------------------------

	describe("basic", () => {
		it("computes from a single dep", () => {
			const a = state(3);
			const d = dynamicDerived((get) => get(a) * 2);
			expect(d.get()).toBe(6);
		});

		it("computes from multiple deps", () => {
			const a = state(2);
			const b = state(3);
			const d = dynamicDerived((get) => get(a) + get(b));
			expect(d.get()).toBe(5);
		});

		it("recomputes when dep changes (pull)", () => {
			const a = state(1);
			const d = dynamicDerived((get) => get(a) * 10);

			expect(d.get()).toBe(10);
			a.set(5);
			expect(d.get()).toBe(50);
		});

		it("chains dynamicDerived stores", () => {
			const a = state(1);
			const b = dynamicDerived((get) => get(a) * 2);
			const c = dynamicDerived((get) => get(b) + 10);

			expect(c.get()).toBe(12);
			a.set(5);
			expect(c.get()).toBe(20);
		});
	});

	// -----------------------------------------------------------------------
	// Dynamic dep tracking
	// -----------------------------------------------------------------------

	describe("dynamic deps", () => {
		it("tracks conditional deps", () => {
			const flag = state(true);
			const a = state(1);
			const b = state(2);
			const d = dynamicDerived((get) => (get(flag) ? get(a) : get(b)));

			expect(d.get()).toBe(1);

			flag.set(false);
			expect(d.get()).toBe(2);

			b.set(20);
			expect(d.get()).toBe(20);
		});

		it("rewires deps when they change (subscribed)", () => {
			const flag = state(true);
			const a = state(1);
			const b = state(2);
			const d = dynamicDerived((get) => (get(flag) ? get(a) : get(b)));

			const values: number[] = [];
			const unsub = subscribe(d, (v) => values.push(v));

			// Switch to false branch
			flag.set(false);
			expect(values).toContain(2);

			// b changes should propagate
			values.length = 0;
			b.set(20);
			expect(values).toContain(20);

			// a changes should NOT cause recomputation (not tracked)
			values.length = 0;
			a.set(100);
			// result still reads b=20
			expect(d.get()).toBe(20);

			unsub();
		});

		it("deps discovered later are subscribed dynamically", () => {
			const flag = state(false);
			const a = state(10);
			const b = state(20);
			const d = dynamicDerived((get) => {
				if (get(flag)) return get(a) + get(b);
				return get(a);
			});

			const values: number[] = [];
			const unsub = subscribe(d, (v) => values.push(v));

			expect(d.get()).toBe(10);

			// Enable flag — b becomes a dep
			flag.set(true);
			expect(d.get()).toBe(30);

			// b changes should now propagate
			b.set(100);
			expect(d.get()).toBe(110);

			unsub();
		});
	});

	// -----------------------------------------------------------------------
	// Diamond resolution (tier 1)
	// -----------------------------------------------------------------------

	describe("diamond resolution", () => {
		it("recomputes once in a diamond", () => {
			const a = state(1);
			const b = dynamicDerived((get) => get(a) * 2);
			const c = dynamicDerived((get) => get(a) + 10);
			let dCount = 0;
			const d = dynamicDerived((get) => {
				dCount++;
				return get(b) + get(c);
			});

			// Subscribe to activate push path
			const unsub = subscribe(d, () => {});
			dCount = 0;

			a.set(5);
			expect(d.get()).toBe(25); // (5*2) + (5+10) = 10 + 15
			expect(dCount).toBe(1); // computed exactly once

			unsub();
		});

		it("5-branch diamond recomputes once", () => {
			const src = state(1);
			const branches = Array.from({ length: 5 }, (_, i) => dynamicDerived((get) => get(src) + i));
			let leafCount = 0;
			const leaf = dynamicDerived((get) => {
				leafCount++;
				return branches.reduce((sum, b) => sum + get(b), 0);
			});

			const unsub = subscribe(leaf, () => {});
			leafCount = 0;

			src.set(10);
			// branches: 10, 11, 12, 13, 14 → sum = 60
			expect(leaf.get()).toBe(60);
			expect(leafCount).toBe(1);

			unsub();
		});

		it("works with batch", () => {
			const a = state(1);
			const b = state(2);
			const sum = dynamicDerived((get) => get(a) + get(b));
			let computeCount = 0;
			const doubled = dynamicDerived((get) => {
				computeCount++;
				return get(sum) * 2;
			});

			const unsub = subscribe(doubled, () => {});
			computeCount = 0;

			batch(() => {
				a.set(10);
				b.set(20);
			});

			expect(doubled.get()).toBe(60); // (10+20)*2
			expect(computeCount).toBe(1);

			unsub();
		});
	});

	// -----------------------------------------------------------------------
	// Equals / memoization
	// -----------------------------------------------------------------------

	describe("equals option", () => {
		it("suppresses emission when equals returns true", () => {
			const count = state(1);
			const isPositive = dynamicDerived((get) => get(count) > 0, {
				equals: Object.is,
			});

			const cb = vi.fn();
			const unsub = subscribe(isPositive, cb);

			count.set(2); // still true
			expect(cb).not.toHaveBeenCalled();

			count.set(-1); // now false
			expect(cb).toHaveBeenCalledWith(false, true);

			unsub();
		});
	});

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	describe("lifecycle", () => {
		it("disconnects on last unsubscribe", () => {
			const a = state(1);
			const d = dynamicDerived((get) => get(a) * 2);

			const unsub = subscribe(d, () => {});
			unsub();

			// After disconnect, get() should still pull-compute
			a.set(5);
			expect(d.get()).toBe(10);
		});

		it("supports multiple subscribers", () => {
			const a = state(1);
			const d = dynamicDerived((get) => get(a) * 2);

			const v1: number[] = [];
			const v2: number[] = [];
			const unsub1 = subscribe(d, (v) => v1.push(v));
			const unsub2 = subscribe(d, (v) => v2.push(v));

			a.set(5);
			expect(v1).toContain(10);
			expect(v2).toContain(10);

			// Removing one subscriber keeps the other active
			unsub1();
			a.set(10);
			expect(v2).toContain(20);

			unsub2();
		});

		it("handles upstream completion", () => {
			const a = state(1);
			const d = dynamicDerived((get) => get(a) * 2);

			const cb = vi.fn();
			const onEnd = vi.fn();
			subscribe(d, cb, { onEnd });

			teardown(a);
			expect(onEnd).toHaveBeenCalled();
		});

		it("reconnects after full disconnect", () => {
			const a = state(1);
			const d = dynamicDerived((get) => get(a) * 2);

			// First subscription
			const unsub1 = subscribe(d, () => {});
			a.set(5);
			expect(d.get()).toBe(10);
			unsub1();

			// Second subscription — should reconnect
			a.set(3);
			const values: number[] = [];
			const unsub2 = subscribe(d, (v) => values.push(v));
			expect(d.get()).toBe(6);

			a.set(7);
			expect(values).toContain(14);

			unsub2();
		});
	});

	// -----------------------------------------------------------------------
	// Error handling
	// -----------------------------------------------------------------------

	describe("error handling", () => {
		it("propagates fn error via END to subscribers (push path)", () => {
			const flag = state(false);
			const d = dynamicDerived((get) => {
				if (get(flag)) throw new Error("boom");
				return 42;
			});

			const onEnd = vi.fn();
			const unsub = subscribe(d, () => {}, { onEnd });

			expect(d.get()).toBe(42);

			// Trigger error via dep change
			flag.set(true);
			expect(onEnd).toHaveBeenCalledWith(expect.any(Error));
			expect((onEnd.mock.calls[0][0] as Error).message).toBe("boom");

			unsub();
		});

		it("propagates fn error via END on first subscribe (lazyConnect)", () => {
			const d = dynamicDerived(() => {
				throw new Error("init fail");
			});

			const onEnd = vi.fn();
			subscribe(d, () => {}, { onEnd });

			expect(onEnd).toHaveBeenCalledWith(expect.any(Error));
		});

		it("re-throws fn error on disconnected get()", () => {
			const flag = state(true);
			const d = dynamicDerived((get) => {
				if (get(flag)) throw new Error("pull fail");
				return 0;
			});

			expect(() => d.get()).toThrow("pull fail");

			// After error, node is still usable — next get() retries
			flag.set(false);
			expect(d.get()).toBe(0);
		});

		it("late subscriber to errored dynamicDerived receives END(error)", () => {
			const flag = state(false);
			const d = dynamicDerived((get) => {
				if (get(flag)) throw new Error("late-dd");
				return 42;
			});

			const onEnd1 = vi.fn();
			subscribe(d, () => {}, { onEnd: onEnd1 });
			flag.set(true);
			expect(onEnd1).toHaveBeenCalledWith(expect.any(Error));

			// Late subscriber
			const onEnd2 = vi.fn();
			subscribe(d, () => {}, { onEnd: onEnd2 });
			expect(onEnd2).toHaveBeenCalledWith(expect.any(Error));
			expect((onEnd2.mock.calls[0][0] as Error).message).toBe("late-dd");
		});

		it("get() on errored dynamicDerived throws the stored error", () => {
			const flag = state(false);
			const d = dynamicDerived((get) => {
				if (get(flag)) throw new Error("get-dd-err");
				return 0;
			});

			subscribe(d, () => {}, { onEnd: () => {} });
			flag.set(true);

			expect(() => d.get()).toThrow("get-dd-err");
		});
	});
});
