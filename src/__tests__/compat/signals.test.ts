import { describe, expect, it, vi } from "vitest";
import { batch, Signal, signalEffect } from "../../compat/signals";
import { teardown } from "../../core/protocol";

describe("compat/signals", () => {
	// -----------------------------------------------------------------------
	// Signal.State
	// -----------------------------------------------------------------------

	describe("Signal.State", () => {
		it("initializes with a value", () => {
			const s = new Signal.State(42);
			expect(s.get()).toBe(42);
		});

		it("set updates the value", () => {
			const s = new Signal.State(0);
			s.set(10);
			expect(s.get()).toBe(10);
		});

		it("custom equals prevents redundant updates", () => {
			const s = new Signal.State({ x: 1, y: 2 }, { equals: (a, b) => a.x === b.x && a.y === b.y });

			const cb = vi.fn();
			const watcher = new Signal.subtle.Watcher(cb);
			watcher.watch(s);

			s.set({ x: 1, y: 2 }); // same values
			expect(cb).not.toHaveBeenCalled();

			s.set({ x: 3, y: 4 }); // different
			expect(cb).toHaveBeenCalled();

			watcher.unwatch(s);
		});
	});

	// -----------------------------------------------------------------------
	// Signal.Computed
	// -----------------------------------------------------------------------

	describe("Signal.Computed", () => {
		it("computes from a single state", () => {
			const count = new Signal.State(3);
			const doubled = new Signal.Computed(() => count.get() * 2, [count]);
			expect(doubled.get()).toBe(6);
		});

		it("recomputes when dependency changes", () => {
			const count = new Signal.State(1);
			const doubled = new Signal.Computed(() => count.get() * 2, [count]);

			count.set(5);
			expect(doubled.get()).toBe(10);
		});

		it("computes from multiple states", () => {
			const a = new Signal.State(2);
			const b = new Signal.State(3);
			const sum = new Signal.Computed(() => a.get() + b.get(), [a, b]);
			expect(sum.get()).toBe(5);

			a.set(10);
			expect(sum.get()).toBe(13);
		});

		it("chains computed signals", () => {
			const a = new Signal.State(1);
			const b = new Signal.Computed(() => a.get() * 2, [a]);
			const c = new Signal.Computed(() => b.get() + 10, [b]);

			expect(c.get()).toBe(12);

			a.set(5);
			expect(c.get()).toBe(20);
		});

		it("diamond resolution computes once", () => {
			const a = new Signal.State(1);
			const b = new Signal.Computed(() => a.get() * 2, [a]);
			const c = new Signal.Computed(() => a.get() + 10, [a]);
			let dCount = 0;
			const d = new Signal.Computed(() => {
				dCount++;
				return b.get() + c.get();
			}, [b, c]);

			// Initial computation
			expect(d.get()).toBe(13); // (1*2) + (1+10)

			// Use effect to trigger push-based computation
			const dispose = signalEffect([d], () => {});
			dCount = 0; // reset after effect subscription connects

			a.set(5);
			expect(d.get()).toBe(25); // (5*2) + (5+10) = 10 + 15
			expect(dCount).toBe(1); // computed exactly once per upstream change

			dispose();
		});

		it("custom equals on computed", () => {
			const count = new Signal.State(1);
			const isPositive = new Signal.Computed(() => count.get() > 0, [count], {
				equals: Object.is,
			});

			const cb = vi.fn();
			const watcher = new Signal.subtle.Watcher(cb);
			watcher.watch(isPositive);

			// Need to subscribe to trigger push
			const dispose = signalEffect([isPositive], () => {});

			count.set(2); // still true
			expect(cb).not.toHaveBeenCalled();

			count.set(-1); // now false
			expect(cb).toHaveBeenCalled();

			watcher.unwatch(isPositive);
			dispose();
		});
	});

	// -----------------------------------------------------------------------
	// Signal.subtle.Watcher
	// -----------------------------------------------------------------------

	describe("Signal.subtle.Watcher", () => {
		it("notifies on state change", () => {
			const count = new Signal.State(0);
			const cb = vi.fn();
			const watcher = new Signal.subtle.Watcher(cb);
			watcher.watch(count);

			count.set(1);
			expect(cb).toHaveBeenCalledTimes(1);

			count.set(2);
			expect(cb).toHaveBeenCalledTimes(2);

			watcher.unwatch(count);
			count.set(3);
			expect(cb).toHaveBeenCalledTimes(2); // no more
		});

		it("watches multiple signals", () => {
			const a = new Signal.State(0);
			const b = new Signal.State(0);
			const cb = vi.fn();
			const watcher = new Signal.subtle.Watcher(cb);
			watcher.watch(a, b);

			a.set(1);
			expect(cb).toHaveBeenCalledTimes(1);

			b.set(1);
			expect(cb).toHaveBeenCalledTimes(2);

			watcher.unwatch(a, b);
		});

		it("does not double-watch", () => {
			const a = new Signal.State(0);
			const cb = vi.fn();
			const watcher = new Signal.subtle.Watcher(cb);
			watcher.watch(a);
			watcher.watch(a); // duplicate

			a.set(1);
			expect(cb).toHaveBeenCalledTimes(1); // not 2

			watcher.unwatch(a);
		});

		it("getPending returns empty when no changes", () => {
			const watcher = new Signal.subtle.Watcher(() => {});
			expect(watcher.getPending()).toEqual([]);
		});

		it("getPending returns changed signals and clears", () => {
			const a = new Signal.State(0);
			const b = new Signal.State(0);
			const watcher = new Signal.subtle.Watcher(() => {});
			watcher.watch(a, b);

			a.set(1);
			const pending1 = watcher.getPending();
			expect(pending1).toEqual([a]);

			// Second call returns empty — cleared after read
			expect(watcher.getPending()).toEqual([]);

			// Both change
			a.set(2);
			b.set(2);
			const pending2 = watcher.getPending();
			expect(pending2).toHaveLength(2);
			expect(pending2).toContain(a);
			expect(pending2).toContain(b);

			watcher.unwatch(a, b);
		});

		it("auto-cleans up when watched store completes", () => {
			const a = new Signal.State(0);
			const cb = vi.fn();
			const watcher = new Signal.subtle.Watcher(cb);
			watcher.watch(a);

			a.set(1);
			expect(cb).toHaveBeenCalledTimes(1);

			// Simulate store completion via teardown
			teardown(a._store);

			// After completion, the watcher entry should have been auto-removed
			// getPending should not contain the completed signal
			expect(watcher.getPending()).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// Signal.subtle.untrack
	// -----------------------------------------------------------------------

	describe("Signal.subtle.untrack", () => {
		it("runs function and returns result", () => {
			const result = Signal.subtle.untrack(() => 42);
			expect(result).toBe(42);
		});
	});

	// -----------------------------------------------------------------------
	// signalEffect
	// -----------------------------------------------------------------------

	describe("signalEffect", () => {
		it("runs immediately and on changes", () => {
			const count = new Signal.State(0);
			let runs = 0;
			const dispose = signalEffect([count], () => {
				runs++;
				return undefined;
			});

			expect(runs).toBe(1); // immediate

			count.set(1);
			expect(runs).toBe(2);

			dispose();
			count.set(2);
			expect(runs).toBe(2); // disposed
		});

		it("cleanup runs before next execution", () => {
			const count = new Signal.State(0);
			const log: string[] = [];
			const dispose = signalEffect([count], () => {
				log.push("run");
				return () => log.push("cleanup");
			});

			expect(log).toEqual(["run"]);

			count.set(1);
			expect(log).toEqual(["run", "cleanup", "run"]);

			dispose();
			expect(log).toEqual(["run", "cleanup", "run", "cleanup"]);
		});
	});

	// -----------------------------------------------------------------------
	// batch
	// -----------------------------------------------------------------------

	describe("batch", () => {
		it("coalesces multiple updates", () => {
			const a = new Signal.State(0);
			const b = new Signal.State(0);
			const sum = new Signal.Computed(() => a.get() + b.get(), [a, b]);

			let runs = 0;
			const dispose = signalEffect([sum], () => {
				runs++;
			});
			runs = 0;

			batch(() => {
				a.set(10);
				b.set(20);
			});

			expect(runs).toBe(1); // once, not twice
			expect(sum.get()).toBe(30);

			dispose();
		});
	});
});
