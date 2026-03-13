// ---------------------------------------------------------------------------
// pipe() + operators — each step is a store backed by derived()
// ---------------------------------------------------------------------------

import { derived } from "./derived";
import { Inspector } from "./inspector";
import type { Store, StoreOperator, StoreOptions } from "./types";

// ---------------------------------------------------------------------------
// pipe overloads
// ---------------------------------------------------------------------------

export function pipe<A>(source: Store<A>): Store<A>;
export function pipe<A, B>(source: Store<A>, op1: StoreOperator<A, B>): Store<B>;
export function pipe<A, B, C>(
	source: Store<A>,
	op1: StoreOperator<A, B>,
	op2: StoreOperator<B, C>,
): Store<C>;
export function pipe<A, B, C, D>(
	source: Store<A>,
	op1: StoreOperator<A, B>,
	op2: StoreOperator<B, C>,
	op3: StoreOperator<C, D>,
): Store<D>;
export function pipe<A, B, C, D, E>(
	source: Store<A>,
	op1: StoreOperator<A, B>,
	op2: StoreOperator<B, C>,
	op3: StoreOperator<C, D>,
	op4: StoreOperator<D, E>,
): Store<E>;
export function pipe(
	source: Store<unknown>,
	...ops: Array<StoreOperator<any, any>>
): Store<unknown>;

export function pipe(
	source: Store<unknown>,
	...ops: Array<StoreOperator<any, any>>
): Store<unknown> {
	let current = source;
	for (const op of ops) {
		current = op(current);
	}
	return current;
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

export function map<A, B>(fn: (value: A) => B, opts?: StoreOptions): StoreOperator<A, B> {
	return (input) => {
		const name = opts?.name ?? `map(${Inspector.getName(input) ?? "?"})`;
		return derived(() => fn(input.get()), { name });
	};
}

export function filter<A>(
	predicate: (value: A) => boolean,
	opts?: StoreOptions,
): StoreOperator<A, A | undefined> {
	return (input) => {
		const name = opts?.name ?? `filter(${Inspector.getName(input) ?? "?"})`;
		// Filter holds the last value that passed the predicate.
		// Starts as undefined — nothing has passed yet.
		let lastPassing: A | undefined;
		return derived(
			() => {
				const v = input.get();
				if (predicate(v)) lastPassing = v;
				return lastPassing;
			},
			{ name },
		);
	};
}

// ---------------------------------------------------------------------------
// SKIP sentinel + pipeRaw — fused pipe with a single derived store
// ---------------------------------------------------------------------------

export const SKIP: unique symbol = Symbol("SKIP");

export function pipeRaw<A, B>(source: Store<A>, f1: (v: A) => B | typeof SKIP): Store<B>;
export function pipeRaw<A, B, C>(
	source: Store<A>,
	f1: (v: A) => B | typeof SKIP,
	f2: (v: B) => C | typeof SKIP,
): Store<C>;
export function pipeRaw<A, B, C, D>(
	source: Store<A>,
	f1: (v: A) => B | typeof SKIP,
	f2: (v: B) => C | typeof SKIP,
	f3: (v: C) => D | typeof SKIP,
): Store<D>;
export function pipeRaw<A, B, C, D, E>(
	source: Store<A>,
	f1: (v: A) => B | typeof SKIP,
	f2: (v: B) => C | typeof SKIP,
	f3: (v: C) => D | typeof SKIP,
	f4: (v: D) => E | typeof SKIP,
): Store<E>;
export function pipeRaw(source: Store<unknown>, ...fns: Array<(v: any) => any>): Store<unknown>;

export function pipeRaw(source: Store<unknown>, ...fns: Array<(v: any) => any>): Store<unknown> {
	let cached: unknown;
	let hasCached = false;
	return derived(() => {
		let v: any = source.get();
		for (const fn of fns) {
			v = fn(v);
			if (v === SKIP) return hasCached ? cached : undefined;
		}
		cached = v;
		hasCached = true;
		return v;
	});
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

export function scan<A, B>(
	reducer: (acc: B, value: A) => B,
	seed: B,
	opts?: StoreOptions,
): StoreOperator<A, B> {
	return (input) => {
		const name = opts?.name ?? `scan(${Inspector.getName(input) ?? "?"})`;
		let acc = seed;
		return derived(
			() => {
				acc = reducer(acc, input.get());
				return acc;
			},
			{ name },
		);
	};
}
