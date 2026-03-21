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
import type { LifecycleSignal, Signal } from "./protocol";
import {
	DATA,
	DIRTY,
	decodeStatus,
	END,
	isLifecycleSignal,
	RESET,
	RESOLVED,
	S_COMPLETED,
	S_DIRTY,
	S_DISCONNECTED,
	S_ERRORED,
	S_RESOLVED,
	S_SETTLED,
	SINGLE_DEP,
	START,
	STATE,
	STATUS_MASK,
	STATUS_SHIFT,
	TEARDOWN,
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
	_upstreamTalkbacks: Array<((type: number, data?: any) => void) | null> = [];
	_handler: ((depIndex: number, type: number, data: any) => void) | null = null;
	_flags: number;
	_deps: Store<unknown>[];
	_init: (actions: Actions<B>) => (depIndex: number, type: number, data: any) => void;
	_getterFn: ((cached: B | undefined) => B) | undefined;
	_initial: B | undefined;
	_errorData: unknown;
	_generation = 0;

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

	/** Create actions bound to a specific generation — stale generations become no-ops. */
	_createActions(gen: number): Actions<B> {
		const localTalkbacks = this._upstreamTalkbacks;
		return {
			seed: (value: B) => {
				if (gen !== this._generation) return;
				this._value = value;
			},
			emit: (value: B) => {
				if (gen !== this._generation) return;
				this._value = value;
				this._flags = (this._flags & ~_STATUS_MASK) | _S_SETTLED;
				this._dispatch(DATA, value);
			},
			signal: (s: Signal) => {
				if (gen !== this._generation) return;
				if (s === DIRTY) this._flags = (this._flags & ~_STATUS_MASK) | _S_DIRTY;
				else if (s === RESOLVED) this._flags = (this._flags & ~_STATUS_MASK) | _S_RESOLVED;
				this._dispatch(STATE, s);
			},
			complete: () => {
				if (gen !== this._generation) return;
				this._generation++; // invalidate this generation
				this._flags = ((this._flags | O_COMPLETED) & ~_STATUS_MASK) | _S_COMPLETED;
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
						for (const sink of output as Set<any>) {
							try {
								sink(END);
							} catch (_) {
								/* ensure all sinks receive END */
							}
						}
					} else {
						(output as (type: number, data?: any) => void)(END);
					}
				}
			},
			error: (e: unknown) => {
				if (gen !== this._generation) return;
				this._generation++; // invalidate this generation
				this._errorData = e;
				this._flags = ((this._flags | O_COMPLETED) & ~_STATUS_MASK) | _S_ERRORED;
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
						for (const sink of output as Set<any>) {
							try {
								sink(END, e);
							} catch (_) {
								/* ensure all sinks receive END */
							}
						}
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
	}

	_connectUpstream(): void {
		this._upstreamTalkbacks.length = this._deps.length;
		this._upstreamTalkbacks.fill(null);
		const localTalkbacks = this._upstreamTalkbacks;

		const gen = ++this._generation;
		const actions = this._createActions(gen);
		this._handler = this._init(actions);

		for (let i = 0; i < this._deps.length; i++) {
			if (gen !== this._generation) break;
			const depIndex = i;
			this._deps[depIndex].source(START, (type: number, data: any) => {
				if (type === START) {
					localTalkbacks[depIndex] = data;
					if (this._deps.length === 1) data(STATE, SINGLE_DEP);
					return;
				}
				this._handler?.(depIndex, type, data);
			});
		}
	}

	/**
	 * Handle lifecycle signals received via talkback (upstream direction).
	 * RESET: re-init handler with fresh state, forward upstream.
	 * TEARDOWN: forward upstream, then complete.
	 * PAUSE/RESUME: forward upstream.
	 */
	_handleLifecycleSignal(s: LifecycleSignal): void {
		if (this._flags & O_COMPLETED) return;

		if (s === TEARDOWN) {
			// Notify handler so it can do custom teardown work (e.g., task() calls ts.destroy())
			this._handler?.(0, STATE, TEARDOWN);
			// Forward upstream
			for (const tb of this._upstreamTalkbacks) tb?.(STATE, TEARDOWN);
			// Complete this operator inline (not through gen-guarded wrapper,
			// since handler notification above may have incremented generation)
			this._generation++;
			this._flags = ((this._flags | O_COMPLETED) & ~_STATUS_MASK) | _S_COMPLETED;
			this._handler = null;
			for (const tb of this._upstreamTalkbacks) tb?.(END);
			this._upstreamTalkbacks.fill(null);
			if (this._flags & O_RESET) this._value = this._initial;
			const output = this._output;
			const wasMulti = this._flags & O_MULTI;
			this._output = null;
			this._flags &= ~O_MULTI;
			if (output) {
				if (wasMulti) {
					for (const sink of output as Set<any>) {
						try {
							sink(END);
						} catch (_) {
							/* ensure all sinks receive END */
						}
					}
				} else {
					(output as (type: number, data?: any) => void)(END);
				}
			}
			return;
		}

		if (s === RESET) {
			// Re-init handler with fresh closure state (new generation invalidates old actions)
			const gen = ++this._generation;
			const actions = this._createActions(gen);
			this._handler = this._init(actions);
			if (this._flags & O_RESET) this._value = this._initial;
			// Notify the new handler so it can do custom lifecycle work
			// (e.g., task() interceptor calls ts.reset())
			this._handler?.(0, STATE, s);
		}

		// Forward all lifecycle signals upstream to deps
		for (const tb of this._upstreamTalkbacks) tb?.(STATE, s);
	}

	_disconnectUpstream(): void {
		for (const tb of this._upstreamTalkbacks) tb?.(END);
		this._upstreamTalkbacks.length = 0;
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
					const isErr = (this._flags & _STATUS_MASK) === _S_ERRORED;
					sink(START, (_t: number) => {});
					isErr ? sink(END, this._errorData) : sink(END);
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
			sink(START, (t: number, d?: any) => {
				if (t === DATA) sink(DATA, this._value);
				if (t === STATE && isLifecycleSignal(d)) {
					this._handleLifecycleSignal(d);
					return;
				}
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

/**
 * Creates a custom transform node: you handle every callbag signal from each dependency and decide what to forward.
 * Building block for Tier 1 operators; participates in diamond resolution when you forward STATE correctly.
 *
 * @param deps - Upstream stores (multi-dep uses bitmask dirty tracking).
 * @param init - Receives `emit`, `signal`, `complete`, `error`, `disconnect`, `seed`; return per-signal handler.
 * @param opts - `initial`, `getter`, `equals`, `name`, `resetOnTeardown`, etc. (see `SourceOptions`).
 *
 * @returns `Store<B>` — output store with standard `get()` / `source()`.
 *
 * @remarks **STATE channel:** Forward `DIRTY`/`RESOLVED` (and unknown signals) for correct graph behavior.
 * @remarks **Skip re-emit:** After DIRTY, if the output value is unchanged, call `signal(RESOLVED)` instead of `emit`.
 *
 * @example Double each value
 * ```ts
 * import { state, operator } from 'callbag-recharge';
 * import { DATA, STATE } from 'callbag-recharge';
 *
 * const n = state(2);
 * const doubled = operator<number>([n], ({ emit, signal }) => {
 *   return (_, type, data) => {
 *     if (type === STATE) signal(data);
 *     else if (type === DATA) emit((data as number) * 2);
 *   };
 * });
 * doubled.get(); // 4
 * ```
 *
 * @seeAlso [producer](./producer), [derived](./derived), [map](/api/map)
 */
export function operator<B>(
	deps: Store<unknown>[],
	init: (actions: Actions<B>) => (depIndex: number, type: number, data: any) => void,
	opts?: OperatorOpts<B>,
): Store<B> {
	return new OperatorImpl<B>(deps, init, opts) as any;
}
