import { operator } from "../core/operator";
import { DATA, END, RESOLVED, STATE } from "../core/protocol";
import type { Store, StoreOperator, StoreOptions } from "../core/types";

/**
 * Accumulates upstream values with a reducer and seed, emitting the accumulator after each step.
 * Returns a `StoreOperator` for use with `pipe()`.
 *
 * @param reducer - `(acc, value) => nextAcc` applied on each upstream DATA.
 * @param seed - Initial accumulator; reset when the operator reconnects.
 * @param opts - Optional `equals` to skip emissions when the accumulator is unchanged.
 *
 * @returns `StoreOperator<A, B>` — stateful; `get()` fold-reads the current input when disconnected.
 *
 * @optionsType StoreOptions
 * @option equals | (a: B, b: B) => boolean | undefined | Sends RESOLVED instead of duplicate DATA.
 * @option name | string | undefined | Debug name for Inspector.
 *
 * @remarks **Tier 1:** Forwards STATE; participates in dirty/diamond semantics.
 *
 * @example
 * ```ts
 * import { state, pipe } from 'callbag-recharge';
 * import { scan } from 'callbag-recharge/extra';
 *
 * const n = state(1);
 * const sum = pipe(n, scan((acc, x) => acc + x, 0));
 * n.set(2);
 * sum.get(); // 3
 * ```
 *
 * @seeAlso [pipe](/api/pipe), [reduce](/api/reduce) — final accumulated value
 *
 * @category extra
 */
export function scan<A, B>(
	reducer: (acc: B, value: A) => B,
	seed: B,
	opts?: StoreOptions,
): StoreOperator<A, B> {
	return (input) => {
		const eqFn = opts?.equals;
		// Shared accumulator between handler (push) and getter (pull).
		// Handler owns acc when connected; getter owns it when disconnected.
		let acc = seed;
		// Getter idempotency: track last input seen to avoid double-applying
		// the reducer when get() is called multiple times with the same dep value.
		let lastGetterInput: A | undefined;
		let getterSeeded = false;

		return operator<B>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error }) => {
				// On (re)connect, reset accumulator to seed and getter tracking.
				// Matches rxjs semantics: each subscription starts from seed.
				acc = seed;
				getterSeeded = false;

				return (_dep, type, data) => {
					if (type === STATE) {
						signal(data);
					}
					if (type === DATA) {
						const next = reducer(acc, data as A);
						if (eqFn?.(acc, next)) {
							signal(RESOLVED);
							return;
						}
						acc = next;
						emit(acc);
					}
					if (type === END) {
						if (data !== undefined) error(data);
						else complete();
					}
				};
			},
			{
				kind: "scan",
				name: opts?.name ?? "scan",
				initial: seed,
				resetOnTeardown: true,
				getter: () => {
					const v = input.get();
					if (!getterSeeded || !Object.is(v, lastGetterInput)) {
						acc = reducer(acc, v);
						lastGetterInput = v;
						getterSeeded = true;
					}
					return acc;
				},
			},
		);
	};
}
