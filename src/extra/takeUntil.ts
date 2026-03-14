import { Inspector } from "../inspector";
import { DATA, DIRTY, END, pushChange, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Passes through all values from input until notifier emits a new value, then completes.
 * Upstream subscriptions are torn down when the notifier fires.
 * After completion, get() returns the frozen last value.
 *
 * The notifier is subscribed via raw callbag protocol so that completion is detected
 * in-band during DIRTY propagation — preventing any input emission that was enqueued
 * in the same batch from leaking through after the notifier fires.
 */
export function takeUntil<A>(notifier: Store<unknown>): StoreOperator<A, A> {
	return (input: Store<A>) => {
		let frozenValue: A | undefined;
		let completed = false;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;
		let inputUnsub: (() => void) | null = null;
		let notifierTalkback: ((type: number) => void) | null = null;

		function complete() {
			if (completed) return;
			frozenValue = input.get();
			completed = true;
			if (inputUnsub) {
				inputUnsub();
				inputUnsub = null;
			}
			if (notifierTalkback) {
				notifierTalkback(END);
				notifierTalkback = null;
			}
			started = false;
			const snapshot = [...sinks];
			sinks.clear();
			for (const sink of snapshot) sink(END);
		}

		function start() {
			if (started) return;
			started = true;
			// Input: use subscribe() with a completed guard so any already-enqueued
			// input effects are no-ops after complete() runs.
			inputUnsub = subscribe(input, () => {
				if (!completed) pushChange(sinks, () => input.get());
			});
			// Notifier: raw callbag so DIRTY is detected in-band during propagation,
			// before the flush runs any enqueued effects from the same batch.
			notifier.source(START, (type: number, data: unknown) => {
				if (type === START) notifierTalkback = data as (type: number) => void;
				if (type === DATA && data === DIRTY) complete();
				if (type === END) notifierTalkback = null;
			});
		}

		const store: Store<A> = {
			get() {
				return completed ? (frozenValue as A) : input.get();
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					const sink = payload as (type: number, data?: unknown) => void;
					if (completed) {
						sink(START, () => {});
						sink(END);
						return;
					}
					start();
					sinks.add(sink);
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, store.get());
						if (t === END) {
							sinks.delete(sink);
							if (sinks.size === 0 && !completed) {
								if (inputUnsub) {
									inputUnsub();
									inputUnsub = null;
								}
								if (notifierTalkback) {
									notifierTalkback(END);
									notifierTalkback = null;
								}
								started = false;
							}
						}
					});
				}
			},
		};

		Inspector.register(store, { kind: "takeUntil" });
		return store;
	};
}
