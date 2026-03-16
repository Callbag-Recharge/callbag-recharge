// ---------------------------------------------------------------------------
// Inspector — global singleton for observability
// ---------------------------------------------------------------------------
// All debug metadata lives here in WeakMaps, not on the store objects.
// Stores stay lean. Inspector is opt-in overhead.
//
// v4: inspect() returns status field. Signal hooks (onEmit, onSignal,
// onStatus, onEnd) fire from taps when non-null (zero-cost when null).
// registerEdge() tracks dependency graph.
// ---------------------------------------------------------------------------

import { END, START } from "./protocol";
import type { NodeStatus } from "./protocol";
import type { Store } from "./types";

export interface StoreInfo<T = unknown> {
	name: string | undefined;
	kind: string;
	value: T;
	/** v4: node lifecycle status */
	status: NodeStatus | undefined;
}

export const Inspector = {
	// WeakMaps for metadata — keyed by store object
	_names: new WeakMap<Store<unknown>, string>(),
	_kinds: new WeakMap<Store<unknown>, string>(),

	// WeakRef set for graph() — allows GC of unused stores
	_stores: new Set<WeakRef<Store<unknown>>>(),

	// Dependency edges: parent → children
	_edges: new Map<string, string[]>(),

	// Enabled flag — when false, register/getName are no-ops
	_explicitEnabled: null as boolean | null,

	_cachedDefault: null as boolean | null,

	// v4: Signal hooks — null default, zero-cost when not set
	onEmit: null as ((store: Store<unknown>, value: unknown) => void) | null,
	onSignal: null as ((store: Store<unknown>, signal: unknown) => void) | null,
	onStatus: null as ((store: Store<unknown>, status: NodeStatus) => void) | null,
	onEnd: null as ((store: Store<unknown>, error?: unknown) => void) | null,

	get enabled(): boolean {
		if (this._explicitEnabled !== null) return this._explicitEnabled;
		if (this._cachedDefault !== null) return this._cachedDefault;
		try {
			this._cachedDefault = (globalThis as any).process?.env?.NODE_ENV !== "production";
		} catch {
			this._cachedDefault = true;
		}
		return this._cachedDefault;
	},

	set enabled(value: boolean) {
		this._explicitEnabled = value;
	},

	/** Register a store with the inspector */
	register(store: Store<unknown>, opts?: { name?: string; kind?: string }): void {
		if (!this.enabled) return;
		if (opts?.name) this._names.set(store, opts.name);
		if (opts?.kind) this._kinds.set(store, opts.kind);
		this._stores.add(new WeakRef(store));
	},

	/** Register a dependency edge between parent and child stores */
	registerEdge(parent: Store<unknown>, child: Store<unknown>): void {
		if (!this.enabled) return;
		const parentName = this._names.get(parent) ?? "anonymous";
		const childName = this._names.get(child) ?? "anonymous";
		const children = this._edges.get(parentName);
		if (children) {
			if (!children.includes(childName)) children.push(childName);
		} else {
			this._edges.set(parentName, [childName]);
		}
	},

	/** Get dependency edges: parent → children */
	getEdges(): Map<string, string[]> {
		return new Map(this._edges);
	},

	/** Get the name of a store */
	getName(store: Store<unknown>): string | undefined {
		if (!this.enabled) return undefined;
		return this._names.get(store);
	},

	/** Get the kind of a store */
	getKind(store: Store<unknown>): string | undefined {
		return this._kinds.get(store);
	},

	/** Inspect a single store — v4: includes status */
	inspect<T>(store: Store<T>): StoreInfo<T> {
		return {
			name: this._names.get(store as Store<unknown>),
			kind: this._kinds.get(store as Store<unknown>) ?? "unknown",
			value: store.get(),
			status: (store as any)._status,
		};
	},

	/** Get all living stores as a Map */
	graph(): Map<string, StoreInfo> {
		const result = new Map<string, StoreInfo>();
		let i = 0;
		for (const ref of this._stores) {
			const store = ref.deref();
			if (!store) {
				this._stores.delete(ref); // cleanup GC'd refs
				continue;
			}
			const key = this._names.get(store) ?? `store_${i++}`;
			result.set(key, this.inspect(store));
		}
		return result;
	},

	/** Trace a specific store's value changes (raw callbag — no extra/ dependency) */
	trace<T>(store: Store<T>, cb: (value: T, prev: T | undefined) => void): () => void {
		let talkback: ((type: number) => void) | null = null;
		let prev: T | undefined = store.get();
		store.source(START, (type: number, data: any) => {
			if (type === START) talkback = data;
			if (type === END) {
				talkback = null;
				return;
			}
			if (type === 1) {
				const next = data as T;
				if (!Object.is(next, prev)) {
					const p = prev;
					prev = next;
					cb(next, p);
				}
			}
		});
		return () => talkback?.(END);
	},

	/** Reset all state (for testing) */
	_reset(): void {
		this._names = new WeakMap();
		this._kinds = new WeakMap();
		this._stores = new Set();
		this._edges = new Map();
		this._explicitEnabled = null;
		this._cachedDefault = null;
		this.onEmit = null;
		this.onSignal = null;
		this.onStatus = null;
		this.onEnd = null;
	},
};
