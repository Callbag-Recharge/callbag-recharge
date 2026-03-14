// ---------------------------------------------------------------------------
// operator(deps, init, opts?) — general-purpose transform primitive
// ---------------------------------------------------------------------------
// Receives all signal types from upstream deps and decides what to forward.
// The init function receives actions and returns a handler called for every
// event from every dep, with depIndex indicating which dep sent it.
// ---------------------------------------------------------------------------

import { Inspector } from "./inspector";
import type { Signal } from "./protocol";
import { DATA, END, START, STATE } from "./protocol";
import type { Actions, Store, StoreOptions } from "./types";

export function operator<B>(
	deps: Store<unknown>[],
	init: (actions: Actions<B>) => (depIndex: number, type: number, data: any) => void,
	opts?: StoreOptions & { initial?: B },
): Store<B> {
	let currentValue: B | undefined = opts?.initial;
	const sinks = new Set<any>();
	let upstreamTalkbacks: Array<((type: number) => void) | null> = [];
	let handler: ((depIndex: number, type: number, data: any) => void) | null = null;

	function connectUpstream(): void {
		const localTalkbacks: Array<((type: number) => void) | null> = new Array(deps.length).fill(
			null,
		);
		upstreamTalkbacks = localTalkbacks;

		const actions: Actions<B> = {
			emit(value: B) {
				currentValue = value;
				for (const sink of sinks) sink(DATA, value);
			},
			signal(s: Signal) {
				for (const sink of sinks) sink(STATE, s);
			},
			complete() {
				for (const sink of sinks) sink(END);
			},
			disconnect(dep?: number) {
				if (dep !== undefined) {
					localTalkbacks[dep]?.(END);
					localTalkbacks[dep] = null;
				} else {
					for (const tb of localTalkbacks) tb?.(END);
					localTalkbacks.fill(null);
				}
			},
		};

		handler = init(actions);

		for (let i = 0; i < deps.length; i++) {
			const depIndex = i;
			deps[depIndex].source(START, (type: number, data: any) => {
				if (type === START) {
					localTalkbacks[depIndex] = data;
					return;
				}
				handler!(depIndex, type, data);
			});
		}
	}

	function disconnectUpstream(): void {
		for (const tb of upstreamTalkbacks) tb?.(END);
		upstreamTalkbacks = [];
		handler = null;
	}

	const store: Store<B> = {
		get() {
			return currentValue as B;
		},

		source(type: number, payload?: any) {
			if (type === START) {
				const sink = payload;
				const wasEmpty = sinks.size === 0;
				sinks.add(sink);
				if (wasEmpty) {
					connectUpstream();
				}
				sink(START, (t: number) => {
					if (t === DATA) sink(DATA, currentValue);
					if (t === END) {
						sinks.delete(sink);
						if (sinks.size === 0) disconnectUpstream();
					}
				});
			}
		},
	};

	Inspector.register(store, { kind: "operator", ...opts });
	return store;
}
