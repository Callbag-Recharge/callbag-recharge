/**
 * Computed store with dirty tracking and caching. Recomputes fn() when
 * all dirty deps have resolved, emitting the new value on type 1 DATA.
 *
 * v4: Output slot model replaces _sinks Set. _status tracks node lifecycle.
 * Single-dep nodes skip bitmask (P0 optimization). get() always returns
 * cached value (populated at construction and kept current by STANDALONE
 * connection).
 *
 * v4.1: Lazy STANDALONE — deps connection deferred until first get() or
 * source() call. Stores that are never read or subscribed skip STANDALONE
 * overhead entirely. Identity mode (derived.from) skips fn() on recompute,
 * forwarding upstream DATA directly.
 *
 * Class-based for V8 hidden class optimization and prototype method sharing.
 * Boolean fields packed into _flags bitmask to reduce hidden class size.
 */

import { Bitmask } from "./bitmask";
import { Inspector } from "./inspector";
import type { NodeStatus } from "./protocol";
import {
	beginDeferredStart,
	DATA,
	DIRTY,
	END,
	endDeferredStart,
	RESOLVED,
	START,
	STATE,
} from "./protocol";
import type { Store, StoreOptions } from "./types";

// Flag bits for _flags bitmask
const D_HAS_CACHED = 1;
const D_CONNECTED = 2;
const D_ANY_DATA = 4;
const D_COMPLETED = 8;
const D_STANDALONE = 16;
const D_MULTI = 32;
const D_IDENTITY = 64;

export class DerivedImpl<T> {
	_output: ((type: number, data?: any) => void) | Set<any> | null = null;
	_status: NodeStatus;
	_upstreamTalkbacks: Array<(type: number) => void> = [];
	_cachedValue: T | undefined;
	_flags: number;
	_dirtyDeps!: Bitmask;
	_eqFn: ((a: T, b: T) => boolean) | undefined;
	_deps: Store<unknown>[];
	_fn: () => T;

	constructor(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>, identity?: boolean) {
		this._deps = deps;
		this._fn = fn;
		this._eqFn = opts?.equals;
		this._flags = identity ? D_IDENTITY : 0;
		this._dirtyDeps = new Bitmask(deps.length);

		this.source = this.source.bind(this);

		Inspector.register(this as any, { kind: "derived", ...opts, deps });
		for (const dep of deps) Inspector.registerEdge(dep, this as any);

		// v4.1: Fully lazy — no computation or connection at construction.
		// _cachedValue remains undefined until first get()/source().
		// This means derived stores that are never accessed incur zero overhead
		// beyond the object allocation itself.
		this._status = "DISCONNECTED";
	}

	/**
	 * Dispatch a signal to all current subscribers via the output slot.
	 * See ProducerImpl._dispatch for safety invariant documentation.
	 */
	_dispatch(type: number, data?: any): void {
		const output = this._output;
		if (!output) return;
		if (this._flags & D_MULTI) {
			for (const sink of output as Set<any>) sink(type, data);
		} else {
			(output as (type: number, data?: any) => void)(type, data);
		}
	}

	_recompute(): void {
		const result = this._fn();
		if (this._eqFn && this._flags & D_HAS_CACHED && this._eqFn(this._cachedValue as T, result)) {
			// Value unchanged — send RESOLVED (subtree skipping)
			this._status = "RESOLVED";
			this._dispatch(STATE, RESOLVED);
			return;
		}
		this._cachedValue = result;
		this._flags |= D_HAS_CACHED;
		this._status = "SETTLED";
		this._dispatch(DATA, this._cachedValue);
	}

	/** Identity-mode recompute: forward upstream data directly, skip fn() */
	_recomputeIdentity(data: T): void {
		if (this._eqFn && this._flags & D_HAS_CACHED && this._eqFn(this._cachedValue as T, data)) {
			this._status = "RESOLVED";
			this._dispatch(STATE, RESOLVED);
			return;
		}
		this._cachedValue = data;
		this._flags |= D_HAS_CACHED;
		this._status = "SETTLED";
		this._dispatch(DATA, data);
	}

	/**
	 * Lazy STANDALONE connection — deferred from constructor to first use.
	 * Computes _cachedValue and subscribes to deps.
	 */
	_lazyConnect(): void {
		if (this._flags & (D_CONNECTED | D_COMPLETED)) return;
		// Compute value from current dep state, then subscribe for future updates
		this._cachedValue = this._fn();
		this._flags |= D_HAS_CACHED;
		this._status = "SETTLED";
		beginDeferredStart();
		this._connectUpstream();
		if (!(this._flags & D_COMPLETED)) {
			this._flags |= D_CONNECTED;
		}
		endDeferredStart();
	}

	_connectUpstream(): void {
		this._upstreamTalkbacks = [];
		if (this._deps.length === 1) {
			if (this._flags & D_IDENTITY) {
				this._connectSingleDepIdentity();
			} else {
				this._connectSingleDep();
			}
		} else {
			this._connectMultiDep();
		}
	}

	/** Single-dep: no bitmask, direct forward (P0 optimization) */
	_connectSingleDep(): void {
		let dirty = false;
		this._deps[0].source(START, (type: number, data: any) => {
			if (type === START) {
				this._upstreamTalkbacks.push(data);
				return;
			}
			if (this._flags & D_COMPLETED) return;

			if (type === STATE) {
				if (data === DIRTY) {
					dirty = true;
					this._status = "DIRTY";
					this._dispatch(STATE, DIRTY);
				} else if (data === RESOLVED) {
					if (dirty) {
						dirty = false;
						this._status = "RESOLVED";
						this._dispatch(STATE, RESOLVED);
					}
				} else {
					// Unknown STATE signal — forward unchanged (§6)
					this._dispatch(STATE, data);
				}
			} else if (type === DATA) {
				if (dirty) {
					dirty = false;
					this._recompute();
				} else {
					// DATA without prior DIRTY (raw callbag compat)
					this._status = "DIRTY";
					this._dispatch(STATE, DIRTY);
					this._recompute();
				}
			} else if (type === END) {
				this._handleEnd(data);
			}
		});
	}

	/** Single-dep identity mode: forward upstream DATA directly, skip fn() */
	_connectSingleDepIdentity(): void {
		let dirty = false;
		this._deps[0].source(START, (type: number, data: any) => {
			if (type === START) {
				this._upstreamTalkbacks.push(data);
				return;
			}
			if (this._flags & D_COMPLETED) return;

			if (type === STATE) {
				if (data === DIRTY) {
					dirty = true;
					this._status = "DIRTY";
					this._dispatch(STATE, DIRTY);
				} else if (data === RESOLVED) {
					if (dirty) {
						dirty = false;
						this._status = "RESOLVED";
						this._dispatch(STATE, RESOLVED);
					}
				} else {
					this._dispatch(STATE, data);
				}
			} else if (type === DATA) {
				if (dirty) {
					dirty = false;
					this._recomputeIdentity(data);
				} else {
					this._status = "DIRTY";
					this._dispatch(STATE, DIRTY);
					this._recomputeIdentity(data);
				}
			} else if (type === END) {
				this._handleEnd(data);
			}
		});
	}

	/** Multi-dep: bitmask-based diamond resolution */
	_connectMultiDep(): void {
		for (let i = 0; i < this._deps.length; i++) {
			if (this._flags & D_COMPLETED) break;
			const depIndex = i;
			this._deps[depIndex].source(START, (type: number, data: any) => {
				if (type === START) {
					this._upstreamTalkbacks.push(data);
					return;
				}
				if (this._flags & D_COMPLETED) return;

				if (type === STATE) {
					if (data === DIRTY) {
						const wasEmpty = this._dirtyDeps.empty();
						this._dirtyDeps.set(depIndex);
						if (wasEmpty) {
							this._flags &= ~D_ANY_DATA;
							this._status = "DIRTY";
							this._dispatch(STATE, DIRTY);
						}
					} else if (data === RESOLVED) {
						if (this._dirtyDeps.test(depIndex)) {
							this._dirtyDeps.clear(depIndex);
							if (this._dirtyDeps.empty()) {
								if (this._flags & D_ANY_DATA) {
									this._recompute();
								} else {
									// All deps resolved without value change — skip fn()
									this._status = "RESOLVED";
									this._dispatch(STATE, RESOLVED);
								}
							}
						}
					} else {
						// Unknown STATE signal — forward unchanged (§6)
						this._dispatch(STATE, data);
					}
				} else if (type === DATA) {
					if (this._dirtyDeps.test(depIndex)) {
						this._dirtyDeps.clear(depIndex);
						this._flags |= D_ANY_DATA;
						if (this._dirtyDeps.empty()) {
							this._recompute();
						}
					} else {
						// DATA without prior DIRTY: raw callbag compat
						if (this._dirtyDeps.empty()) {
							this._status = "DIRTY";
							this._dispatch(STATE, DIRTY);
							this._recompute();
						} else {
							this._flags |= D_ANY_DATA;
						}
					}
				} else if (type === END) {
					this._handleEnd(data);
				}
			});
		}
	}

	/** Handle upstream END (completion or error) */
	_handleEnd(errorData: any): void {
		this._flags |= D_COMPLETED;
		this._status = errorData !== undefined ? "ERRORED" : "COMPLETED";
		for (const tb of this._upstreamTalkbacks) tb(END);
		this._upstreamTalkbacks = [];
		this._flags &= ~(D_CONNECTED | D_STANDALONE);
		this._dirtyDeps.reset();
		const output = this._output;
		const wasMulti = this._flags & D_MULTI;
		this._output = null;
		this._flags &= ~D_MULTI;
		if (output) {
			if (wasMulti) {
				for (const sink of output as Set<any>) {
					errorData !== undefined ? sink(END, errorData) : sink(END);
				}
			} else {
				errorData !== undefined
					? (output as (type: number, data?: any) => void)(END, errorData)
					: (output as (type: number, data?: any) => void)(END);
			}
		}
	}

	_disconnectUpstream(): void {
		for (const tb of this._upstreamTalkbacks) tb(END);
		this._upstreamTalkbacks = [];
		this._flags &= ~D_CONNECTED;
		this._dirtyDeps.reset();
	}

	get(): T {
		// Lazy STANDALONE: connect on first get()
		if (!(this._flags & (D_CONNECTED | D_COMPLETED))) {
			this._lazyConnect();
			if (this._flags & D_CONNECTED) {
				this._flags |= D_STANDALONE;
			}
		}
		return this._cachedValue as T;
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

			// Lazy connection on first subscription
			if (!(this._flags & D_CONNECTED)) {
				this._lazyConnect();
				if (this._flags & D_COMPLETED) {
					sink(START, (_t: number) => {});
					sink(END);
					return;
				}
				// D_CONNECTED is set, D_STANDALONE is NOT (we have a subscriber)
			}

			// Output slot transitions: STANDALONE/null → SINGLE, SINGLE → MULTI
			if (this._flags & D_STANDALONE) {
				// STANDALONE → SINGLE: external subscriber takes over
				this._output = sink;
				this._flags &= ~D_STANDALONE;
			} else if (this._output === null) {
				// null → SINGLE (lazy connect path — _output is null after connect)
				this._output = sink;
			} else if (!(this._flags & D_MULTI)) {
				// SINGLE → MULTI
				const set = new Set<any>();
				set.add(this._output);
				set.add(sink);
				this._output = set;
				this._flags |= D_MULTI;
			} else {
				(this._output as Set<any>).add(sink);
			}

			// Send START with talkback — talkback(DATA) returns current cached value
			sink(START, (t: number) => {
				if (t === DATA) sink(DATA, this._cachedValue);
				if (t === END) {
					if (this._output === null) return;
					if (this._flags & D_MULTI) {
						const set = this._output as Set<any>;
						set.delete(sink);
						if (set.size === 1) {
							// MULTI → SINGLE
							this._output = set.values().next().value;
							this._flags &= ~D_MULTI;
						} else if (set.size === 0) {
							// MULTI → STANDALONE
							this._output = null;
							this._flags |= D_STANDALONE;
						}
					} else if (this._output === sink) {
						// SINGLE → STANDALONE
						this._output = null;
						this._flags |= D_STANDALONE;
					}
					// Deps stay connected (STANDALONE mode)
				}
			});

			// No upstream connection needed — already connected (STANDALONE or lazy)
		}
	}
}

export function derived<T>(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>): Store<T> {
	return new DerivedImpl<T>(deps, fn, opts) as any;
}

export namespace derived {
	/** Identity-mode derived: forwards dep value directly, no compute fn on updates. */
	export function from<T>(dep: Store<T>, opts?: StoreOptions<T>): Store<T> {
		return new DerivedImpl<T>([dep as Store<unknown>], () => dep.get() as any, opts, true) as any;
	}
}
