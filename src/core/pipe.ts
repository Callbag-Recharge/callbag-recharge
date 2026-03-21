import type { Store, StoreOperator } from "./types";

// ---------------------------------------------------------------------------
// pipe overloads
// ---------------------------------------------------------------------------

export function pipe<A>(source: Store<A>): Store<A>;
export function pipe<A, R extends Store<any>>(source: Store<A>, op1: (source: Store<A>) => R): R;
export function pipe<A, B, R extends Store<any>>(
	source: Store<A>,
	op1: StoreOperator<A, B>,
	op2: (source: Store<B>) => R,
): R;
export function pipe<A, B, C, R extends Store<any>>(
	source: Store<A>,
	op1: StoreOperator<A, B>,
	op2: StoreOperator<B, C>,
	op3: (source: Store<C>) => R,
): R;
export function pipe<A, B, C, D, R extends Store<any>>(
	source: Store<A>,
	op1: StoreOperator<A, B>,
	op2: StoreOperator<B, C>,
	op3: StoreOperator<C, D>,
	op4: (source: Store<D>) => R,
): R;
export function pipe(
	source: Store<unknown>,
	...ops: Array<StoreOperator<any, any>>
): Store<unknown>;

/**
 * Composes `StoreOperator` functions left-to-right, returning a single output store.
 * Each operator wraps the previous store; order matches visual reading order.
 *
 * @param source - The input `Store`.
 * @param ops - One or more `StoreOperator`s (e.g. `map`, `filter`, `scan` from `callbag-recharge/extra`).
 *
 * @returns The final `Store` after all operators have been applied.
 *
 * @example
 * ```ts
 * import { state, pipe } from 'callbag-recharge';
 * import { map } from 'callbag-recharge/extra';
 *
 * const n = state(3);
 * const doubled = pipe(n, map((x) => x * 2));
 * doubled.get(); // 6
 * ```
 *
 * @seeAlso [map](/api/map), [pipeRaw](/api/pipeRaw) — fused single derived for performance
 */
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
