/**
 * Jotai-compatible API built on callbag-recharge primitives.
 *
 * Supports three atom overloads:
 * 1. `atom(initial)` — writable primitive atom (wraps `state()`)
 * 2. `atom(read)` — read-only derived atom (wraps `dynamicDerived()`)
 * 3. `atom(read, write)` — writable derived atom
 *
 * Uses `dynamicDerived()` for tier 1 diamond resolution with dynamic dep
 * tracking: deps are re-discovered on each recomputation and upstream
 * connections are rewired when deps change.
 *
 * @category compat
 */

import { dynamicDerived } from "../../core/dynamicDerived";
import { state } from "../../core/state";
import { subscribe as coreSubscribe } from "../../core/subscribe";
import type { Store } from "../../core/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReadableAtom<T> {
	/** Get current value. */
	get(): T;
	/** Subscribe to changes. Returns unsubscribe function. */
	subscribe(cb: (value: T) => void): () => void;
	/** @internal */
	_store: Store<T>;
	/** @internal */
	_kind: "primitive" | "derived" | "writable-derived";
}

export interface WritableAtom<T> extends ReadableAtom<T> {
	/** Set a new value. */
	set(value: T): void;
	/** Update value with a function. */
	update(fn: (current: T) => T): void;
}

type GetFn = <T>(a: ReadableAtom<T>) => T;
type SetFn = <T>(a: WritableAtom<T>, value: T) => void;
type ReadFn<T> = (get: GetFn) => T;
type WriteFn<T> = (get: GetFn, set: SetFn, value: T) => void;

// ---------------------------------------------------------------------------
// atom — primitive
// ---------------------------------------------------------------------------

/**
 * Creates a Jotai-compatible atom.
 *
 * Note: To store a function as a value, wrap it: `atom({ fn: myFunction })`.
 * A bare function argument is always treated as a derived read function.
 *
 * @example Primitive atom
 * ```ts
 * import { atom } from 'callbag-recharge/compat/jotai';
 *
 * const countAtom = atom(0);
 * countAtom.get(); // 0
 * countAtom.set(1);
 * ```
 *
 * @example Derived atom
 * ```ts
 * const countAtom = atom(0);
 * const doubledAtom = atom((get) => get(countAtom) * 2);
 * doubledAtom.get(); // 0
 * countAtom.set(3);
 * doubledAtom.get(); // 6
 * ```
 *
 * @example Writable derived atom
 * ```ts
 * const countAtom = atom(0);
 * const clampedAtom = atom(
 *   (get) => get(countAtom),
 *   (get, set, value: number) => set(countAtom, Math.max(0, Math.min(100, value))),
 * );
 * clampedAtom.set(200);
 * countAtom.get(); // 100
 * ```
 *
 * @category compat
 */
export function atom<T extends (...args: any[]) => any>(read: T): ReadableAtom<ReturnType<T>>;
export function atom<T>(initial: T): WritableAtom<T>;
export function atom<T>(read: ReadFn<T>): ReadableAtom<T>;
export function atom<T>(read: ReadFn<T>, write: WriteFn<T>): WritableAtom<T>;
export function atom<T>(
	initialOrRead: T | ReadFn<T>,
	write?: WriteFn<T>,
): ReadableAtom<T> | WritableAtom<T> {
	if (typeof initialOrRead === "function") {
		return createDerivedAtom(initialOrRead as ReadFn<T>, write);
	}
	return createPrimitiveAtom(initialOrRead);
}

// ---------------------------------------------------------------------------
// Primitive atom
// ---------------------------------------------------------------------------

function createPrimitiveAtom<T>(initial: T): WritableAtom<T> {
	const s = state<T>(initial);
	return {
		get: () => s.get(),
		set: (value: T) => s.set(value),
		update: (fn: (current: T) => T) => s.update(fn),
		subscribe: (cb: (value: T) => void) => coreSubscribe(s, (v) => cb(v)),
		_store: s,
		_kind: "primitive",
	};
}

// ---------------------------------------------------------------------------
// Derived atom (read-only or writable)
//
// Uses dynamicDerived() — tier 1 with dynamic dep tracking. Deps are
// re-discovered via tracking get on each recomputation and upstream
// connections are rewired when deps change. Diamond resolution via
// DIRTY/RESOLVED signals is preserved.
// ---------------------------------------------------------------------------

function createDerivedAtom<T>(
	read: ReadFn<T>,
	write?: WriteFn<T>,
): ReadableAtom<T> | WritableAtom<T> {
	const store = dynamicDerived<T>((get) => read(<U>(a: ReadableAtom<U>) => get(a._store)), {
		equals: Object.is as any,
	});

	const result: ReadableAtom<T> = {
		get: () => store.get(),
		subscribe: (cb: (value: T) => void) => coreSubscribe(store, (v) => cb(v)),
		_store: store,
		_kind: write ? "writable-derived" : "derived",
	};

	if (write) {
		const getFn: GetFn = <U>(a: ReadableAtom<U>): U => a.get();
		const setFn: SetFn = <U>(a: WritableAtom<U>, value: U) => a.set(value);

		const writable = result as WritableAtom<T>;
		writable.set = (value: T) => write(getFn, setFn, value);
		writable.update = (fn: (current: T) => T) => write(getFn, setFn, fn(store.get()));
		return writable;
	}

	return result;
}
