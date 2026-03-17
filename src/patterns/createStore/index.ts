/**
 * createStore — single-store pattern for Zustand/Redux users.
 *
 * Provides a familiar `create((set, get) => ({ ...state, ...actions }))` API
 * backed by callbag-recharge primitives. Key advantage over Zustand:
 * diamond-safe `select()` returns a `Store<U>` with automatic memoization
 * and dependency tracking — no reselect, no useShallow.
 *
 * Zustand StoreApi compatibility: matches `getState`, `setState`, `subscribe`,
 * `getInitialState` — Zustand middleware (persist, devtools, immer) can wrap
 * this store directly.
 */

import { derived } from "../../core/derived";
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
 * Zustand-compatible StoreApi — middleware works if you match this contract.
 */
interface StoreApi<T> {
	setState: (partial: SetStateAction<T>, replace?: boolean) => void;
	getState: () => T;
	getInitialState: () => T;
	subscribe: (listener: (state: T, prevState: T) => void) => () => void;
}

interface CreateStoreResult<T> extends StoreApi<T> {
	/**
	 * Create a diamond-safe derived store from a selector function.
	 * Returns a `Store<U>` that only recomputes when the selected value
	 * actually changes (push-phase memoization via `equals`).
	 *
	 * This is the killer feature over Zustand — selectors are reactive stores
	 * with automatic memoization, not just functions re-evaluated on every render.
	 */
	select<U>(selector: (state: T) => U, equals?: (a: U, b: U) => boolean): Store<U>;

	/**
	 * The underlying callbag-recharge WritableStore.
	 * Use this to compose with other callbag-recharge primitives
	 * (derived, effect, pipe, operators).
	 */
	store: WritableStore<T>;

	/**
	 * Destroy the store — sends END to all downstream subscribers and derived
	 * stores, cascading through the entire subgraph. After destroy, the store
	 * is in COMPLETED state and won't accept new values or subscriptions.
	 */
	destroy: () => void;
}

// ---------------------------------------------------------------------------
// createStore
// ---------------------------------------------------------------------------

export function createStore<T extends object>(initializer: StateCreator<T>): CreateStoreResult<T> {
	// --- Phase 1: initialization ---
	// `source` doesn't exist yet. get()/set() use `initialState` directly.
	// source is `let` so set() during the initializer doesn't throw.
	let source: WritableStore<T> | null = null;
	let initialState: T = undefined as unknown as T;

	// Action keys cached once after init (not recomputed per set()).
	// Starts empty — set() during init skips action preservation (no actions yet).
	let actionKeys: string[] = [];

	const get: Get<T> = () => (source ? (source.get() as T) : initialState);

	const set: Set<T> = (partial, replace) => {
		const prev = get();
		const nextPartial =
			typeof partial === "function" ? (partial as (s: T) => T | Partial<T>)(prev) : partial;

		// No-op early return — avoids unnecessary allocation
		if (nextPartial === prev && !replace) return;

		// replace=true replaces the entire state, no action preservation.
		if (replace) {
			if (source) source.set(nextPartial as T);
			else initialState = nextPartial as T;
			return;
		}

		const nextState = Object.assign({}, prev, nextPartial) as T;

		// Preserve action references not explicitly overwritten.
		for (const key of actionKeys) {
			if (!Object.hasOwn(nextPartial as object, key)) {
				(nextState as any)[key] = (prev as any)[key];
			}
		}

		if (source) source.set(nextState);
		else initialState = nextState;
	};

	// Run initializer — may call set()/get() during execution.
	// get() returns `initialState` (starts as undefined, updated by any
	// set() calls during init). This matches Zustand's behavior.
	initialState = initializer(set, get);

	// Cache action keys once after init
	actionKeys = Object.keys(initialState).filter(
		(k) => typeof (initialState as any)[k] === "function",
	);

	// Snapshot for getInitialState() — frozen reference to the original state
	const frozenInitial = initialState;

	// --- Phase 2: reactive backing store ---
	// After this point, `source` is set and get()/set() delegate to it.
	source = state<T>(initialState, { name: "createStore" });

	// -- StoreApi methods --
	// coreSubscribe is a lightweight sink (no graph node allocation, no
	// Inspector registration). effect() would work but creates an unnecessary
	// store node — we just need "call me when values change".

	const setState: StoreApi<T>["setState"] = (partial, replace) => {
		set(partial, replace);
	};

	const getState: StoreApi<T>["getState"] = () => source!.get() as T;

	const getInitialState: StoreApi<T>["getInitialState"] = () => frozenInitial;

	const storeSubscribe: StoreApi<T>["subscribe"] = (listener) => {
		return coreSubscribe(source as Store<T>, (value, prev) => {
			listener(value, prev as T);
		});
	};

	// -- Select: the killer feature --

	const select = <U>(selector: (state: T) => U, equals?: (a: U, b: U) => boolean): Store<U> => {
		return derived([source as Store<T>], () => selector(source!.get() as T), {
			equals: equals ?? (Object.is as (a: U, b: U) => boolean),
		});
	};

	// destroy() uses protocol-level teardown — sends END to all downstream
	// sinks (subscribers, select()-derived stores), cascading through the
	// entire subgraph.
	const destroy = () => {
		teardown(source!);
	};

	return {
		setState,
		getState,
		getInitialState,
		subscribe: storeSubscribe,
		select,
		store: source,
		destroy,
	};
}

export { batch, teardown };
export type { StoreApi, CreateStoreResult, StateCreator, SetStateAction };
