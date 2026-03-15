/**
 * pipeRaw() fuses all transform functions into a single derived() store
 * for ~2x throughput. SKIP sentinel provides filter semantics in pipeRaw.
 *
 * Stateful: returns a store (backed by derived()).
 *
 * v3: Tier 1 — inherits derived()'s diamond resolution.
 */

import { derived } from "../derived";
import type { Store } from "../types";

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
	return derived([source], () => {
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
