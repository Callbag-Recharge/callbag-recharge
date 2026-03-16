/**
 * General-purpose transform primitive. Receives all signal types from upstream
 * deps and decides what to forward. The init function receives actions and
 * returns a handler called for every event from every dep, with depIndex
 * indicating which dep sent it.
 *
 * Stateful: maintains cached value via actions.emit(). get() returns the
 * last emitted value. Lazy connection on first sink, disconnects when empty.
 *
 * v4: Output slot model replaces _sinks Set. _output is null (no sinks),
 * a function (single sink), or a Set (multi sink). _status tracks node
 * lifecycle. Tier 1 — participates in diamond resolution. Handler receives
 * type 3 STATE signals and decides whether to forward DIRTY/RESOLVED.
 *
 * Class-based for V8 hidden class optimization and prototype method sharing.
 * Boolean fields packed into _flags bitmask to reduce hidden class size.
 *
 * Options precedence — see SourceOptions in types.ts for full documentation.
 * get() flow: disconnected + getter → getter(cached) → cache result → return
 *             connected or no getter → return _value
 * teardown:   resetOnTeardown → _value = _initial
 *             next get() with getter will recompute from deps
 */

import { Inspector } from "./inspector";
import type { NodeStatus, Signal } from "./protocol";
import { DATA, DIRTY, END, RESOLVED, START, STATE } from "./protocol";
import type { Actions, SourceOptions, Store } from "./types";

export type OperatorOpts<B> = SourceOptions<B>;

// Flag bits for _flags bitmask
const O_COMPLETED = 1;
const O_RESET = 2;
const O_RESUB = 4;
const O_MULTI = 8;

export class OperatorImpl<B> {
	_value: B | undefined;
	_output: ((type: number, data?: any) => void) | Set<any> | null = null;
	_status: NodeStatus = "DISCONNECTED";
	_upstreamTalkbacks: Array<((type: number) => void) | null> = [];
	_handler: ((depIndex: number, type: number, data: any) => void) | null = null;
	_flags: number;
	_deps: Store<unknown>[];
	_init: (actions: Actions<B>) => (depIndex: number, type: number, data: any) => void;
	_getterFn: ((cached: B | undefined) => B) | undefined;
	_initial: B | undefined;

	constructor(
		deps: Store<unknown>[],
		init: (actions: Actions<B>) => (depIndex: number, type: number, data: any) => void,
		opts?: OperatorOpts<B>,
	) {
		this._value = opts?.initial;
		this._initial = opts?.initial;
		this._deps = deps;
		this._init = init;
		this._getterFn = opts?.getter;

		let flags = 0;
		if (opts?.resetOnTeardown) flags |= O_RESET;
		if (opts?.resubscribable) flags |= O_RESUB;
		this._flags = flags;

		this.source = this.source.bind(this);

		Inspector.register(this as any, { kind: opts?.kind ?? "operator", ...opts });
	}

	/**
	 * Dispatch a signal to all current subscribers via the output slot.
	 * See ProducerImpl._dispatch for safety invariant documentation.
	 */
	_dispatch(type: number, data?: any): void {
		const output = this._output;
		if (!output) return;
		if (this._flags & O_MULTI) {
			for (const sink of output as Set<any>) sink(type, data);
		} else {
			(output as (type: number, data?: any) => void)(type, data);
		}
	}

	_connectUpstream(): void {
		const localTalkbacks: Array<((type: number) => void) | null> = new Array(
			this._deps.length,
		).fill(null);
		this._upstreamTalkbacks = localTalkbacks;

		// Local completed flag — faster than this._flags property access in the
		// hot-path action closures (emit/signal called on every upstream event).
		let completed = false;

		const actions: Actions<B> = {
			seed: (value: B) => {
				if (completed) return;
				this._value = value;
			},
			emit: (value: B) => {
				if (completed) return;
				this._value = value;
				this._status = "SETTLED";
				this._dispatch(DATA, value);
			},
			signal: (s: Signal) => {
				if (completed) return;
				if (s === DIRTY) this._status = "DIRTY";
				else if (s === RESOLVED) this._status = "RESOLVED";
				// Unknown signals: dispatch without _status change (v4 forward-compat)
				this._dispatch(STATE, s);
			},
			complete: () => {
				if (completed) return;
				completed = true;
				this._flags |= O_COMPLETED;
				this._status = "COMPLETED";
				this._handler = null;
				// Disconnect upstream to release resources (producers stop,
				// intervals clear, etc.). Must happen before notifying sinks
				// to prevent upstream from sending more events.
				for (const tb of localTalkbacks) tb?.(END);
				localTalkbacks.fill(null);
				// Apply resetOnTeardown (matches producer._stop() behavior)
				if (this._flags & O_RESET) this._value = this._initial;
				// Move output reference to local, null field before notify —
				// no snapshot array allocation needed.
				const output = this._output;
				const wasMulti = this._flags & O_MULTI;
				this._output = null;
				this._flags &= ~O_MULTI;
				if (output) {
					if (wasMulti) {
						for (const sink of output as Set<any>) sink(END);
					} else {
						(output as (type: number, data?: any) => void)(END);
					}
				}
			},
			error: (e: unknown) => {
				if (completed) return;
				completed = true;
				this._flags |= O_COMPLETED;
				this._status = "ERRORED";
				this._handler = null;
				for (const tb of localTalkbacks) tb?.(END);
				localTalkbacks.fill(null);
				if (this._flags & O_RESET) this._value = this._initial;
				const output = this._output;
				const wasMulti = this._flags & O_MULTI;
				this._output = null;
				this._flags &= ~O_MULTI;
				if (output) {
					if (wasMulti) {
						for (const sink of output as Set<any>) sink(END, e);
					} else {
						(output as (type: number, data?: any) => void)(END, e);
					}
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
			if (completed) break;
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
		this._status = "DISCONNECTED";
		if (this._flags & O_RESET) this._value = this._initial;
	}

	get(): B {
		if (this._getterFn && !this._output) {
			// Disconnected: pull-based recompute (mirrors derived's get() behavior).
			// Result is cached so subsequent get() with same dep values is stable.
			const v = this._getterFn(this._value);
			this._value = v;
			return v;
		}
		return this._value as B;
	}

	source(type: number, payload?: any): void {
		if (type === START) {
			const sink = payload;
			if (this._flags & O_COMPLETED) {
				if (this._flags & O_RESUB && this._output === null) {
					this._flags &= ~O_COMPLETED;
					this._status = "DISCONNECTED";
				} else {
					sink(START, (_t: number) => {});
					sink(END);
					return;
				}
			}
			const wasEmpty = this._output === null;
			// Output slot transitions: null → SINGLE, SINGLE → MULTI
			if (this._output === null) {
				this._output = sink;
			} else if (!(this._flags & O_MULTI)) {
				const set = new Set<any>();
				set.add(this._output);
				set.add(sink);
				this._output = set;
				this._flags |= O_MULTI;
			} else {
				(this._output as Set<any>).add(sink);
			}
			// Send START before connecting upstream — ensures correct protocol
			// order (START then END) if a dep sends END during connection.
			sink(START, (t: number) => {
				if (t === DATA) sink(DATA, this._value);
				if (t === END) {
					if (this._output === null) return;
					if (this._flags & O_MULTI) {
						const set = this._output as Set<any>;
						set.delete(sink);
						if (set.size === 1) {
							// MULTI → SINGLE
							this._output = set.values().next().value;
							this._flags &= ~O_MULTI;
						} else if (set.size === 0) {
							// MULTI → null
							this._output = null;
							this._flags &= ~O_MULTI;
							this._disconnectUpstream();
						}
					} else if (this._output === sink) {
						// SINGLE → null
						this._output = null;
						this._disconnectUpstream();
					}
				}
			});
			if (wasEmpty) {
				this._connectUpstream();
			}
		}
	}
}

export function operator<B>(
	deps: Store<unknown>[],
	init: (actions: Actions<B>) => (depIndex: number, type: number, data: any) => void,
	opts?: OperatorOpts<B>,
): Store<B> {
	return new OperatorImpl<B>(deps, init, opts) as any;
}
