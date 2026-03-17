import { operator } from "../core/operator";
import { DATA, END, RESOLVED, STATE } from "../core/protocol";
import type { Store, StoreOperator, StoreOptions } from "../core/types";

/**
 * Accumulates upstream values through `reducer`, starting from `seed`.
 *
 * Stateful: maintains accumulated value via operator()'s cache. get()
 * returns the current accumulator.
 *
 * v3: Tier 1 — uses operator() with single dep. Forwards type 3
 * STATE signals; on type 1 DATA applies reducer and emits. Optional equals
 * enables push-phase memoization via RESOLVED. Pull-based get() when
 * disconnected advances the accumulator idempotently (dedup by input value).
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
