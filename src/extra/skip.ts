import { Inspector } from "../inspector";
import { DATA, END, START, STATE } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Skips the first `n` value changes from upstream, then passes through all
 * subsequent ones.
 *
 * Stateful: maintains own cached value. get() returns undefined until the
 * first post-skip value arrives, then returns the last forwarded value.
 *
 * v3: type 3 STATE carries signals. During the skip phase (count < n),
 * STATE signals are not forwarded and DATA values are silently consumed.
 * After n values have been skipped, STATE and DATA are forwarded normally.
 */
export function skip<A>(n: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		let currentValue: A | undefined;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let emissionCount = 0;
		let connected = false;
		let talkback: ((type: number) => void) | null = null;

		function connectUpstream(): void {
			input.source(START, (type: number, data: any) => {
				if (type === START) {
					talkback = data;
					return;
				}
				if (type === STATE) {
					if (emissionCount >= n) {
						for (const sink of sinks) sink(STATE, data);
					}
					// else: will suppress this value — don't forward DIRTY yet
				}
				if (type === DATA) {
					emissionCount++;
					if (emissionCount > n) {
						currentValue = data;
						for (const sink of sinks) sink(DATA, currentValue);
					}
					// During skip phase: silently consume. No RESOLVED needed since
					// DIRTY was never forwarded — downstream has nothing to resolve.
				}
				if (type === END) {
					talkback = null;
					connected = false;
					for (const sink of sinks) sink(END, data);
				}
			});
		}

		function disconnectUpstream(): void {
			if (talkback) {
				talkback(END);
				talkback = null;
			}
			connected = false;
		}

		const store: Store<A | undefined> = {
			get() {
				return currentValue;
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					const sink = payload as (type: number, data?: unknown) => void;
					const wasEmpty = sinks.size === 0;
					sinks.add(sink);
					if (wasEmpty) {
						connectUpstream();
						connected = true;
					}
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, currentValue);
						if (t === END) {
							sinks.delete(sink);
							if (sinks.size === 0 && connected) {
								disconnectUpstream();
							}
						}
					});
				}
			},
		};

		Inspector.register(store, { kind: "skip" });
		return store;
	};
}
