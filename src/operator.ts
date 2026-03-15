/**
 * General-purpose transform primitive. Receives all signal types from upstream
 * deps and decides what to forward. The init function receives actions and
 * returns a handler called for every event from every dep, with depIndex
 * indicating which dep sent it.
 *
 * Stateful: maintains cached value via actions.emit(). get() returns the
 * last emitted value. Lazy connection on first sink, disconnects when empty.
 *
 * v3: Tier 1 — participates in diamond resolution. Handler receives type 3
 * STATE signals and decides whether to forward DIRTY/RESOLVED downstream.
 *
 * Class-based for V8 hidden class optimization and prototype method sharing.
 */

import { Inspector } from "./inspector";
import type { Signal } from "./protocol";
import { DATA, END, START, STATE } from "./protocol";
import type { Actions, Store, StoreOptions } from "./types";

export class OperatorImpl<B> {
	_value: B | undefined;
	_sinks: Set<any> | null = null;
	_upstreamTalkbacks: Array<((type: number) => void) | null> = [];
	_handler: ((depIndex: number, type: number, data: any) => void) | null = null;
	_completed = false;
	_deps: Store<unknown>[];
	_init: (actions: Actions<B>) => (depIndex: number, type: number, data: any) => void;

	constructor(
		deps: Store<unknown>[],
		init: (actions: Actions<B>) => (depIndex: number, type: number, data: any) => void,
		opts?: StoreOptions & { initial?: B },
	) {
		this._value = opts?.initial;
		this._deps = deps;
		this._init = init;

		this.source = this.source.bind(this);

		Inspector.register(this as any, { kind: "operator", ...opts });
	}

	_connectUpstream(): void {
		const localTalkbacks: Array<((type: number) => void) | null> = new Array(
			this._deps.length,
		).fill(null);
		this._upstreamTalkbacks = localTalkbacks;

		const actions: Actions<B> = {
			emit: (value: B) => {
				if (this._completed) return;
				this._value = value;
				if (this._sinks) {
					for (const sink of this._sinks) sink(DATA, value);
				}
			},
			signal: (s: Signal) => {
				if (this._completed) return;
				if (this._sinks) {
					for (const sink of this._sinks) sink(STATE, s);
				}
			},
			complete: () => {
				if (this._completed) return;
				this._completed = true;
				this._handler = null;
				if (this._sinks) {
					const snapshot = [...this._sinks];
					this._sinks.clear();
					this._sinks = null;
					for (const sink of snapshot) sink(END);
				}
			},
			error: (e: unknown) => {
				if (this._completed) return;
				this._completed = true;
				this._handler = null;
				if (this._sinks) {
					const snapshot = [...this._sinks];
					this._sinks.clear();
					this._sinks = null;
					for (const sink of snapshot) sink(END, e);
				}
			},
			disconnect: (dep?: number) => {
				if (dep !== undefined) {
					localTalkbacks[dep]?.(END);
					localTalkbacks[dep] = null;
				} else {
					for (const tb of localTalkbacks) tb?.(END);
					localTalkbacks.fill(null);
				}
			},
		};

		this._handler = this._init(actions);

		for (let i = 0; i < this._deps.length; i++) {
			const depIndex = i;
			this._deps[depIndex].source(START, (type: number, data: any) => {
				if (type === START) {
					localTalkbacks[depIndex] = data;
					return;
				}
				this._handler?.(depIndex, type, data);
			});
		}
	}

	_disconnectUpstream(): void {
		for (const tb of this._upstreamTalkbacks) tb?.(END);
		this._upstreamTalkbacks = [];
		this._handler = null;
	}

	get(): B {
		return this._value as B;
	}

	source(type: number, payload?: any): void {
		if (type === START) {
			const sink = payload;
			if (this._completed) {
				sink(START, (_t: number) => {});
				sink(END);
				return;
			}
			const wasEmpty = !this._sinks;
			if (!this._sinks) this._sinks = new Set();
			this._sinks.add(sink);
			if (wasEmpty) {
				this._connectUpstream();
			}
			sink(START, (t: number) => {
				if (t === DATA) sink(DATA, this._value);
				if (t === END) {
					if (!this._sinks) return;
					this._sinks.delete(sink);
					if (this._sinks.size === 0) {
						this._sinks = null;
						this._disconnectUpstream();
					}
				}
			});
		}
	}
}

export function operator<B>(
	deps: Store<unknown>[],
	init: (actions: Actions<B>) => (depIndex: number, type: number, data: any) => void,
	opts?: StoreOptions & { initial?: B },
): Store<B> {
	return new OperatorImpl<B>(deps, init, opts) as any;
}
