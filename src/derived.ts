/**
 * Computed store with dirty tracking and caching. Recomputes fn() when
 * all dirty deps have resolved, emitting the new value on type 1 DATA.
 *
 * Stateful: maintains cached value. get() returns cache when settled,
 * recomputes when pending or unconnected.
 *
 * v3: Tier 1 — type 3 DIRTY/RESOLVED for diamond resolution. equals option
 * enables push-phase memoization via RESOLVED (skips entire subtree).
 * Type 1 DATA carries only real values.
 *
 * Class-based for V8 hidden class optimization and prototype method sharing.
 * Boolean fields packed into _flags bitmask to reduce hidden class size.
 *
 * Note: implemented as a standalone primitive rather than on top of operator()
 * because it needs a custom get() (pull-fallback recompute when unconnected)
 * that operator does not support.
 */

import { Inspector } from "./inspector";
import { DATA, DIRTY, END, RESOLVED, START, STATE } from "./protocol";
import type { Store, StoreOptions } from "./types";

// Flag bits for _flags bitmask
const D_HAS_CACHED = 1;
const D_CONNECTED = 2;
const D_ANY_DATA = 4;
const D_COMPLETED = 8;

export class DerivedImpl<T> {
	_sinks: Set<any> | null = null;
	_upstreamTalkbacks: Array<(type: number) => void> = [];
	_cachedValue: T | undefined;
	_flags: number;
	_dirtyDeps = 0;
	_eqFn: ((a: T, b: T) => boolean) | undefined;
	_deps: Store<unknown>[];
	_fn: () => T;

	constructor(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>) {
		this._deps = deps;
		this._fn = fn;
		this._eqFn = opts?.equals;
		this._flags = 0;

		this.source = this.source.bind(this);

		Inspector.register(this as any, { kind: "derived", ...opts });
	}

	_recompute(): void {
		const result = this._fn();
		if (this._eqFn && (this._flags & D_HAS_CACHED) && this._eqFn(this._cachedValue as T, result)) {
			// Value unchanged — send RESOLVED (subtree skipping)
			if (this._sinks) {
				for (const sink of this._sinks) sink(STATE, RESOLVED);
			}
			return;
		}
		this._cachedValue = result;
		this._flags |= D_HAS_CACHED;
		if (this._sinks) {
			for (const sink of this._sinks) sink(DATA, this._cachedValue);
		}
	}

	_connectUpstream(): void {
		this._upstreamTalkbacks = [];
		for (let i = 0; i < this._deps.length; i++) {
			if (this._flags & D_COMPLETED) break;
			const depIndex = i;
			const depBit = 1 << depIndex;
			this._deps[depIndex].source(START, (type: number, data: any) => {
				if (type === START) {
					this._upstreamTalkbacks.push(data);
					return;
				}
				if (this._flags & D_COMPLETED) return;
				if (type === STATE) {
					if (data === DIRTY) {
						const wasEmpty = this._dirtyDeps === 0;
						this._dirtyDeps |= depBit;
						if (wasEmpty) {
							this._flags &= ~D_ANY_DATA;
							if (this._sinks) {
								for (const sink of this._sinks) sink(STATE, DIRTY);
							}
						}
					} else if (data === RESOLVED) {
						if (this._dirtyDeps & depBit) {
							this._dirtyDeps &= ~depBit;
							if (this._dirtyDeps === 0) {
								if (this._flags & D_ANY_DATA) {
									this._recompute();
								} else {
									// All deps resolved without value change — skip fn()
									if (this._sinks) {
										for (const sink of this._sinks) sink(STATE, RESOLVED);
									}
								}
							}
						}
					}
				}
				if (type === DATA) {
					if (this._dirtyDeps & depBit) {
						this._dirtyDeps &= ~depBit;
						this._flags |= D_ANY_DATA;
						if (this._dirtyDeps === 0) {
							this._recompute();
						}
					} else {
						// DATA without prior DIRTY: dep bypasses the control channel
						// (e.g. a raw callbag source). Treat as immediate trigger.
						if (this._dirtyDeps === 0) {
							// No other dirty deps — signal and recompute immediately.
							if (this._sinks) {
								for (const sink of this._sinks) sink(STATE, DIRTY);
							}
							this._recompute();
						} else {
							// Other deps already dirty — mark that real data arrived
							// so we don't skip recompute when they resolve.
							this._flags |= D_ANY_DATA;
						}
					}
				}
				if (type === END) {
					// Dep completed or errored — derived can no longer recompute.
					// Disconnect all upstream, propagate END to sinks.
					this._flags |= D_COMPLETED;
					for (const tb of this._upstreamTalkbacks) tb(END);
					this._upstreamTalkbacks = [];
					this._flags &= ~D_CONNECTED;
					this._dirtyDeps = 0;
					const sinks = this._sinks;
					this._sinks = null;
					if (sinks) {
						if (data !== undefined) {
							for (const sink of sinks) sink(END, data);
						} else {
							for (const sink of sinks) sink(END);
						}
					}
				}
			});
		}
	}

	_disconnectUpstream(): void {
		for (const tb of this._upstreamTalkbacks) tb(END);
		this._upstreamTalkbacks = [];
		this._flags &= ~D_CONNECTED;
		this._dirtyDeps = 0;
	}

	get(): T {
		if ((this._flags & D_CONNECTED) && this._dirtyDeps === 0) {
			// Connected + settled — return cache
			return this._cachedValue as T;
		}
		// Not connected or pending — recompute on demand
		const result = this._fn();
		if (this._eqFn && (this._flags & D_HAS_CACHED) && this._eqFn(this._cachedValue as T, result)) {
			return this._cachedValue as T;
		}
		if (this._eqFn) {
			this._cachedValue = result;
			this._flags |= D_HAS_CACHED;
		}
		return result;
	}

	source(type: number, payload?: any): void {
		if (type === START) {
			const sink = payload;
			// Already completed — late subscriber gets END immediately
			if (this._flags & D_COMPLETED) {
				sink(START, (_t: number) => {});
				sink(END);
				return;
			}
			const wasEmpty = !this._sinks;
			if (!this._sinks) this._sinks = new Set();
			this._sinks.add(sink);
			if (wasEmpty) {
				// Compute initial value before connecting upstream
				this._cachedValue = this._fn();
				this._flags |= D_HAS_CACHED;
			}
			// Send START before connecting upstream — ensures correct protocol
			// order (START then END) if a dep sends END during connection.
			sink(START, (t: number) => {
				if (t === DATA) sink(DATA, this._cachedValue);
				if (t === END) {
					if (!this._sinks) return;
					this._sinks.delete(sink);
					if (this._sinks.size === 0) {
						this._sinks = null;
						if (!(this._flags & D_COMPLETED)) {
							this._disconnectUpstream();
						}
					}
				}
			});
			if (wasEmpty) {
				this._connectUpstream();
				if (!(this._flags & D_COMPLETED)) {
					this._flags |= D_CONNECTED;
				}
			}
		}
	}
}

export function derived<T>(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>): Store<T> {
	return new DerivedImpl<T>(deps, fn, opts) as any;
}
