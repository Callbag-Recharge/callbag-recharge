import { operator } from "../core/operator";
import { DATA, END, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Emits values while `predicate` returns true, then completes and disconnects upstream.
 *
 * @param predicate - Function tested against each upstream value. Stream completes on first `false`.
 *
 * @returns `StoreOperator<A, A | undefined>` — Tier 1; forwards STATE while predicate holds.
 *
 * @remarks **Tier 1:** Participates in diamond resolution. Forwards type 3 STATE signals while active.
 * @remarks **Completion:** When predicate returns false, upstream is disconnected and the operator completes. The failing value is **not** emitted.
 *
 * @example
 * ```ts
 * import { state, pipe } from 'callbag-recharge';
 * import { takeWhile, subscribe } from 'callbag-recharge/extra';
 *
 * const s = state(0);
 * const t = pipe(s, takeWhile(v => v < 5));
 * subscribe(t, v => console.log(v));
 * s.set(3); // logs 3
 * s.set(7); // completes — 7 is not emitted
 * ```
 *
 * @example With fromIter
 * ```ts
 * import { pipe } from 'callbag-recharge';
 * import { fromIter, takeWhile } from 'callbag-recharge/extra';
 *
 * const s = pipe(fromIter([1, 2, 3, 4, 5]), takeWhile(v => v < 4));
 * // emits 1, 2, 3 then completes
 * ```
 *
 * @seeAlso [take](/api/take) — take by count, [takeUntil](/api/takeUntil) — take until signal
 *
 * @category extra
 */
export function takeWhile<A>(predicate: (value: A) => boolean): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		return operator<A | undefined>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error, disconnect }) => {
				let completed = false;

				return (_dep, type, data) => {
					if (completed) return;
					if (type === STATE) {
						signal(data);
					}
					if (type === DATA) {
						try {
							if (predicate(data as A)) {
								emit(data as A);
							} else {
								completed = true;
								disconnect();
								complete();
							}
						} catch (e) {
							completed = true;
							disconnect();
							error(e);
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
			{ kind: "takeWhile", name: "takeWhile" },
		);
	};
}
