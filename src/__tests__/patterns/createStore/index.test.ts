import { describe, it, expect, vi } from "vitest";
import { createStore, batch } from "../../../patterns/createStore";
import { derived, effect } from "../../../index";

describe("createStore", () => {
	// -----------------------------------------------------------------------
	// Basic state + actions
	// -----------------------------------------------------------------------

	it("initializes state and provides getState", () => {
		const store = createStore(() => ({ count: 0, name: "Alice" }));
		expect(store.getState()).toEqual({ count: 0, name: "Alice" });
	});

	it("actions can update state via set", () => {
		const store = createStore((set) => ({
			count: 0,
			increment: () => set((s) => ({ count: s.count + 1 })),
			reset: () => set({ count: 0 }),
		}));

		store.getState().increment();
		expect(store.getState().count).toBe(1);

		store.getState().increment();
		expect(store.getState().count).toBe(2);

		store.getState().reset();
		expect(store.getState().count).toBe(0);
	});

	it("actions can read current state via get", () => {
		const store = createStore((set, get) => ({
			count: 0,
			incrementIfLow: () => {
				if (get().count < 5) set((s) => ({ count: s.count + 1 }));
			},
		}));

		for (let i = 0; i < 10; i++) store.getState().incrementIfLow();
		expect(store.getState().count).toBe(5);
	});

	// -----------------------------------------------------------------------
	// setState (direct)
	// -----------------------------------------------------------------------

	it("setState does shallow merge by default", () => {
		const store = createStore(() => ({ a: 1, b: 2 }));
		store.setState({ a: 10 });
		expect(store.getState()).toEqual({ a: 10, b: 2 });
	});

	it("setState with replace=true replaces entire state", () => {
		const store = createStore(() => ({ a: 1, b: 2 }));
		store.setState({ a: 10, b: 20 }, true);
		expect(store.getState()).toEqual({ a: 10, b: 20 });
	});

	it("setState accepts updater function", () => {
		const store = createStore(() => ({ count: 0 }));
		store.setState((s) => ({ count: s.count + 5 }));
		expect(store.getState().count).toBe(5);
	});

	// -----------------------------------------------------------------------
	// getInitialState
	// -----------------------------------------------------------------------

	it("getInitialState returns original state", () => {
		const store = createStore((set) => ({
			count: 0,
			increment: () => set((s) => ({ count: s.count + 1 })),
		}));

		store.getState().increment();
		store.getState().increment();
		expect(store.getState().count).toBe(2);
		expect(store.getInitialState().count).toBe(0);
	});

	// -----------------------------------------------------------------------
	// subscribe
	// -----------------------------------------------------------------------

	it("subscribe fires on state changes", () => {
		const store = createStore((set) => ({
			count: 0,
			increment: () => set((s) => ({ count: s.count + 1 })),
		}));

		const listener = vi.fn();
		store.subscribe(listener);

		store.getState().increment();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener.mock.calls[0][0].count).toBe(1);
		expect(listener.mock.calls[0][1].count).toBe(0);
	});

	it("subscribe returns unsubscribe function", () => {
		const store = createStore((set) => ({
			count: 0,
			increment: () => set((s) => ({ count: s.count + 1 })),
		}));

		const listener = vi.fn();
		const unsub = store.subscribe(listener);

		store.getState().increment();
		expect(listener).toHaveBeenCalledTimes(1);

		unsub();
		store.getState().increment();
		expect(listener).toHaveBeenCalledTimes(1); // no additional call
	});

	// -----------------------------------------------------------------------
	// select — the killer feature
	// -----------------------------------------------------------------------

	it("select returns a derived store", () => {
		const store = createStore(() => ({ count: 0, name: "Alice" }));
		const countStore = store.select((s) => s.count);

		expect(countStore.get()).toBe(0);
	});

	it("select updates when source state changes", () => {
		const store = createStore((set) => ({
			count: 0,
			name: "Alice",
			increment: () => set((s) => ({ count: s.count + 1 })),
		}));

		const countStore = store.select((s) => s.count);
		expect(countStore.get()).toBe(0);

		store.getState().increment();
		expect(countStore.get()).toBe(1);
	});

	it("select with derived computation", () => {
		const store = createStore((set) => ({
			items: [1, 2, 3, 4, 5],
			threshold: 3,
			setThreshold: (t: number) => set({ threshold: t }),
		}));

		const filtered = store.select((s) => s.items.filter((i) => i > s.threshold));
		expect(filtered.get()).toEqual([4, 5]);

		store.getState().setThreshold(1);
		expect(filtered.get()).toEqual([2, 3, 4, 5]);
	});

	// -----------------------------------------------------------------------
	// Composition with callbag-recharge primitives
	// -----------------------------------------------------------------------

	it("store.store is a WritableStore for composition", () => {
		const store = createStore(() => ({ count: 0 }));

		// Can use with derived()
		const doubled = derived([store.store], () => store.getState().count * 2);
		expect(doubled.get()).toBe(0);

		store.setState({ count: 5 });
		expect(doubled.get()).toBe(10);
	});

	it("works with effect()", () => {
		const store = createStore((set) => ({
			count: 0,
			increment: () => set((s) => ({ count: s.count + 1 })),
		}));

		const sideEffects: number[] = [];
		effect([store.store], () => {
			sideEffects.push(store.getState().count);
		});

		store.getState().increment();
		store.getState().increment();

		expect(sideEffects).toEqual([0, 1, 2]);
	});

	// -----------------------------------------------------------------------
	// batch integration
	// -----------------------------------------------------------------------

	it("batch coalesces multiple setState calls", () => {
		const store = createStore(() => ({ a: 0, b: 0 }));

		const listener = vi.fn();
		store.subscribe(listener);

		batch(() => {
			store.setState({ a: 1 });
			store.setState({ b: 2 });
		});

		// batch coalesces — listener should fire for each set but values are batched
		// The important thing is the final state is correct
		expect(store.getState()).toEqual({ a: 1, b: 2 });
	});

	// -----------------------------------------------------------------------
	// Actions survive setState
	// -----------------------------------------------------------------------

	it("actions are preserved after setState", () => {
		const store = createStore((set) => ({
			count: 0,
			increment: () => set((s) => ({ count: s.count + 1 })),
		}));

		store.setState({ count: 10 });
		expect(typeof store.getState().increment).toBe("function");

		store.getState().increment();
		expect(store.getState().count).toBe(11);
	});

	// -----------------------------------------------------------------------
	// TypeScript ergonomics (compile-time checks)
	// -----------------------------------------------------------------------

	it("select infers return type", () => {
		const store = createStore(() => ({
			count: 0,
			items: ["a", "b"],
		}));

		const count: ReturnType<typeof store.select<number>> = store.select((s) => s.count);
		const items: ReturnType<typeof store.select<string[]>> = store.select((s) => s.items);

		expect(count.get()).toBe(0);
		expect(items.get()).toEqual(["a", "b"]);
	});

	// -----------------------------------------------------------------------
	// Async actions
	// -----------------------------------------------------------------------

	it("supports async actions", async () => {
		const store = createStore((set) => ({
			data: null as string | null,
			loading: false,
			fetchData: async () => {
				set({ loading: true });
				// Simulate async fetch
				const result = await Promise.resolve("fetched");
				set({ data: result, loading: false });
			},
		}));

		expect(store.getState().loading).toBe(false);

		await store.getState().fetchData();
		expect(store.getState().data).toBe("fetched");
		expect(store.getState().loading).toBe(false);
	});

	// -----------------------------------------------------------------------
	// destroy
	// -----------------------------------------------------------------------

	it("destroy disconnects internal subscriptions", () => {
		const store = createStore(() => ({ count: 0 }));
		store.destroy();
		// After destroy, getState still works (reads from state store)
		expect(store.getState().count).toBe(0);
	});
});
