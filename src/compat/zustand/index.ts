/**
 * Zustand-compatible API built on callbag-recharge primitives.
 *
 * Thin wrapper: a single `state()` with Zustand's `set`/`get` contract.
 * For the full-featured version with `select()` and `destroy()`,
 * use `callbag-recharge/patterns/createStore` instead.
 *
 * @category compat
 */

import { batch, teardown } from "../../core/protocol";
import { state } from "../../core/state";
import { subscribe as coreSubscribe } from "../../core/subscribe";
import type { Store, WritableStore } from "../../core/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SetStateAction<T> = T | Partial<T> | ((state: T) => T | Partial<T>);
type Get<T> = () => T;
type Set<T> = (partial: SetStateAction<T>, replace?: boolean) => void;
type StateCreator<T> = (set: Set<T>, get: Get<T>) => T;

/**
 * Zustand-compatible StoreApi.
 */
export interface StoreApi<T> {
	setState: (partial: SetStateAction<T>, replace?: boolean) => void;
	getState: () => T;
	getInitialState: () => T;
	subscribe: (listener: (state: T, prevState: T) => void) => () => void;
	destroy: () => void;
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

/**
 * Zustand-compatible `create((set, get) => state)`.
 *
 * @param initializer - Receives `set` / `get`; return initial state object.
 *
 * @returns `StoreApi<T>` — `getState`, `setState`, `subscribe`, `getInitialState`, `destroy`.
 *
 * @example
 * ```ts
 * import { create } from 'callbag-recharge/compat/zustand';
 *
 * const useStore = create((set) => ({
 *   count: 0,
 *   increment: () => set((s) => ({ count: s.count + 1 })),
 * }));
 *
 * useStore.getState().increment();
 * useStore.getState().count; // 1
 * ```
 *
 * @category compat
 */
export function create<T extends object>(initializer: StateCreator<T>): StoreApi<T> {
	let source: WritableStore<T> | null = null;
	let initialState: T = undefined as unknown as T;
	let actionKeys: string[] = [];

	const get: Get<T> = () => (source ? (source.get() as T) : initialState);

	const set: Set<T> = (partial, replace) => {
		const prev = get();
		const nextPartial =
			typeof partial === "function" ? (partial as (s: T) => T | Partial<T>)(prev) : partial;

		if (nextPartial === prev && !replace) return;

		if (replace) {
			if (source) source.set(nextPartial as T);
			else initialState = nextPartial as T;
			return;
		}

		const nextState = Object.assign({}, prev, nextPartial) as T;

		for (const key of actionKeys) {
			if (!Object.hasOwn(nextPartial as object, key)) {
				(nextState as any)[key] = (prev as any)[key];
			}
		}

		if (source) source.set(nextState);
		else initialState = nextState;
	};

	initialState = initializer(set, get);

	actionKeys = Object.keys(initialState).filter(
		(k) => typeof (initialState as any)[k] === "function",
	);

	const savedInitial = initialState;

	source = state<T>(initialState);

	return {
		setState: (partial, replace) => set(partial, replace),
		getState: () => source!.get() as T,
		getInitialState: () => savedInitial,
		subscribe: (listener) => {
			const sub = coreSubscribe(source as Store<T>, (value, prev) => {
				listener(value, prev as T);
			});
			return () => sub.unsubscribe();
		},
		destroy: () => teardown(source!),
	};
}

export { batch };
export type { StateCreator, SetStateAction };
