/**
 * Computed store with dynamic dependency tracking. Like `derived()` but
 * deps are discovered at runtime via a tracking `get` function, and can
 * change between recomputations.
 *
 * Tier 1: participates in diamond resolution via type 3 DIRTY/RESOLVED.
 * When deps change after a recompute, upstream connections are rewired
 * and the bitmask is rebuilt.
 *
 * Same lifecycle as derived: fully lazy, disconnect-on-unsub, pull-compute
 * when disconnected.
 */

import { Bitmask } from "./bitmask";
import { Inspector } from "./inspector";
import type { LifecycleSignal } from "./protocol";
import {
	beginDeferredStart,
	DATA,
	DIRTY,
	decodeStatus,
	END,
	endDeferredStart,
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
import type { Store, StoreOptions } from "./types";

// Flag bits for _flags bitmask (bits 0-6)
const D_HAS_CACHED = 1;
const D_CONNECTED = 2;
const D_ANY_DATA = 4;
const D_COMPLETED = 8;
// bit 4: recomputing in progress — re-entrancy guard
const D_RECOMPUTING = 16;
const D_MULTI = 32;
// bit 6: rewiring in progress — suppress recompute from new dep connections
const D_REWIRING = 64;

// Pre-shifted status constants for hot-path writes
const _S_DISCONNECTED = S_DISCONNECTED << STATUS_SHIFT;
const _S_DIRTY = S_DIRTY << STATUS_SHIFT;
const _S_SETTLED = S_SETTLED << STATUS_SHIFT;
const _S_RESOLVED = S_RESOLVED << STATUS_SHIFT;
const _S_COMPLETED = S_COMPLETED << STATUS_SHIFT;
const _S_ERRORED = S_ERRORED << STATUS_SHIFT;
const _STATUS_MASK = STATUS_MASK;

export type TrackingFn<T> = (get: <U>(store: Store<U>) => U) => T;

export class DynamicDerivedImpl<T> {
	_output: ((type: number, data?: any) => void) | Set<any> | null = null;
	_upstreamTalkbacks: Array<(type: number, data?: any) => void> = [];
	_cachedValue: T | undefined;
	_flags: number = 0;
	_dirtyDeps!: Bitmask;
	_eqFn: ((a: T, b: T) => boolean) | undefined;
	_deps: Store<unknown>[] = [];
	_trackingFn: TrackingFn<T>;

	// Tracking state: populated during _recompute / pull-compute
	_trackedDeps: Store<unknown>[] = [];
	_trackingSet: Set<Store<unknown>> | null = null;

	get _status() {
		return decodeStatus(this._flags);
	}

	constructor(fn: TrackingFn<T>, opts?: StoreOptions<T>) {
		this._trackingFn = fn;
		this._eqFn = opts?.equals;
		this._dirtyDeps = new Bitmask(0);

		this.source = this.source.bind(this);

		Inspector.register(this as any, { kind: "dynamicDerived", ...opts });
	}

	/** Tracking get — records deps during computation (O(1) dedup via Set) */
	_trackGet<U>(store: Store<U>): U {
		if (!this._trackingSet!.has(store as Store<unknown>)) {
			this._trackingSet!.add(store as Store<unknown>);
			this._trackedDeps.push(store as Store<unknown>);
		}
		return store.get();
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
		// Re-entrancy guard: if a rewire triggers a signal cycle that
		// re-enters _recompute, the inner call is suppressed — the outer
		// call's result may be stale but will be superseded by the signal
		// that caused re-entry (which marks us dirty again for a fresh cycle).
		if (this._flags & D_RECOMPUTING) return;
		this._flags |= D_RECOMPUTING;

		// Track deps during computation
		this._trackedDeps = [];
		this._trackingSet = new Set();
		let result: T;
		try {
			result = this._trackingFn((s) => this._trackGet(s));
		} catch (err) {
			this._trackingSet = null;
			this._flags &= ~D_RECOMPUTING;
			this._handleEnd(err);
			return;
		}
		this._trackingSet = null;

		// Check if deps changed — if so, rewire
		if (this._flags & D_CONNECTED) {
			this._maybeRewire();
		}

		this._flags &= ~D_RECOMPUTING;

		if (this._eqFn && this._flags & D_HAS_CACHED && this._eqFn(this._cachedValue as T, result)) {
			this._flags = (this._flags & ~_STATUS_MASK) | _S_RESOLVED;
			this._dispatch(STATE, RESOLVED);
			return;
		}
		this._cachedValue = result;
		this._flags = ((this._flags | D_HAS_CACHED) & ~_STATUS_MASK) | _S_SETTLED;
		this._dispatch(DATA, this._cachedValue);
	}

	/** Compare tracked deps to current deps. Rewire if different. */
	_maybeRewire(): void {
		const newDeps = this._trackedDeps;
		const oldDeps = this._deps;

		// Fast path: same deps in same order (plain loop avoids closure allocation)
		if (newDeps.length === oldDeps.length) {
			let same = true;
			for (let i = 0; i < newDeps.length; i++) {
				if (newDeps[i] !== oldDeps[i]) {
					same = false;
					break;
				}
			}
			if (same) return;
		}

		// Rewire needed
		this._flags |= D_REWIRING;

		const oldSet = new Set(oldDeps);
		const newSet = new Set(newDeps);

		// Disconnect from removed deps
		for (let i = 0; i < oldDeps.length; i++) {
			if (!newSet.has(oldDeps[i])) {
				const tb = this._upstreamTalkbacks[i];
				if (tb) tb(END);
			}
		}

		// Build new talkback array: reuse existing for kept deps, null for new
		const newTalkbacks: Array<(type: number, data?: any) => void> = [];
		for (let i = 0; i < newDeps.length; i++) {
			const oldIndex = oldDeps.indexOf(newDeps[i]);
			if (oldIndex !== -1) {
				newTalkbacks.push(this._upstreamTalkbacks[oldIndex]);
			} else {
				// Placeholder — will be filled by _connectOneDep
				newTalkbacks.push(null as any);
			}
		}

		// Update state before connecting new deps
		this._deps = newDeps;
		this._upstreamTalkbacks = newTalkbacks;
		this._dirtyDeps = new Bitmask(newDeps.length);

		// Update Inspector edges
		for (const dep of newDeps) {
			if (!oldSet.has(dep)) {
				Inspector.registerEdge(dep, this as any);
			}
		}

		// Connect to new deps
		for (let i = 0; i < newDeps.length; i++) {
			if (!oldSet.has(newDeps[i])) {
				this._connectOneDep(i);
			}
		}

		this._flags &= ~D_REWIRING;
	}

	/** Connect to a single dep at the given index */
	_connectOneDep(depIndex: number): void {
		this._deps[depIndex].source(START, (type: number, data: any) => {
			if (type === START) {
				this._upstreamTalkbacks[depIndex] = data;
				return;
			}
			if (this._flags & D_COMPLETED) return;
			// Suppress signals during rewiring — we're mid-recompute
			if (this._flags & D_REWIRING) return;

			this._handleDepSignal(depIndex, type, data);
		});
	}

	/** Handle a signal from a dep (shared between initial connect and reconnect) */
	_handleDepSignal(depIndex: number, type: number, data: any): void {
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
	}

	_lazyConnect(): void {
		if (this._flags & (D_CONNECTED | D_COMPLETED)) return;

		// Compute and track deps
		this._trackedDeps = [];
		this._trackingSet = new Set();
		try {
			this._cachedValue = this._trackingFn((s) => this._trackGet(s));
		} catch (err) {
			this._trackingSet = null;
			this._trackedDeps = [];
			this._handleEnd(err);
			return;
		}
		this._trackingSet = null;
		this._flags = ((this._flags | D_HAS_CACHED) & ~_STATUS_MASK) | _S_SETTLED;

		// Set deps from tracking
		this._deps = this._trackedDeps;
		this._dirtyDeps = new Bitmask(this._deps.length);

		// Register Inspector edges
		for (const dep of this._deps) Inspector.registerEdge(dep, this as any);

		beginDeferredStart();
		this._connectUpstream();
		if (!(this._flags & D_COMPLETED)) {
			this._flags |= D_CONNECTED;
		}
		endDeferredStart();
	}

	/** Single-dep: no bitmask, direct forward (SINGLE_DEP optimization) */
	_connectSingleDep(): void {
		let dirty = false;
		this._deps[0].source(START, (type: number, data: any) => {
			if (type === START) {
				this._upstreamTalkbacks.push(data);
				data(STATE, SINGLE_DEP);
				return;
			}
			if (this._flags & D_COMPLETED) return;

			if (type === STATE) {
				if (data === DIRTY) {
					if (dirty) return;
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
					// DATA without DIRTY — synthesize DIRTY for downstream
					this._flags = (this._flags & ~_STATUS_MASK) | _S_DIRTY;
					this._dispatch(STATE, DIRTY);
					this._recompute();
				}
			} else if (type === END) {
				this._handleEnd(data);
			}
		});
	}

	_connectUpstream(): void {
		this._upstreamTalkbacks.length = 0;
		if (this._deps.length === 1) {
			this._connectSingleDep();
		} else {
			for (let i = 0; i < this._deps.length; i++) {
				if (this._flags & D_COMPLETED) break;
				this._connectOneDep(i);
			}
		}
	}

	_handleEnd(errorData: any): void {
		this._flags |= D_COMPLETED;
		this._flags =
			(this._flags & ~_STATUS_MASK) | (errorData !== undefined ? _S_ERRORED : _S_COMPLETED);
		// Store error in _cachedValue so late subscribers receive it via source()
		if (errorData !== undefined) this._cachedValue = errorData as any;
		for (const tb of this._upstreamTalkbacks) {
			if (tb) tb(END);
		}
		this._upstreamTalkbacks = [];
		this._deps = [];
		this._trackedDeps = [];
		this._flags &= ~D_CONNECTED;
		this._dirtyDeps.reset();
		const output = this._output;
		const wasMulti = this._flags & D_MULTI;
		this._output = null;
		this._flags &= ~D_MULTI;
		if (output) {
			if (wasMulti) {
				for (const sink of output as Set<any>) {
					try {
						errorData !== undefined ? sink(END, errorData) : sink(END);
					} catch (_) {
						/* ensure all sinks receive END */
					}
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
		this._upstreamTalkbacks.length = 0;
		this._deps = [];
		this._trackedDeps = [];
		this._flags &= ~(D_CONNECTED | D_ANY_DATA);
		this._flags = (this._flags & ~_STATUS_MASK) | _S_DISCONNECTED;
		this._dirtyDeps.reset();
	}

	_handleLifecycleSignal(s: LifecycleSignal): void {
		if (this._flags & D_COMPLETED) return;

		if (s === TEARDOWN) {
			for (const tb of this._upstreamTalkbacks) {
				if (tb) tb(STATE, TEARDOWN);
			}
			this._handleEnd(undefined);
			return;
		}

		if (s === RESET) {
			this._flags &= ~(D_HAS_CACHED | D_ANY_DATA);
			this._dirtyDeps.reset();
		}

		for (const tb of this._upstreamTalkbacks) {
			if (tb) tb(STATE, s);
		}
	}

	get(): T {
		if (this._flags & D_CONNECTED) {
			return this._cachedValue as T;
		}
		if (this._flags & D_COMPLETED) {
			if ((this._flags & _STATUS_MASK) === _S_ERRORED) throw this._cachedValue;
			return this._cachedValue as T;
		}
		// Disconnected: pull-compute from deps (re-throw on error)
		this._trackedDeps = [];
		this._trackingSet = new Set();
		let result: T;
		try {
			result = this._trackingFn((s) => this._trackGet(s));
		} catch (err) {
			this._trackingSet = null;
			this._trackedDeps = [];
			throw err;
		}
		this._trackingSet = null;
		this._cachedValue = result;
		this._flags |= D_HAS_CACHED;
		return result;
	}

	source(type: number, payload?: any): void {
		if (type === START) {
			const sink = payload;
			if (this._flags & D_COMPLETED) {
				const isErr = (this._flags & _STATUS_MASK) === _S_ERRORED;
				sink(START, (_t: number) => {});
				isErr ? sink(END, this._cachedValue) : sink(END);
				return;
			}

			if (!(this._flags & D_CONNECTED)) {
				this._lazyConnect();
				if (this._flags & D_COMPLETED) {
					const isErr = (this._flags & _STATUS_MASK) === _S_ERRORED;
					sink(START, (_t: number) => {});
					isErr ? sink(END, this._cachedValue) : sink(END);
					return;
				}
			}

			if (this._output === null) {
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

			sink(START, (t: number, d?: any) => {
				if (t === DATA) sink(DATA, this._cachedValue);
				if (t === STATE && isLifecycleSignal(d)) {
					this._handleLifecycleSignal(d);
					return;
				}
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
							this._flags &= ~D_MULTI;
							this._disconnectUpstream();
						}
					} else if (this._output === sink) {
						this._output = null;
						this._disconnectUpstream();
					}
				}
			});
		}
	}
}

/**
 * Creates a computed store with dynamic dependency tracking and diamond resolution.
 *
 * Unlike `derived()` which takes a fixed deps array, `dynamicDerived()` discovers
 * deps at runtime via a tracking `get` function. Deps are re-tracked on each
 * recomputation and upstream connections are rewired when deps change.
 *
 * Tier 1: participates in diamond resolution via type 3 DIRTY/RESOLVED signals.
 *
 * @param fn - Computation function receiving a tracking `get`. Call `get(store)`
 *             to read a store's value and register it as a dependency.
 * @param opts - Optional `name` and `equals` for push-phase memoization.
 *
 * @returns `Store<T>` — read-only store: `get()`, `source()`.
 *
 * @example
 * ```ts
 * import { state, dynamicDerived } from 'callbag-recharge';
 *
 * const flag = state(true);
 * const a = state(1);
 * const b = state(2);
 *
 * const result = dynamicDerived((get) => get(flag) ? get(a) : get(b));
 * result.get(); // 1
 *
 * flag.set(false);
 * result.get(); // 2 — now tracks b instead of a
 * ```
 *
 * @seeAlso [derived](./derived) — fixed deps, [state](./state)
 */
export function dynamicDerived<T>(fn: TrackingFn<T>, opts?: StoreOptions<T>): Store<T> {
	return new DynamicDerivedImpl<T>(fn, opts) as any;
}
