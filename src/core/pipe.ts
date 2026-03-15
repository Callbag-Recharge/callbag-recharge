/**
 * pipe() composes StoreOperators left to right. Each step produces a new store.
 *
 * Stateful: each pipe step returns a store (backed by derived()).
 *
 * v3: Tier 1 — all stores inherit derived()'s diamond resolution.
 */

import type { Store, StoreOperator } from "./types";

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
