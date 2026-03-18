import { operator } from "../core/operator";
import { DATA, END, RESOLVED, STATE } from "../core/protocol";
import type { Store, StoreOperator, StoreOptions } from "../core/types";

/**
 * Forwards upstream values only when `predicate` returns true; otherwise holds the last passing value.
 * Returns a `StoreOperator` for use with `pipe()`.
 *
 * @param predicate - If false, downstream gets RESOLVED (no new DATA) when the held value is unchanged.
 * @param opts - Optional `name` and `equals` for memoization.
 *
 * @returns `StoreOperator<A, A | undefined>` — `get()` re-evaluates the predicate against the current input when disconnected.
 *
 * @optionsType StoreOptions
 * @option name | string | undefined | Debug name for Inspector.
 * @option equals | (a: A, b: A) => boolean | undefined | Push-phase dedup when the filtered value repeats.
 *
 * @remarks **Tier 1:** Participates in diamond resolution; forwards STATE from upstream.
 *
 * @example
 * ```ts
 * import { state, pipe } from 'callbag-recharge';
 * import { filter } from 'callbag-recharge/extra';
 *
 * const n = state(0);
 * const evens = pipe(n, filter((x) => x % 2 === 0));
 * n.set(2);
 * evens.get(); // 2
 * ```
 *
 * @seeAlso [pipe](/api/pipe), [map](/api/map)
 *
 * @category extra
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
