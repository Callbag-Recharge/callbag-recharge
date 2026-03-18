/**
 * Computed store with dirty tracking and caching. Recomputes fn() when
 * all dirty deps have resolved, emitting the new value on type 1 DATA.
 *
 * v5: _status packed into _flags bits 7-9 for hot-path performance.
 * String status exposed via getter for Inspector/test backward compat.
 *
 * Class-based for V8 hidden class optimization and prototype method sharing.
 * Boolean fields packed into _flags bitmask to reduce hidden class size.
 */

import { Bitmask } from "./bitmask";
import { Inspector } from "./inspector";
import {
	beginDeferredStart,
	DATA,
	DIRTY,
	decodeStatus,
	END,
	endDeferredStart,
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
import type { Store, StoreOptions } from "./types";

// Flag bits for _flags bitmask (bits 0-6)
const D_HAS_CACHED = 1;
const D_CONNECTED = 2;
const D_ANY_DATA = 4;
const D_COMPLETED = 8;
const D_STANDALONE = 16;
const D_MULTI = 32;
const D_IDENTITY = 64;

// Pre-shifted status constants for hot-path writes
const _S_DISCONNECTED = S_DISCONNECTED << STATUS_SHIFT;
const _S_DIRTY = S_DIRTY << STATUS_SHIFT;
const _S_SETTLED = S_SETTLED << STATUS_SHIFT;
const _S_RESOLVED = S_RESOLVED << STATUS_SHIFT;
const _S_COMPLETED = S_COMPLETED << STATUS_SHIFT;
const _S_ERRORED = S_ERRORED << STATUS_SHIFT;
const _STATUS_MASK = STATUS_MASK;

export class DerivedImpl<T> {
	_output: ((type: number, data?: any) => void) | Set<any> | null = null;
	_upstreamTalkbacks: Array<(type: number) => void> = [];
	_cachedValue: T | undefined;
	_flags: number;
	_dirtyDeps!: Bitmask;
	_eqFn: ((a: T, b: T) => boolean) | undefined;
	_deps: Store<unknown>[];
	_fn: () => T;

	get _status() {
		return decodeStatus(this._flags);
	}

	constructor(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>, identity?: boolean) {
		this._deps = deps;
		this._fn = fn;
		this._eqFn = opts?.equals;
		this._flags = identity ? D_IDENTITY : 0;
		// S_DISCONNECTED = 0, so no need to set status bits
		this._dirtyDeps = new Bitmask(deps.length);

		this.source = this.source.bind(this);

		Inspector.register(this as any, { kind: "derived", ...opts, deps });
		for (const dep of deps) Inspector.registerEdge(dep, this as any);

		// v4.1: Fully lazy — no computation or connection at construction.
	}

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
			this._flags = (this._flags & ~_STATUS_MASK) | _S_RESOLVED;
			this._dispatch(STATE, RESOLVED);
			return;
		}
		this._cachedValue = result;
		this._flags = ((this._flags | D_HAS_CACHED) & ~_STATUS_MASK) | _S_SETTLED;
		this._dispatch(DATA, this._cachedValue);
	}

	_recomputeIdentity(data: T): void {
		if (this._eqFn && this._flags & D_HAS_CACHED && this._eqFn(this._cachedValue as T, data)) {
			this._flags = (this._flags & ~_STATUS_MASK) | _S_RESOLVED;
			this._dispatch(STATE, RESOLVED);
			return;
		}
		this._cachedValue = data;
		this._flags = ((this._flags | D_HAS_CACHED) & ~_STATUS_MASK) | _S_SETTLED;
		this._dispatch(DATA, data);
	}

	_lazyConnect(): void {
		if (this._flags & (D_CONNECTED | D_COMPLETED)) return;
		this._cachedValue = this._fn();
		this._flags = ((this._flags | D_HAS_CACHED) & ~_STATUS_MASK) | _S_SETTLED;
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
					this._flags = (this._flags & ~_STATUS_MASK) | _S_DIRTY;
					this._dispatch(STATE, DIRTY);
				} else if (data === RESOLVED) {
					if (dirty) {
						dirty = false;
						this._flags = (this._flags & ~_STATUS_MASK) | _S_RESOLVED;
						this._dispatch(STATE, RESOLVED);
					}
				} else {
					this._dispatch(STATE, data);
				}
			} else if (type === DATA) {
				if (dirty) {
					dirty = false;
					this._recompute();
				} else {
					this._flags = (this._flags & ~_STATUS_MASK) | _S_DIRTY;
					this._dispatch(STATE, DIRTY);
					this._recompute();
				}
			} else if (type === END) {
				this._handleEnd(data);
			}
		});
	}

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
					this._flags = (this._flags & ~_STATUS_MASK) | _S_DIRTY;
					this._dispatch(STATE, DIRTY);
				} else if (data === RESOLVED) {
					if (dirty) {
						dirty = false;
						this._flags = (this._flags & ~_STATUS_MASK) | _S_RESOLVED;
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
					this._flags = (this._flags & ~_STATUS_MASK) | _S_DIRTY;
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
							this._flags = (this._flags & ~_STATUS_MASK) | _S_DIRTY;
							this._dispatch(STATE, DIRTY);
						}
					} else if (data === RESOLVED) {
						if (this._dirtyDeps.test(depIndex)) {
							this._dirtyDeps.clear(depIndex);
							if (this._dirtyDeps.empty()) {
								if (this._flags & D_ANY_DATA) {
									this._recompute();
								} else {
									this._flags = (this._flags & ~_STATUS_MASK) | _S_RESOLVED;
									this._dispatch(STATE, RESOLVED);
								}
							}
						}
					} else {
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
						if (this._dirtyDeps.empty()) {
							this._flags = (this._flags & ~_STATUS_MASK) | _S_DIRTY;
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

	_handleEnd(errorData: any): void {
		this._flags |= D_COMPLETED;
		this._flags =
			(this._flags & ~_STATUS_MASK) | (errorData !== undefined ? _S_ERRORED : _S_COMPLETED);
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
			if (this._flags & D_COMPLETED) {
				sink(START, (_t: number) => {});
				sink(END);
				return;
			}

			if (!(this._flags & D_CONNECTED)) {
				this._lazyConnect();
				if (this._flags & D_COMPLETED) {
					sink(START, (_t: number) => {});
					sink(END);
					return;
				}
			}

			if (this._flags & D_STANDALONE) {
				this._output = sink;
				this._flags &= ~D_STANDALONE;
			} else if (this._output === null) {
				this._output = sink;
			} else if (!(this._flags & D_MULTI)) {
				const set = new Set<any>();
				set.add(this._output);
				set.add(sink);
				this._output = set;
				this._flags |= D_MULTI;
			} else {
				(this._output as Set<any>).add(sink);
			}

			sink(START, (t: number) => {
				if (t === DATA) sink(DATA, this._cachedValue);
				if (t === END) {
					if (this._output === null) return;
					if (this._flags & D_MULTI) {
						const set = this._output as Set<any>;
						set.delete(sink);
						if (set.size === 1) {
							this._output = set.values().next().value;
							this._flags &= ~D_MULTI;
						} else if (set.size === 0) {
							this._output = null;
							this._flags |= D_STANDALONE;
						}
					} else if (this._output === sink) {
						this._output = null;
						this._flags |= D_STANDALONE;
					}
				}
			});
		}
	}
}

export function derived<T>(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>): Store<T> {
	return new DerivedImpl<T>(deps, fn, opts) as any;
}

export namespace derived {
	export function from<T>(dep: Store<T>, opts?: StoreOptions<T>): Store<T> {
		return new DerivedImpl<T>([dep as Store<unknown>], () => dep.get() as any, opts, true) as any;
	}
}
