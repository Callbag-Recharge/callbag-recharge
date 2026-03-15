/**
 * General-purpose source primitive. Can emit values, send control signals,
 * complete, and error. Lazy start on first sink, auto-cleanup on last
 * sink disconnect.
 *
 * Stateful: maintains currentValue. get() returns currentValue (or
 * getter(currentValue) when getter option is provided).
 *
 * v3: autoDirty (default true) sends DIRTY on type 3 before each type 1
 * DATA. equals option guards emit(); resetOnTeardown resets value on stop.
 *
 * Class-based for V8 hidden class optimization and prototype method sharing.
 * Boolean fields packed into _flags bitmask to reduce hidden class size.
 */

import { Inspector } from "./inspector";
import type { Signal } from "./protocol";
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

export class ProducerImpl<T> {
	_value: T | undefined;
	_sinks: Set<any> | null = null;
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

	emit(value: T): void {
		if (this._flags & P_COMPLETED) return;
		if (this._eqFn && this._value !== undefined && this._eqFn(this._value as T, value)) return;
		this._value = value;
		// Capture sinks locally — a sink callback during DIRTY propagation may
		// disconnect and null _sinks before the DATA loop runs.
		const sinks = this._sinks;
		if (!sinks) return;
		if (isBatching()) {
			// Coalesce: send DIRTY and register deferred DATA only once per batch cycle.
			// Subsequent emit() calls just update _value; the deferred closure
			// reads it at drain time, so only the latest value is emitted.
			if (!(this._flags & P_PENDING)) {
				this._flags |= P_PENDING;
				if (this._flags & P_AUTO_DIRTY) {
					for (const sink of sinks) sink(STATE, DIRTY);
				}
				deferEmission(() => {
					this._flags &= ~P_PENDING;
					if (this._sinks) {
						for (const sink of this._sinks) sink(DATA, this._value);
					}
				});
			}
		} else {
			if (this._flags & P_AUTO_DIRTY) {
				for (const sink of sinks) sink(STATE, DIRTY);
			}
			for (const sink of sinks) sink(DATA, this._value);
		}
	}

	signal(s: Signal): void {
		if ((this._flags & P_COMPLETED) || !this._sinks) return;
		for (const sink of this._sinks) sink(STATE, s);
	}

	complete(): void {
		if (this._flags & P_COMPLETED) return;
		this._flags |= P_COMPLETED;
		// Move sinks reference to local, null field before notify — prevents
		// reentrancy issues when a sink re-subscribes during END (e.g. retry
		// with resubscribable). No snapshot array allocation needed.
		const sinks = this._sinks;
		this._sinks = null;
		this._stop();
		if (sinks) {
			for (const sink of sinks) sink(END);
		}
	}

	error(e: unknown): void {
		if (this._flags & P_COMPLETED) return;
		this._flags |= P_COMPLETED;
		const sinks = this._sinks;
		this._sinks = null;
		this._stop();
		if (sinks) {
			for (const sink of sinks) sink(END, e);
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
	}

	source(type: number, payload?: any): void {
		if (type === START) {
			const sink = payload;
			if (this._flags & P_COMPLETED) {
				if ((this._flags & P_RESUB) && this._sinks === null) {
					this._flags &= ~P_COMPLETED;
				} else {
					sink(START, (_t: number) => {});
					sink(END);
					return;
				}
			}
			if (!this._sinks) this._sinks = new Set();
			this._sinks.add(sink);
			sink(START, (t: number) => {
				if (t === DATA) sink(DATA, this._value);
				if (t === END) {
					if (!this._sinks) return;
					this._sinks.delete(sink);
					if (this._sinks.size === 0) {
						this._sinks = null;
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
