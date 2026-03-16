/**
 * General-purpose source primitive. Can emit values, send control signals,
 * complete, and error. Lazy start on first sink, auto-cleanup on last
 * sink disconnect.
 *
 * Stateful: maintains currentValue. get() returns currentValue (or
 * getter(currentValue) when getter option is provided).
 *
 * v4: Output slot model replaces _sinks Set. _output is null (no sinks),
 * a function (single sink — P0 optimization), or a Set (multi sink).
 * _status tracks node lifecycle. autoDirty (default true) sends DIRTY on
 * type 3 before each type 1 DATA. equals option guards emit();
 * resetOnTeardown resets value on stop.
 *
 * Class-based for V8 hidden class optimization and prototype method sharing.
 * Boolean fields packed into _flags bitmask to reduce hidden class size.
 */

import { Inspector } from "./inspector";
import type { NodeStatus, Signal } from "./protocol";
import { DATA, DIRTY, deferEmission, deferStart, END, isBatching, START, STATE } from "./protocol";
import type { ProducerStore, SourceOptions, Store } from "./types";

export type ProducerFn<T> = (actions: {
	emit: (value: T) => void;
	signal: (s: Signal) => void;
	complete: () => void;
	error: (e: unknown) => void;
}) => (() => void) | undefined;

export type ProducerOpts<T> = SourceOptions<T> & {
	autoDirty?: boolean;
	_skipInspect?: boolean;
};

// Flag bits for _flags bitmask
const P_STARTED = 1;
const P_COMPLETED = 2;
const P_AUTO_DIRTY = 4;
const P_RESET = 8;
const P_RESUB = 16;
const P_PENDING = 32;
const P_MULTI = 64;

export class ProducerImpl<T> {
	_value: T | undefined;
	_output: ((type: number, data?: any) => void) | Set<any> | null = null;
	_status: NodeStatus = "DISCONNECTED";
	_flags: number;
	_cleanup: (() => void) | undefined;
	_fn: ProducerFn<T> | undefined;
	_eqFn: ((a: T, b: T) => boolean) | undefined;
	_getterFn: ((cached: T | undefined) => T) | undefined;
	_initial: T | undefined;

	constructor(fn?: ProducerFn<T>, opts?: ProducerOpts<T>) {
		this._value = opts?.initial;
		this._fn = fn;
		this._eqFn = opts?.equals;
		this._getterFn = opts?.getter;
		this._initial = opts?.initial;

		let flags = 0;
		if (opts?.autoDirty !== false) flags |= P_AUTO_DIRTY;
		if (opts?.resetOnTeardown) flags |= P_RESET;
		if (opts?.resubscribable) flags |= P_RESUB;
		this._flags = flags;

		// Bind public API methods so they work when detached (callbag interop,
		// destructuring, etc.). Replaces per-instance closure functions.
		this.source = this.source.bind(this);
		this.emit = this.emit.bind(this);
		this.signal = this.signal.bind(this);
		this.complete = this.complete.bind(this);
		this.error = this.error.bind(this);

		if (!opts?._skipInspect) Inspector.register(this as any, { kind: "producer", ...opts });
	}

	get(): T | undefined {
		return this._getterFn ? this._getterFn(this._value) : this._value;
	}

	/**
	 * Dispatch a signal to all current subscribers via the output slot.
	 *
	 * Safety: P_MULTI flag and _output type are always updated together.
	 * No reentrancy can occur between the two assignments (source() doesn't
	 * trigger dispatch, and dispatch doesn't trigger source()). The null-check
	 * provides an additional guard for the MULTI→null transition path.
	 */
	_dispatch(type: number, data?: any): void {
		const output = this._output;
		if (!output) return;
		if (this._flags & P_MULTI) {
			for (const sink of output as Set<any>) sink(type, data);
		} else {
			(output as (type: number, data?: any) => void)(type, data);
		}
	}

	emit(value: T): void {
		if (this._flags & P_COMPLETED) return;
		if (this._eqFn && this._value !== undefined && this._eqFn(this._value as T, value)) return;
		this._value = value;
		if (!this._output) return;
		if (isBatching()) {
			// Coalesce: send DIRTY and register deferred DATA only once per batch cycle.
			// Subsequent emit() calls just update _value; the deferred closure
			// reads it at drain time, so only the latest value is emitted.
			if (!(this._flags & P_PENDING)) {
				this._flags |= P_PENDING;
				if (this._flags & P_AUTO_DIRTY) {
					this._status = "DIRTY";
					this._dispatch(STATE, DIRTY);
				}
				deferEmission(() => {
					this._flags &= ~P_PENDING;
					this._status = "SETTLED";
					this._dispatch(DATA, this._value);
				});
			}
		} else {
			if (this._flags & P_AUTO_DIRTY) {
				this._status = "DIRTY";
				this._dispatch(STATE, DIRTY);
			}
			this._status = "SETTLED";
			this._dispatch(DATA, this._value);
		}
	}

	signal(s: Signal): void {
		if ((this._flags & P_COMPLETED) || !this._output) return;
		if (s === DIRTY) this._status = "DIRTY";
		else this._status = "RESOLVED";
		this._dispatch(STATE, s);
	}

	complete(): void {
		if (this._flags & P_COMPLETED) return;
		this._flags |= P_COMPLETED;
		this._status = "COMPLETED";
		// Move output reference to local, null field before notify — prevents
		// reentrancy issues when a sink re-subscribes during END (e.g. retry
		// with resubscribable). No snapshot array allocation needed.
		const output = this._output;
		const wasMulti = this._flags & P_MULTI;
		this._output = null;
		this._flags &= ~P_MULTI;
		this._stop();
		if (output) {
			if (wasMulti) {
				for (const sink of output as Set<any>) sink(END);
			} else {
				(output as (type: number, data?: any) => void)(END);
			}
		}
	}

	error(e: unknown): void {
		if (this._flags & P_COMPLETED) return;
		this._flags |= P_COMPLETED;
		this._status = "ERRORED";
		const output = this._output;
		const wasMulti = this._flags & P_MULTI;
		this._output = null;
		this._flags &= ~P_MULTI;
		this._stop();
		if (output) {
			if (wasMulti) {
				for (const sink of output as Set<any>) sink(END, e);
			} else {
				(output as (type: number, data?: any) => void)(END, e);
			}
		}
	}

	_start(): void {
		if ((this._flags & P_STARTED) || !this._fn) return;
		this._flags |= P_STARTED;
		// Pass this directly — emit/signal/complete/error are bound in constructor
		const result = this._fn(this as any);
		this._cleanup = typeof result === "function" ? result : undefined;
	}

	_stop(): void {
		if (!(this._flags & P_STARTED)) return;
		this._flags &= ~P_STARTED;
		if (this._cleanup) this._cleanup();
		this._cleanup = undefined;
		if (this._flags & P_RESET) this._value = this._initial;
		// Defensive: ensure status reflects disconnected state.
		// Callers (talkback END) already set this, but _stop() should be
		// self-contained for safety. Skip if terminal (COMPLETED/ERRORED).
		if (!(this._flags & P_COMPLETED)) this._status = "DISCONNECTED";
	}

	source(type: number, payload?: any): void {
		if (type === START) {
			const sink = payload;
			if (this._flags & P_COMPLETED) {
				if ((this._flags & P_RESUB) && this._output === null) {
					this._flags &= ~P_COMPLETED;
					this._status = "DISCONNECTED";
				} else {
					sink(START, (_t: number) => {});
					sink(END);
					return;
				}
			}
			// Output slot transitions: null → SINGLE, SINGLE → MULTI
			if (this._output === null) {
				this._output = sink;
			} else if (!(this._flags & P_MULTI)) {
				const set = new Set<any>();
				set.add(this._output);
				set.add(sink);
				this._output = set;
				this._flags |= P_MULTI;
			} else {
				(this._output as Set<any>).add(sink);
			}
			sink(START, (t: number) => {
				if (t === DATA) sink(DATA, this._value);
				if (t === END) {
					if (this._output === null) return;
					if (this._flags & P_MULTI) {
						const set = this._output as Set<any>;
						set.delete(sink);
						if (set.size === 1) {
							// MULTI → SINGLE
							this._output = set.values().next().value;
							this._flags &= ~P_MULTI;
						} else if (set.size === 0) {
							// MULTI → null
							this._output = null;
							this._flags &= ~P_MULTI;
							this._status = "DISCONNECTED";
							this._stop();
						}
					} else if (this._output === sink) {
						// SINGLE → null
						this._output = null;
						this._status = "DISCONNECTED";
						this._stop();
					}
				}
			});
			deferStart(() => this._start());
		}
	}
}

export function producer<T>(
	fn: ProducerFn<T> | undefined,
	opts: ProducerOpts<T> & { initial: T },
): ProducerStore<T> & Store<T>;
export function producer<T>(fn?: ProducerFn<T>, opts?: ProducerOpts<T>): ProducerStore<T>;
export function producer<T>(fn?: ProducerFn<T>, opts?: ProducerOpts<T>): ProducerStore<T> {
	return new ProducerImpl<T>(fn, opts) as any;
}
