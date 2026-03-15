// ---------------------------------------------------------------------------
// Inspector — global singleton for observability
// ---------------------------------------------------------------------------
// All debug metadata lives here in WeakMaps, not on the store objects.
// Stores stay lean. Inspector is opt-in overhead.
// ---------------------------------------------------------------------------

import { END, START } from "./protocol";
import type { Store } from "./types";

export interface StoreInfo<T = unknown> {
	name: string | undefined;
	kind: string;
	value: T;
}

export const Inspector = {
	// WeakMaps for metadata — keyed by store object
	_names: new WeakMap<Store<unknown>, string>(),
	_kinds: new WeakMap<Store<unknown>, string>(),

	// WeakRef set for graph() — allows GC of unused stores
	_stores: new Set<WeakRef<Store<unknown>>>(),

	// Enabled flag — when false, register/getName are no-ops
	_explicitEnabled: null as boolean | null,

	_cachedDefault: null as boolean | null,

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

	/** Get the name of a store */
	getName(store: Store<unknown>): string | undefined {
		if (!this.enabled) return undefined;
		return this._names.get(store);
	},

	/** Get the kind of a store */
	getKind(store: Store<unknown>): string | undefined {
		return this._kinds.get(store);
	},

	/** Inspect a single store */
	inspect<T>(store: Store<T>): StoreInfo<T> {
		return {
			name: this._names.get(store as Store<unknown>),
			kind: this._kinds.get(store as Store<unknown>) ?? "unknown",
			value: store.get(),
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
		this._explicitEnabled = null;
		this._cachedDefault = null;
	},
};
