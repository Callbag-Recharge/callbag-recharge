import { operator } from "../core/operator";
import { DATA, DIRTY, END, RESOLVED, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Emits [prev, curr] pairs on each upstream change. Requires 2 observed
 * values before emitting the first pair (matches rxjs pairwise semantics).
 * get() returns undefined until the second upstream change arrives.
 *
 * Stateful: maintains own cached [prev, curr] pair. get() returns the
 * last emitted pair, or undefined before two upstream changes.
 *
 * v3: Tier 1 — uses operator() with single dep. Forwards all type 3 STATE
 * signals; creates pair and emits on type 1 DATA (after first value is buffered).
 */
export function pairwise<A>(): StoreOperator<A, [A, A] | undefined> {
	return (input: Store<A>) => {
		return operator<[A, A] | undefined>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error }) => {
				let prev: A | undefined;
				let hasPrev = false;

				return (_dep, type, data) => {
					if (type === STATE) {
						if (data === DIRTY || data === RESOLVED) {
							// Only forward DIRTY/RESOLVED when we can produce output
							if (hasPrev) signal(data);
						} else {
							signal(data); // Forward unknown STATE signals always (v4 forward-compat)
						}
					}
					if (type === DATA) {
						if (hasPrev) {
							const pair: [A, A] = [prev as A, data as A];
							prev = data as A;
							emit(pair);
						} else {
							prev = data as A;
							hasPrev = true;
						}
					}
					if (type === END) {
						if (data !== undefined) {
							error(data);
						} else {
							complete();
						}
					}
				};
			},
			{ kind: "pairwise", name: "pairwise" },
		);
	};
}
