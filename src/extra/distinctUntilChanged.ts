import { Inspector } from "../inspector";
import { DATA, END, pushDirty, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Filters out consecutive duplicate values using the provided equality function (default: Object.is).
 * Unlike the derived-based implementation, this intercepts DIRTY at the subscription layer so
 * downstream computations are not triggered when the value has not actually changed.
 */
export function distinctUntilChanged<A>(eq?: (a: A, b: A) => boolean): StoreOperator<A, A> {
	const eqFn = eq ?? Object.is;
	return (input: Store<A>) => {
		let currentValue: A = input.get();
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;
		let unsub: (() => void) | null = null;

		function start() {
			if (started) return;
			started = true;
			currentValue = input.get();
			unsub = subscribe(input, (v) => {
				if (!eqFn(currentValue, v)) {
					currentValue = v;
					pushDirty(sinks);
				}
			});
		}

		function stop() {
			if (!started) return;
			started = false;
			if (unsub) {
				unsub();
				unsub = null;
			}
		}

		const store: Store<A> = {
			get() {
				// Delegate to input when not active so get() is always live
				return started ? currentValue : input.get();
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					start();
					const sink = payload as (type: number, data?: unknown) => void;
					sinks.add(sink);
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, currentValue);
						if (t === END) {
							sinks.delete(sink);
							if (sinks.size === 0) stop();
						}
					});
				}
			},
		};

		Inspector.register(store, { kind: "distinctUntilChanged" });
		return store;
	};
}
