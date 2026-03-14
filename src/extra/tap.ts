import { Inspector } from "../inspector";
import { DATA, DIRTY, END, START } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Side-effect passthrough operator. Calls `fn` for each upstream value
 * without altering it. Useful for debugging and logging.
 *
 * Raw-callbag two-phase node: forwards DIRTY in phase 1, calls fn and
 * emits value in phase 2. Glitch-free in diamond topologies.
 */
export function tap<A>(fn: (value: A) => void): StoreOperator<A, A> {
	return (input: Store<A>) => {
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let connected = false;
		let talkback: ((type: number) => void) | null = null;
		let dirty = false;

		function connectUpstream(): void {
			input.source(START, (type: number, data: any) => {
				if (type === START) {
					talkback = data;
					return;
				}
				if (type === DATA) {
					if (data === DIRTY) {
						if (!dirty) {
							dirty = true;
							for (const sink of sinks) sink(DATA, DIRTY);
						}
					} else if (dirty) {
						dirty = false;
						fn(data as A);
						for (const sink of sinks) sink(DATA, data);
					}
				}
				if (type === END) {
					talkback = null;
					connected = false;
					dirty = false;
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
			dirty = false;
		}

		const store: Store<A> = {
			get() {
				return input.get();
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
						if (t === DATA) sink(DATA, input.get());
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

		Inspector.register(store, { kind: "tap" });
		return store;
	};
}
