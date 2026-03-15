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
 */

import { Inspector } from "./inspector";
import type { Signal } from "./protocol";
import { DATA, DIRTY, deferEmission, deferStart, END, isBatching, START, STATE } from "./protocol";
import type { ProducerStore, StoreOptions } from "./types";

export type ProducerFn<T> = (actions: {
	emit: (value: T) => void;
	signal: (s: Signal) => void;
	complete: () => void;
	error: (e: unknown) => void;
}) => (() => void) | undefined;

export type ProducerOpts<T> = StoreOptions<T> & {
	initial?: T;
	autoDirty?: boolean;
	resetOnTeardown?: boolean;
	getter?: (cached: T | undefined) => T;
	_skipInspect?: boolean;
};

export class ProducerImpl<T> {
	_value: T | undefined;
	_sinks: Set<any> | null = null;
	_started = false;
	_completed = false;
	_cleanup: (() => void) | undefined;
	_fn: ProducerFn<T> | undefined;
	_autoDirty: boolean;
	_eqFn: ((a: T, b: T) => boolean) | undefined;
	_getterFn: ((cached: T | undefined) => T) | undefined;
	_resetOnTeardown: boolean;
	_initial: T | undefined;
	_pendingEmission = false;

	constructor(fn?: ProducerFn<T>, opts?: ProducerOpts<T>) {
		this._value = opts?.initial;
		this._fn = fn;
		this._autoDirty = opts?.autoDirty !== false;
		this._eqFn = opts?.equals;
		this._getterFn = opts?.getter;
		this._resetOnTeardown = opts?.resetOnTeardown === true;
		this._initial = opts?.initial;

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
		if (this._completed) return;
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
			if (!this._pendingEmission) {
				this._pendingEmission = true;
				if (this._autoDirty) {
					for (const sink of sinks) sink(STATE, DIRTY);
				}
				deferEmission(() => {
					this._pendingEmission = false;
					if (this._sinks) {
						for (const sink of this._sinks) sink(DATA, this._value);
					}
				});
			}
		} else {
			if (this._autoDirty) {
				for (const sink of sinks) sink(STATE, DIRTY);
			}
			for (const sink of sinks) sink(DATA, this._value);
		}
	}

	signal(s: Signal): void {
		if (this._completed || !this._sinks) return;
		for (const sink of this._sinks) sink(STATE, s);
	}

	complete(): void {
		if (this._completed) return;
		this._completed = true;
		if (this._sinks) {
			for (const sink of this._sinks) sink(END);
			this._sinks.clear();
			this._sinks = null;
		}
		this._stop();
	}

	error(e: unknown): void {
		if (this._completed) return;
		this._completed = true;
		if (this._sinks) {
			for (const sink of this._sinks) sink(END, e);
			this._sinks.clear();
			this._sinks = null;
		}
		this._stop();
	}

	_start(): void {
		if (this._started || !this._fn) return;
		this._started = true;
		// Pass this directly — emit/signal/complete/error are bound in constructor
		const result = this._fn(this as any);
		this._cleanup = typeof result === "function" ? result : undefined;
	}

	_stop(): void {
		if (!this._started) return;
		this._started = false;
		if (this._cleanup) this._cleanup();
		this._cleanup = undefined;
		if (this._resetOnTeardown) this._value = this._initial;
	}

	source(type: number, payload?: any): void {
		if (type === START) {
			const sink = payload;
			if (this._completed) {
				sink(START, (_t: number) => {});
				sink(END);
				return;
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

export function producer<T>(fn?: ProducerFn<T>, opts?: ProducerOpts<T>): ProducerStore<T> {
	return new ProducerImpl<T>(fn, opts) as any;
}
