import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Passes the first upstream change through immediately, then silences further
 * changes for `ms` milliseconds. Leading-edge semantics.
 *
 * Stateful: maintains last throttled value via producer. get() returns
 * undefined before first emission, then the last passed-through value.
 *
 * v3: Tier 2 — each emit starts a new DIRTY+value cycle (autoDirty: true).
 * No built-in dedup — emits every throttled value.
 * Forwards upstream completion and errors.
 */
export function throttle<A>(ms: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		const store = producer<A>(({ emit, error, complete }) => {
			let timer: ReturnType<typeof setTimeout> | null = null;

			const unsub = subscribe(
				input,
				(v) => {
					if (timer !== null) return; // still within throttle window
					emit(v);
					timer = setTimeout(() => {
						timer = null;
					}, ms);
				},
				{
					onEnd: (err) => {
						if (timer !== null) clearTimeout(timer);
						timer = null;
						if (err !== undefined) {
							error(err);
						} else {
							complete();
						}
					},
				},
			);

			return () => {
				if (timer !== null) clearTimeout(timer);
				unsub();
			};
		});

		Inspector.register(store, { kind: "throttle" });
		return store;
	};
}
