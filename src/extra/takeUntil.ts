import { Inspector } from "../core/inspector";
import { beginDeferredStart, DATA, DIRTY, END, endDeferredStart, START, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Passes through all values from input until notifier emits, then completes.
 * Upstream subscriptions are torn down when the notifier fires.
 * After completion, get() returns the frozen last value.
 *
 * Stateful: maintains frozen value after completion; get() delegates to
 * input.get() while active, returns cached frozen value after completion.
 *
 * v3: both input and notifier are subscribed via raw callbag. Completion is
 * triggered on type 3 STATE(DIRTY) from the notifier — in-band during DIRTY
 * propagation, before any type 1 DATA emissions in the same batch reach
 * downstream. Input STATE/DATA signals are forwarded directly to sinks.
 */
export function takeUntil<A>(notifier: Store<unknown>): StoreOperator<A, A> {
	return (input: Store<A>) => {
		let frozenValue: A | undefined;
		let completed = false;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;
		let inputTalkback: ((type: number) => void) | null = null;
		let notifierTalkback: ((type: number) => void) | null = null;

		function complete() {
			if (completed) return;
			frozenValue = input.get();
			completed = true;
			if (inputTalkback) {
				inputTalkback(END);
				inputTalkback = null;
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

			beginDeferredStart();

			// Input: raw callbag — forwards STATE and DATA to downstream sinks
			input.source(START, (type: number, data: unknown) => {
				if (type === START) {
					inputTalkback = data as (type: number) => void;
					return;
				}
				if (completed) return;
				if (type === STATE) {
					for (const sink of sinks) sink(STATE, data);
				}
				if (type === DATA) {
					for (const sink of sinks) sink(DATA, data);
				}
				if (type === END) {
					inputTalkback = null;
					complete();
				}
			});

			// Notifier: raw callbag so STATE(DIRTY) is detected in-band during
			// DIRTY propagation, before type 1 DATA emissions flush in the same batch.
			notifier.source(START, (type: number, data: unknown) => {
				if (type === START) notifierTalkback = data as (type: number) => void;
				if (type === STATE && data === DIRTY) complete();
				if (type === END) notifierTalkback = null;
			});

			endDeferredStart();
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
					sinks.add(sink);
					if (!started) start();
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, store.get());
						if (t === END) {
							sinks.delete(sink);
							if (sinks.size === 0 && !completed) {
								if (inputTalkback) {
									inputTalkback(END);
									inputTalkback = null;
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
