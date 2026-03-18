/**
 * General-purpose transform primitive. Receives all signal types from upstream
 * deps and decides what to forward.
 *
 * v5: _status packed into _flags bits 7-9 for hot-path performance.
 * String status exposed via getter for Inspector/test backward compat.
 *
 * Class-based for V8 hidden class optimization and prototype method sharing.
 * Boolean fields packed into _flags bitmask to reduce hidden class size.
 */

import { Inspector } from "./inspector";
import type { Signal } from "./protocol";
import {
	DATA,
	DIRTY,
	END,
	RESOLVED,
	START,
	STATE,
	STATUS_MASK,
	STATUS_SHIFT,
	S_COMPLETED,
	S_DIRTY,
	S_DISCONNECTED,
	S_ERRORED,
	S_RESOLVED,
	S_SETTLED,
	decodeStatus,
} from "./protocol";
import type { Actions, SourceOptions, Store } from "./types";

export type OperatorOpts<B> = SourceOptions<B>;

// Flag bits for _flags bitmask (bits 0-6)
const O_COMPLETED = 1;
const O_RESET = 2;
const O_RESUB = 4;
const O_MULTI = 8;

// Pre-shifted status constants for hot-path writes
const _S_DISCONNECTED = S_DISCONNECTED << STATUS_SHIFT;
const _S_DIRTY = S_DIRTY << STATUS_SHIFT;
const _S_SETTLED = S_SETTLED << STATUS_SHIFT;
const _S_RESOLVED = S_RESOLVED << STATUS_SHIFT;
const _S_COMPLETED = S_COMPLETED << STATUS_SHIFT;
const _S_ERRORED = S_ERRORED << STATUS_SHIFT;
const _STATUS_MASK = STATUS_MASK;

export class OperatorImpl<B> {
	_value: B | undefined;
	_output: ((type: number, data?: any) => void) | Set<any> | null = null;
	_upstreamTalkbacks: Array<((type: number) => void) | null> = [];
	_handler: ((depIndex: number, type: number, data: any) => void) | null = null;
	_flags: number;
	_deps: Store<unknown>[];
	_init: (actions: Actions<B>) => (depIndex: number, type: number, data: any) => void;
	_getterFn: ((cached: B | undefined) => B) | undefined;
	_initial: B | undefined;

	get _status() {
		return decodeStatus(this._flags);
	}

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
		// S_DISCONNECTED = 0, so no status bits needed
		this._flags = flags;

		this.source = this.source.bind(this);

		Inspector.register(this as any, { kind: opts?.kind ?? "operator", ...opts, deps });
		for (const dep of deps) Inspector.registerEdge(dep, this as any);
	}

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

		let completed = false;

		const actions: Actions<B> = {
			seed: (value: B) => {
				if (completed) return;
				this._value = value;
			},
			emit: (value: B) => {
				if (completed) return;
				this._value = value;
				this._flags = (this._flags & ~_STATUS_MASK) | _S_SETTLED;
				this._dispatch(DATA, value);
			},
			signal: (s: Signal) => {
				if (completed) return;
				if (s === DIRTY) this._flags = (this._flags & ~_STATUS_MASK) | _S_DIRTY;
				else if (s === RESOLVED) this._flags = (this._flags & ~_STATUS_MASK) | _S_RESOLVED;
				this._dispatch(STATE, s);
			},
			complete: () => {
				if (completed) return;
				completed = true;
				this._flags = (this._flags | O_COMPLETED) & ~_STATUS_MASK | _S_COMPLETED;
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
						for (const sink of output as Set<any>) sink(END);
					} else {
						(output as (type: number, data?: any) => void)(END);
					}
				}
			},
			error: (e: unknown) => {
				if (completed) return;
				completed = true;
				this._flags = (this._flags | O_COMPLETED) & ~_STATUS_MASK | _S_ERRORED;
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
		this._flags = (this._flags & ~_STATUS_MASK) | _S_DISCONNECTED;
		if (this._flags & O_RESET) this._value = this._initial;
	}

	get(): B {
		if (this._getterFn && !this._output) {
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
					this._flags = (this._flags & ~(O_COMPLETED | _STATUS_MASK)) | _S_DISCONNECTED;
				} else {
					sink(START, (_t: number) => {});
					sink(END);
					return;
				}
			}
			const wasEmpty = this._output === null;
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
			sink(START, (t: number) => {
				if (t === DATA) sink(DATA, this._value);
				if (t === END) {
					if (this._output === null) return;
					if (this._flags & O_MULTI) {
						const set = this._output as Set<any>;
						set.delete(sink);
						if (set.size === 1) {
							this._output = set.values().next().value;
							this._flags &= ~O_MULTI;
						} else if (set.size === 0) {
							this._output = null;
							this._flags &= ~O_MULTI;
							this._disconnectUpstream();
						}
					} else if (this._output === sink) {
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
