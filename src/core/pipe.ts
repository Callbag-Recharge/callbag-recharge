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
