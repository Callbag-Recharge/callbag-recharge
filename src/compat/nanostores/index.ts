/**
 * Nanostores-compatible API built on callbag-recharge primitives.
 *
 * Near-1:1 API match with nanostores. Positions callbag-recharge in the
 * Astro/multi-framework ecosystem with zero overhead wrappers.
 *
 * @category compat
 */

import { derived } from "../../core/derived";
import { state } from "../../core/state";
import { subscribe as coreSubscribe } from "../../core/subscribe";
import type { Store, WritableStore } from "../../core/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NanoAtom<T> {
	/** Get current value. */
	get(): T;
	/** Set a new value. */
	set(value: T): void;
	/** Subscribe to value changes. Callback receives the new value.
	 * Returns unsubscribe function. Called immediately with current value. */
	subscribe(cb: (value: T) => void): () => void;
	/** Listen to value changes (no immediate call). Returns unsubscribe. */
	listen(cb: (value: T) => void): () => void;
	/** The underlying callbag-recharge store. */
	store: WritableStore<T>;
}

export interface NanoComputed<T> {
	/** Get current value. */
	get(): T;
	/** Subscribe to value changes. Called immediately with current value.
	 * Returns unsubscribe function. */
	subscribe(cb: (value: T) => void): () => void;
	/** Listen to value changes (no immediate call). Returns unsubscribe. */
	listen(cb: (value: T) => void): () => void;
	/** The underlying callbag-recharge store. */
	store: Store<T>;
}

export interface NanoMap<T extends Record<string, unknown>> {
	/** Get current value. */
	get(): T;
	/** Set a new value (full replace). */
	set(value: T): void;
	/** Set a single key. */
	setKey<K extends keyof T>(key: K, value: T[K]): void;
	/** Subscribe to value changes. Called immediately with current value.
	 * Returns unsubscribe function. */
	subscribe(cb: (value: T) => void): () => void;
	/** Listen to value changes (no immediate call). Returns unsubscribe. */
	listen(cb: (value: T) => void): () => void;
	/** The underlying callbag-recharge store. */
	store: WritableStore<T>;
}

// ---------------------------------------------------------------------------
// atom
// ---------------------------------------------------------------------------

/**
 * Creates a nanostores-compatible atom backed by `state()`.
 *
 * @param initial - Initial value.
 *
 * @returns `NanoAtom<T>` — `.get()`, `.set()`, `.subscribe()`, `.listen()`.
 *
 * @example
 * ```ts
 * import { atom } from 'callbag-recharge/compat/nanostores';
 *
 * const count = atom(0);
 * count.subscribe(v => console.log(v)); // logs 0 immediately
 * count.set(1); // logs 1
 * ```
 *
 * @seeAlso [state](/api/state), [computed](#computed)
 *
 * @category compat
 */
export function atom<T>(initial: T): NanoAtom<T> {
	const s = state<T>(initial);

	return {
		get: () => s.get(),
		set: (value: T) => s.set(value),
		subscribe: (cb: (value: T) => void) => {
			const sub = coreSubscribe(s, (v) => cb(v));
			cb(s.get());
			return () => sub.unsubscribe();
		},
		listen: (cb: (value: T) => void) => {
			{
				const sub = coreSubscribe(s, (v) => cb(v));
				return () => sub.unsubscribe();
			}
		},
		store: s,
	};
}

// ---------------------------------------------------------------------------
// computed
// ---------------------------------------------------------------------------

/**
 * Creates a nanostores-compatible computed store backed by `derived()`.
 *
 * Supports 1-4 store dependencies (matching nanostores overloads).
 *
 * @param stores - One or more atoms/computed stores to derive from.
 * @param fn - Compute function receiving current values of all deps.
 *
 * @returns `NanoComputed<T>` — `.get()`, `.subscribe()`, `.listen()`.
 *
 * @example
 * ```ts
 * import { atom, computed } from 'callbag-recharge/compat/nanostores';
 *
 * const count = atom(0);
 * const doubled = computed(count, v => v * 2);
 * doubled.get(); // 0
 * count.set(3);
 * doubled.get(); // 6
 * ```
 *
 * @category compat
 */
export function computed<T, A>(
	storeA: NanoAtom<A> | NanoComputed<A>,
	fn: (a: A) => T,
): NanoComputed<T>;
export function computed<T, A, B>(
	stores: [NanoAtom<A> | NanoComputed<A>, NanoAtom<B> | NanoComputed<B>],
	fn: (a: A, b: B) => T,
): NanoComputed<T>;
export function computed<T, A, B, C>(
	stores: [
		NanoAtom<A> | NanoComputed<A>,
		NanoAtom<B> | NanoComputed<B>,
		NanoAtom<C> | NanoComputed<C>,
	],
	fn: (a: A, b: B, c: C) => T,
): NanoComputed<T>;
export function computed<T>(stores: any, fn: (...args: any[]) => T): NanoComputed<T> {
	const storeArray: Array<NanoAtom<any> | NanoComputed<any>> = Array.isArray(stores)
		? stores
		: [stores];
	const deps: Store<unknown>[] = storeArray.map((s) => s.store);

	const d = derived(deps, () => fn(...storeArray.map((s) => s.get())), {
		equals: Object.is as any,
	});

	return {
		get: () => d.get(),
		subscribe: (cb: (value: T) => void) => {
			const sub = coreSubscribe(d, (v) => cb(v));
			cb(d.get());
			return () => sub.unsubscribe();
		},
		listen: (cb: (value: T) => void) => {
			{
				const sub = coreSubscribe(d, (v) => cb(v));
				return () => sub.unsubscribe();
			}
		},
		store: d,
	};
}

// ---------------------------------------------------------------------------
// map
// ---------------------------------------------------------------------------

/**
 * Creates a nanostores-compatible map (object store with `setKey`).
 *
 * @param initial - Initial object value.
 *
 * @returns `NanoMap<T>` — `.get()`, `.set()`, `.setKey()`, `.subscribe()`, `.listen()`.
 *
 * @example
 * ```ts
 * import { map } from 'callbag-recharge/compat/nanostores';
 *
 * const profile = map({ name: 'Alice', age: 30 });
 * profile.setKey('age', 31);
 * profile.get(); // { name: 'Alice', age: 31 }
 * ```
 *
 * @category compat
 */
export function map<T extends Record<string, unknown>>(initial: T): NanoMap<T> {
	const s = state<T>(initial, { equals: () => false });

	return {
		get: () => s.get(),
		set: (value: T) => s.set(value),
		setKey: <K extends keyof T>(key: K, value: T[K]) => {
			s.set({ ...s.get(), [key]: value });
		},
		subscribe: (cb: (value: T) => void) => {
			const sub = coreSubscribe(s, (v) => cb(v));
			cb(s.get());
			return () => sub.unsubscribe();
		},
		listen: (cb: (value: T) => void) => {
			{
				const sub = coreSubscribe(s, (v) => cb(v));
				return () => sub.unsubscribe();
			}
		},
		store: s,
	};
}
