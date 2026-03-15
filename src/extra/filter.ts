import { operator } from "../operator";
import { DATA, END, RESOLVED, STATE } from "../protocol";
import type { Store, StoreOperator, StoreOptions } from "../types";

/**
 * Conditionally forwards upstream values. When the predicate returns false,
 * holds the last passing value.
 *
 * Stateful: maintains last passing value via operator()'s cache.
 * get() returns the last value that passed the predicate, or undefined.
 *
 * v3: Tier 1 — uses operator() with single dep. When predicate is false and
 * lastPassing is unchanged, sends RESOLVED (subtree skipping) instead of
 * re-emitting. Pull-based get() when disconnected re-evaluates predicate.
 */
export function filter<A>(
	predicate: (value: A) => boolean,
	opts?: StoreOptions,
): StoreOperator<A, A | undefined> {
	return (input) => {
		const eqFn = opts?.equals;
		// Shared state between handler (push) and getter (pull)
		let lastPassing: A | undefined;
		const v0 = input.get();
		if (predicate(v0)) lastPassing = v0;

		return operator<A | undefined>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error }) => {
				return (_dep, type, data) => {
					if (type === STATE) {
						signal(data);
					}
					if (type === DATA) {
						const val = data as A;
						if (predicate(val)) {
							if (eqFn?.(lastPassing as A, val)) {
								signal(RESOLVED);
								return;
							}
							lastPassing = val;
							emit(val);
						} else {
							// Predicate failed — value didn't change for downstream
							signal(RESOLVED);
						}
					}
					if (type === END) {
						if (data !== undefined) error(data);
						else complete();
					}
				};
			},
			{
				kind: "filter",
				name: opts?.name ?? "filter",
				initial: lastPassing,
				getter: () => {
					const v = input.get();
					if (predicate(v)) lastPassing = v;
					return lastPassing;
				},
			},
		);
	};
}
