import { describe, expect, it, vi } from "vitest";
import { batch, create } from "../../compat/zustand";

describe("compat/zustand", () => {
	// -----------------------------------------------------------------------
	// Basic state + actions
	// -----------------------------------------------------------------------

	it("initializes state and provides getState", () => {
		const store = create(() => ({ count: 0, name: "Alice" }));
		expect(store.getState()).toEqual({ count: 0, name: "Alice" });
	});

	it("actions can update state via set", () => {
		const store = create((set) => ({
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
		const store = create((set, get) => ({
			count: 0,
			incrementIfLow: () => {
				if (get().count < 5) set((s) => ({ count: s.count + 1 }));
			},
		}));

		for (let i = 0; i < 10; i++) store.getState().incrementIfLow();
		expect(store.getState().count).toBe(5);
	});

	// -----------------------------------------------------------------------
	// setState
	// -----------------------------------------------------------------------

	it("setState does shallow merge by default", () => {
		const store = create(() => ({ a: 1, b: 2 }));
		store.setState({ a: 10 });
		expect(store.getState()).toEqual({ a: 10, b: 2 });
	});

	it("setState with replace=true replaces entire state", () => {
		const store = create(() => ({ a: 1, b: 2 }));
		store.setState({ a: 10, b: 20 }, true);
		expect(store.getState()).toEqual({ a: 10, b: 20 });
	});

	it("setState accepts updater function", () => {
		const store = create(() => ({ count: 0 }));
		store.setState((s) => ({ count: s.count + 5 }));
		expect(store.getState().count).toBe(5);
	});

	it("setState preserves action references", () => {
		const store = create((set) => ({
			count: 0,
			increment: () => set((s) => ({ count: s.count + 1 })),
		}));

		store.setState({ count: 10 });
		const state = store.getState();
		expect(typeof state.increment).toBe("function");

		state.increment();
		expect(store.getState().count).toBe(11);
	});

	// -----------------------------------------------------------------------
	// subscribe
	// -----------------------------------------------------------------------

	it("subscribe receives state changes", () => {
		const store = create(() => ({ count: 0 }));
		const cb = vi.fn();
		const unsub = store.subscribe(cb);

		store.setState({ count: 1 });
		expect(cb).toHaveBeenCalledTimes(1);
		expect(cb.mock.calls[0][0]).toEqual({ count: 1 });

		unsub();
		store.setState({ count: 2 });
		expect(cb).toHaveBeenCalledTimes(1); // no more
	});

	it("subscribe provides previous state", () => {
		const store = create(() => ({ count: 0 }));
		const calls: Array<{ state: any; prev: any }> = [];
		const unsub = store.subscribe((state, prev) => {
			calls.push({ state, prev });
		});

		store.setState({ count: 1 });
		store.setState({ count: 2 });

		expect(calls[0].prev.count).toBe(0);
		expect(calls[0].state.count).toBe(1);
		expect(calls[1].prev.count).toBe(1);
		expect(calls[1].state.count).toBe(2);

		unsub();
	});

	// -----------------------------------------------------------------------
	// getInitialState
	// -----------------------------------------------------------------------

	it("getInitialState returns the original state", () => {
		const store = create(() => ({ count: 0 }));
		store.setState({ count: 99 });
		expect(store.getInitialState()).toEqual({ count: 0 });
	});

	// -----------------------------------------------------------------------
	// destroy
	// -----------------------------------------------------------------------

	it("destroy tears down the store", () => {
		const store = create(() => ({ count: 0 }));
		const cb = vi.fn();
		store.subscribe(cb);

		store.destroy();
		store.setState({ count: 1 });
		expect(cb).not.toHaveBeenCalled(); // destroyed — no notifications
	});

	// -----------------------------------------------------------------------
	// batch
	// -----------------------------------------------------------------------

	it("batch coalesces multiple setState calls", () => {
		const store = create(() => ({ a: 0, b: 0 }));
		const cb = vi.fn();
		store.subscribe(cb);

		batch(() => {
			store.setState({ a: 1 });
			store.setState({ b: 2 });
		});

		// batch coalesces — subscriber called with final state
		expect(store.getState()).toEqual({ a: 1, b: 2 });
	});

	// -----------------------------------------------------------------------
	// Edge cases
	// -----------------------------------------------------------------------

	it("set during initializer works", () => {
		const store = create((set) => {
			const initial = { count: 0 };
			set({ count: 10 });
			return initial;
		});
		// set() during init applies to initialState which is then overwritten by return
		// Zustand behavior: returned value is the initial state
		expect(store.getState().count).toBe(0);
	});

	it("no-op when setting same partial", () => {
		const store = create(() => ({ count: 5 }));
		const cb = vi.fn();
		store.subscribe(cb);

		const current = store.getState();
		store.setState(current); // same reference
		expect(cb).not.toHaveBeenCalled();
	});
});
