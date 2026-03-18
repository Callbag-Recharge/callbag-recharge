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
	SINGLE_DEP,
	decodeStatus,
	deferEmission,
	deferStart,
	END,
	isBatching,
	RESOLVED,
	S_COMPLETED,
	S_DIRTY,
	S_DISCONNECTED,
	S_ERRORED,
	S_RESOLVED,
	S_SETTLED,
	START,
	STATE,
	STATUS_MASK,
	STATUS_SHIFT,
} from "./protocol";
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

// Flag bits for _flags bitmask (bits 0-6)
const P_STARTED = 1;
const P_MULTI = 64;

// Exported for subclass fast paths (StateImpl)
export const P_COMPLETED = 2;
export const P_AUTO_DIRTY = 4;
const P_RESET = 8;
const P_RESUB = 16;
export const P_PENDING = 32;

// Bit 10: single subscriber signaled SINGLE_DEP — skip DIRTY in unbatched emit/set
export const P_SKIP_DIRTY = 1 << 10;

// Status bits (bits 7-9) — exported for StateImpl fast path
export const _STATUS_MASK = STATUS_MASK;
export const _S_DIRTY = S_DIRTY << STATUS_SHIFT;
export const _S_SETTLED = S_SETTLED << STATUS_SHIFT;
export const _S_DISCONNECTED = S_DISCONNECTED << STATUS_SHIFT;
export const _S_COMPLETED = S_COMPLETED << STATUS_SHIFT;
export const _S_ERRORED = S_ERRORED << STATUS_SHIFT;
export const _S_RESOLVED = S_RESOLVED << STATUS_SHIFT;

export class ProducerImpl<T> {
	_value: T | undefined;
	_output: ((type: number, data?: any) => void) | Set<any> | null = null;
	_flags: number;

	get _status() {
		return decodeStatus(this._flags);
	}
	_cleanup: (() => void) | undefined;
	_fn: ProducerFn<T> | undefined;
	_eqFn: ((a: T, b: T) => boolean) | undefined;
	_getterFn: ((cached: T | undefined) => T) | undefined;
	_initial: T | undefined;
	_singleDepCount = 0;

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
		// S_DISCONNECTED = 0, so no need to set status bits
		this._flags = flags;

		// Bind only source + emit (commonly detached in callbag interop and
		// destructuring). signal/complete/error are provided via actions wrapper
		// in _start() — see Optimization #2 in docs/optimizations.md.
		this.source = this.source.bind(this);
		this.emit = this.emit.bind(this);

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
			if (!(this._flags & P_PENDING)) {
				this._flags |= P_PENDING;
				if (this._flags & P_AUTO_DIRTY) {
					this._flags = (this._flags & ~_STATUS_MASK) | _S_DIRTY;
					this._dispatch(STATE, DIRTY);
				}
				deferEmission(() => {
					this._flags &= ~P_PENDING;
					this._flags = (this._flags & ~_STATUS_MASK) | _S_SETTLED;
					this._dispatch(DATA, this._value);
				});
			}
		} else {
			if (this._flags & P_AUTO_DIRTY && !(this._flags & P_SKIP_DIRTY)) {
				this._flags = (this._flags & ~_STATUS_MASK) | _S_DIRTY;
				this._dispatch(STATE, DIRTY);
			}
			this._flags = (this._flags & ~_STATUS_MASK) | _S_SETTLED;
			this._dispatch(DATA, this._value);
		}
	}

	signal(s: Signal): void {
		if (this._flags & P_COMPLETED || !this._output) return;
		if (s === DIRTY) this._flags = (this._flags & ~_STATUS_MASK) | _S_DIRTY;
		else if (s === RESOLVED) this._flags = (this._flags & ~_STATUS_MASK) | _S_RESOLVED;
		// Unknown signals: dispatch without _status change (v4 forward-compat)
		this._dispatch(STATE, s);
	}

	complete(): void {
		if (this._flags & P_COMPLETED) return;
		this._flags = ((this._flags | P_COMPLETED) & ~_STATUS_MASK) | _S_COMPLETED;
		const output = this._output;
		const wasMulti = this._flags & P_MULTI;
		this._output = null;
		this._flags &= ~(P_MULTI | P_SKIP_DIRTY);
		this._singleDepCount = 0;
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
		this._flags = ((this._flags | P_COMPLETED) & ~_STATUS_MASK) | _S_ERRORED;
		const output = this._output;
		const wasMulti = this._flags & P_MULTI;
		this._output = null;
		this._flags &= ~(P_MULTI | P_SKIP_DIRTY);
		this._singleDepCount = 0;
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
		if (this._flags & P_STARTED || !this._fn) return;
		this._flags |= P_STARTED;
		const result = this._fn({
			emit: this.emit,
			signal: (s: Signal) => this.signal(s),
			complete: () => this.complete(),
			error: (e: unknown) => this.error(e),
		} as any);
		this._cleanup = typeof result === "function" ? result : undefined;
	}

	_stop(): void {
		if (!(this._flags & P_STARTED)) return;
		this._flags &= ~P_STARTED;
		if (this._cleanup) this._cleanup();
		this._cleanup = undefined;
		if (this._flags & P_RESET) this._value = this._initial;
		if (!(this._flags & P_COMPLETED)) this._flags = (this._flags & ~_STATUS_MASK) | _S_DISCONNECTED;
	}

	source(type: number, payload?: any): void {
		if (type === START) {
			const sink = payload;
			if (this._flags & P_COMPLETED) {
				if (this._flags & P_RESUB && this._output === null) {
					this._flags = (this._flags & ~(P_COMPLETED | _STATUS_MASK)) | _S_DISCONNECTED;
				} else {
					sink(START, (_t: number) => {});
					sink(END);
					return;
				}
			}
			if (this._output === null) {
				this._output = sink;
			} else if (!(this._flags & P_MULTI)) {
				const set = new Set<any>();
				set.add(this._output);
				set.add(sink);
				this._output = set;
				this._flags = (this._flags | P_MULTI) & ~P_SKIP_DIRTY;
			} else {
				(this._output as Set<any>).add(sink);
			}
			let isSingleDep = false;
			sink(START, (t: number, d?: any) => {
				if (t === DATA) sink(DATA, this._value);
				if (t === STATE && d === SINGLE_DEP && !isSingleDep) {
					isSingleDep = true;
					this._singleDepCount++;
					if (!(this._flags & P_MULTI)) this._flags |= P_SKIP_DIRTY;
				}
				if (t === END) {
					if (isSingleDep) {
						isSingleDep = false;
						this._singleDepCount--;
					}
					if (this._output === null) return;
					if (this._flags & P_MULTI) {
						const set = this._output as Set<any>;
						set.delete(sink);
						if (set.size === 1) {
							this._output = set.values().next().value;
							this._flags &= ~P_MULTI;
							// Restore P_SKIP_DIRTY if remaining subscriber is single-dep
							if (this._singleDepCount > 0) this._flags |= P_SKIP_DIRTY;
						} else if (set.size === 0) {
							this._output = null;
							this._flags &= ~(P_MULTI | P_SKIP_DIRTY);
							this._singleDepCount = 0;
							this._flags = (this._flags & ~_STATUS_MASK) | _S_DISCONNECTED;
							this._stop();
						}
					} else if (this._output === sink) {
						this._output = null;
						this._flags &= ~P_SKIP_DIRTY;
						this._singleDepCount = 0;
						this._flags = (this._flags & ~_STATUS_MASK) | _S_DISCONNECTED;
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
