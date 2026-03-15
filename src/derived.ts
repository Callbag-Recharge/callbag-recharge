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
 *
 * Note: implemented as a standalone primitive rather than on top of operator()
 * because it needs a custom get() (pull-fallback recompute when unconnected)
 * that operator does not support.
 */

import { Inspector } from "./inspector";
import { DATA, DIRTY, END, RESOLVED, START, STATE } from "./protocol";
import type { Store, StoreOptions } from "./types";

export class DerivedImpl<T> {
	_sinks: Set<any> | null = null;
	_upstreamTalkbacks: Array<(type: number) => void> = [];
	_cachedValue: T | undefined;
	_hasCached = false;
	_connected = false;
	_dirtyDeps = 0;
	_eqFn: ((a: T, b: T) => boolean) | undefined;
	_anyDataReceived = false;
	_deps: Store<unknown>[];
	_fn: () => T;

	constructor(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>) {
		this._deps = deps;
		this._fn = fn;
		this._eqFn = opts?.equals;

		this.source = this.source.bind(this);

		Inspector.register(this as any, { kind: "derived", ...opts });
	}

	_recompute(): void {
		const result = this._fn();
		if (this._eqFn && this._hasCached && this._eqFn(this._cachedValue as T, result)) {
			// Value unchanged — send RESOLVED (subtree skipping)
			if (this._sinks) {
				for (const sink of this._sinks) sink(STATE, RESOLVED);
			}
			return;
		}
		this._cachedValue = result;
		this._hasCached = true;
		if (this._sinks) {
			for (const sink of this._sinks) sink(DATA, this._cachedValue);
		}
	}

	_connectUpstream(): void {
		this._upstreamTalkbacks = [];
		for (let i = 0; i < this._deps.length; i++) {
			const depIndex = i;
			const depBit = 1 << depIndex;
			this._deps[depIndex].source(START, (type: number, data: any) => {
				if (type === START) {
					this._upstreamTalkbacks.push(data);
					return;
				}
				if (type === STATE) {
					if (data === DIRTY) {
						const wasEmpty = this._dirtyDeps === 0;
						this._dirtyDeps |= depBit;
						if (wasEmpty) {
							this._anyDataReceived = false;
							if (this._sinks) {
								for (const sink of this._sinks) sink(STATE, DIRTY);
							}
						}
					} else if (data === RESOLVED) {
						if (this._dirtyDeps & depBit) {
							this._dirtyDeps &= ~depBit;
							if (this._dirtyDeps === 0) {
								if (this._anyDataReceived) {
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
						this._anyDataReceived = true;
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
							this._anyDataReceived = true;
						}
					}
				}
			});
		}
	}

	_disconnectUpstream(): void {
		for (const tb of this._upstreamTalkbacks) tb(END);
		this._upstreamTalkbacks = [];
		this._connected = false;
		this._dirtyDeps = 0;
	}

	get(): T {
		if (this._connected && this._dirtyDeps === 0) {
			// Connected + settled — return cache
			return this._cachedValue as T;
		}
		// Not connected or pending — recompute on demand
		const result = this._fn();
		if (this._eqFn && this._hasCached && this._eqFn(this._cachedValue as T, result)) {
			return this._cachedValue as T;
		}
		if (this._eqFn) {
			this._cachedValue = result;
			this._hasCached = true;
		}
		return result;
	}

	source(type: number, payload?: any): void {
		if (type === START) {
			const sink = payload;
			const wasEmpty = !this._sinks;
			if (!this._sinks) this._sinks = new Set();
			this._sinks.add(sink);
			if (wasEmpty) {
				// Compute initial value before connecting upstream
				this._cachedValue = this._fn();
				this._hasCached = true;
				this._connectUpstream();
				this._connected = true;
			}
			sink(START, (t: number) => {
				if (t === DATA) sink(DATA, this._cachedValue);
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

export function derived<T>(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>): Store<T> {
	return new DerivedImpl<T>(deps, fn, opts) as any;
}
