/**
 * pipeRaw() fuses all transform functions into a single operator() store
 * for ~2x throughput. SKIP sentinel provides filter semantics in pipeRaw.
 *
 * Stateful: returns a store (backed by operator()).
 *
 * v3: Tier 1 — uses operator() with single dep. Forwards type 3 STATE
 * signals; on type 1 DATA applies all fns sequentially, emitting the
 * result or sending RESOLVED when SKIP is returned. Pull-based get()
 * when disconnected re-evaluates the pipeline.
 */

import { operator } from "../core/operator";
import { DATA, END, RESOLVED, STATE } from "../core/protocol";
import type { Store } from "../core/types";

// ---------------------------------------------------------------------------
// SKIP sentinel + pipeRaw — fused pipe with a single operator store
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
	// Shared cache between handler (push) and getter (pull)
	let cached: unknown;
	let hasCached = false;

	function compute(input: unknown): { value: unknown; skipped: boolean } {
		let v: any = input;
		for (const fn of fns) {
			v = fn(v);
			if (v === SKIP) return { value: undefined, skipped: true };
		}
		return { value: v, skipped: false };
	}

	const initial = compute(source.get());
	if (!initial.skipped) {
		cached = initial.value;
		hasCached = true;
	}

	return operator(
		[source],
		({ emit, signal, complete, error }) => {
			return (_dep, type, data) => {
				if (type === STATE) {
					signal(data);
				}
				if (type === DATA) {
					const result = compute(data);
					if (result.skipped) {
						signal(RESOLVED);
					} else {
						cached = result.value;
						hasCached = true;
						emit(result.value);
					}
				}
				if (type === END) {
					if (data !== undefined) error(data);
					else complete();
				}
			};
		},
		{
			kind: "pipeRaw",
			name: "pipeRaw",
			initial: hasCached ? cached : undefined,
			getter: () => {
				const result = compute(source.get());
				if (result.skipped) return hasCached ? cached : undefined;
				cached = result.value;
				hasCached = true;
				return result.value;
			},
		},
	);
}
