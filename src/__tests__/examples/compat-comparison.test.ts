import { describe, expect, it } from "vitest";
import { atom } from "../../compat/jotai/index";
import { Signal } from "../../compat/signals/index";
import { create } from "../../compat/zustand/index";
import { Inspector } from "../../core/inspector";
import { derived, state } from "../../index";

describe("compat-comparison example", () => {
	describe("native API", () => {
		it("creates a counter with initial value 0 and derived doubled", () => {
			const count = state(0, { name: "test.native.count" });
			const doubled = derived([count], () => count.get() * 2, { name: "test.native.doubled" });

			expect(count.get()).toBe(0);
			expect(doubled.get()).toBe(0);
		});

		it("increments, decrements, and resets", () => {
			const count = state(0);
			const doubled = derived([count], () => count.get() * 2);

			const obs = Inspector.observe(doubled);

			count.update((n) => n + 1);
			expect(count.get()).toBe(1);
			expect(doubled.get()).toBe(2);

			count.update((n) => n + 1);
			expect(count.get()).toBe(2);
			expect(doubled.get()).toBe(4);

			count.update((n) => n - 1);
			expect(count.get()).toBe(1);
			expect(doubled.get()).toBe(2);

			count.set(0);
			expect(count.get()).toBe(0);
			expect(doubled.get()).toBe(0);

			obs.dispose();
		});
	});

	describe("Jotai compat API", () => {
		it("creates atoms with initial value 0 and derived doubled", () => {
			const countAtom = atom(0);
			const doubledAtom = atom((get) => get(countAtom) * 2);

			expect(countAtom.get()).toBe(0);
			expect(doubledAtom.get()).toBe(0);
		});

		it("increments, decrements, and resets", () => {
			const countAtom = atom(0);
			const doubledAtom = atom((get) => get(countAtom) * 2);

			// Activate the derived atom's inner store so it stays live
			const obs = Inspector.observe(doubledAtom._store);

			countAtom.update((n) => n + 1);
			expect(countAtom.get()).toBe(1);
			expect(doubledAtom.get()).toBe(2);

			countAtom.update((n) => n - 1);
			expect(countAtom.get()).toBe(0);
			expect(doubledAtom.get()).toBe(0);

			countAtom.set(0);
			expect(countAtom.get()).toBe(0);

			obs.dispose();
		});
	});

	describe("Zustand compat API", () => {
		it("creates a store with count 0 and increment/decrement/reset", () => {
			const store = create<{
				count: number;
				doubled: number;
				increment: () => void;
				decrement: () => void;
				reset: () => void;
			}>((set, _get) => ({
				count: 0,
				doubled: 0,
				increment: () => set((s) => ({ count: s.count + 1, doubled: (s.count + 1) * 2 })),
				decrement: () => set((s) => ({ count: s.count - 1, doubled: (s.count - 1) * 2 })),
				reset: () => set({ count: 0, doubled: 0 }),
			}));

			expect(store.getState().count).toBe(0);
			expect(store.getState().doubled).toBe(0);

			store.getState().increment();
			expect(store.getState().count).toBe(1);
			expect(store.getState().doubled).toBe(2);

			store.getState().increment();
			expect(store.getState().count).toBe(2);
			expect(store.getState().doubled).toBe(4);

			store.getState().decrement();
			expect(store.getState().count).toBe(1);
			expect(store.getState().doubled).toBe(2);

			store.getState().reset();
			expect(store.getState().count).toBe(0);
			expect(store.getState().doubled).toBe(0);
		});
	});

	describe("TC39 Signals compat API", () => {
		it("creates signal state and computed with initial values", () => {
			const count = new Signal.State(0);
			const doubled = new Signal.Computed(() => count.get() * 2, [count]);

			expect(count.get()).toBe(0);
			expect(doubled.get()).toBe(0);
		});

		it("increments, decrements, and resets", () => {
			const count = new Signal.State(0);
			const doubled = new Signal.Computed(() => count.get() * 2, [count]);

			count.set(count.get() + 1);
			expect(count.get()).toBe(1);
			expect(doubled.get()).toBe(2);

			count.set(count.get() + 1);
			expect(count.get()).toBe(2);
			expect(doubled.get()).toBe(4);

			count.set(count.get() - 1);
			expect(count.get()).toBe(1);
			expect(doubled.get()).toBe(2);

			count.set(0);
			expect(count.get()).toBe(0);
			expect(doubled.get()).toBe(0);
		});
	});
});
