import { operator } from "../core/operator";
import { DATA, DIRTY, END, RESOLVED, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Emits only the final value from upstream when it completes.
 * If upstream completes without emitting, sends END with no DATA.
 *
 * Stateful: buffers the most recent upstream value. get() returns undefined
 * until upstream completes, then the last value (frozen after completion).
 *
 * v3: Tier 1 — uses operator() with single dep. Suppresses all STATE and
 * DATA during buffering. On upstream END, emits the buffered value (if any)
 * then completes.
 */
export function last<A>(): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		return operator<A | undefined>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error }) => {
				let lastValue: A | undefined;
				let hasValue = false;

				return (_dep, type, data) => {
					if (type === STATE) {
						// Suppress DIRTY/RESOLVED during buffering — last only emits on END.
						// Forward unknown STATE signals for v4 forward-compat.
						if (data !== DIRTY && data !== RESOLVED) signal(data);
					}
					if (type === DATA) {
						lastValue = data as A;
						hasValue = true;
					}
					if (type === END) {
						if (data !== undefined) {
							// Upstream errored — forward error without emitting buffered value
							error(data);
						} else {
							if (hasValue) {
								emit(lastValue as A);
							}
							complete();
						}
					}
				};
			},
		);
	};
}
