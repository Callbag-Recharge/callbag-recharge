// ---------------------------------------------------------------------------
// Inspector — static class for observability
// ---------------------------------------------------------------------------
// All debug metadata lives here in WeakMaps, not on the store objects.
// Stores stay lean. Inspector is opt-in overhead.
//
// v5: Zero intrusion into primitives. No hooks in hot paths. All methods
// are static — call directly as Inspector.observe(), Inspector.tap(), etc.
// - register/registerEdge: metadata collection (called from constructors)
// - inspect/graph/dumpGraph/snapshot: read-only graph queries
// - observe/spy/trace: callbag sinks for debugging (subscribe externally)
// - tap: transparent passthrough wrapper for graph visualization
// ---------------------------------------------------------------------------

import type { NodeStatus, Signal } from "./protocol";
import { DATA, DIRTY, END, RESOLVED, START, STATE } from "./protocol";
import type { Store } from "./types";

export interface StoreInfo<T = unknown> {
	name: string | undefined;
	kind: string;
	value: T;
	/** v4: node lifecycle status */
	status: NodeStatus | undefined;
}

export interface ObserveResult<T> {
	/** All DATA (type 1) values received, in order */
	values: T[];
	/** All STATE (type 3) payloads received (DIRTY, RESOLVED, or unknown) */
	signals: Signal[];
	/** All events in protocol order: { type, data } */
	events: Array<{ type: "data" | "signal" | "end"; data: unknown }>;
	/** Whether END (type 2) has been received */
	ended: boolean;
	/** Error payload from END, if any */
	endError: unknown;
	/** Count of DIRTY signals received */
	dirtyCount: number;
	/** Count of RESOLVED signals received */
	resolvedCount: number;
	/** Store name (from Inspector, if registered) */
	name: string | undefined;
	/** Disconnect the observer */
	dispose: () => void;
}

export class Inspector {
	// WeakMaps for metadata — keyed by any graph node (stores, effects, etc.)
	private static _names = new WeakMap<object, string>();
	private static _kinds = new WeakMap<object, string>();
	private static _keys = new WeakMap<object, string>();

	// WeakRef set for graph() — allows GC of unused nodes
	private static _stores = new Set<WeakRef<object>>();

	// Dependency edges: parent key → child keys
	private static _edges = new Map<string, string[]>();

	// Unique key generation
	private static _nextId = 0;
	private static _usedKeys = new Set<string>();

	// Enabled flag — when false, register/getName are no-ops
	private static _explicitEnabled: boolean | null = null;
	private static _cachedDefault: boolean | null = null;

	static get enabled(): boolean {
		if (Inspector._explicitEnabled !== null) return Inspector._explicitEnabled;
		if (Inspector._cachedDefault !== null) return Inspector._cachedDefault;
		try {
			Inspector._cachedDefault = (globalThis as any).process?.env?.NODE_ENV !== "production";
		} catch {
			Inspector._cachedDefault = true;
		}
		return Inspector._cachedDefault;
	}

	static set enabled(value: boolean) {
		Inspector._explicitEnabled = value;
	}

	/** Compute a dep-name-based suffix for unique key generation */
	private static _depSuffix(deps?: object[]): string | undefined {
		if (!deps?.length) return undefined;
		const names = deps.map((d) => Inspector._names.get(d) ?? "?");
		const joined = names.join(",");
		return joined.length > 40 ? `${joined.slice(0, 37)}...` : joined;
	}

	/** Resolve a node to its unique graph key */
	private static _resolveKey(node: object): string {
		return Inspector._keys.get(node) ?? Inspector._names.get(node) ?? "anonymous";
	}

	/** Register a graph node (store, effect, etc.) with the inspector */
	static register(node: object, opts?: { name?: string; kind?: string; deps?: object[] }): void {
		if (!Inspector.enabled) return;
		if (opts?.name) Inspector._names.set(node, opts.name);
		if (opts?.kind) Inspector._kinds.set(node, opts.kind);

		// Compute unique key
		const id = Inspector._nextId++;
		let key = opts?.name;
		if (key && !Inspector._usedKeys.has(key)) {
			// Unique name — use as-is
		} else if (key) {
			// Name collision — differentiate with dep names or ID
			const depSuffix = Inspector._depSuffix(opts?.deps);
			key = depSuffix ? `${key}(${depSuffix})` : `${key}_${id}`;
			if (Inspector._usedKeys.has(key)) key = `${key}_${id}`;
		} else {
			// Unnamed — use kind + dep names or ID
			const kind = opts?.kind ?? "store";
			const depSuffix = Inspector._depSuffix(opts?.deps);
			key = depSuffix ? `${kind}(${depSuffix})` : `${kind}_${id}`;
			if (Inspector._usedKeys.has(key)) key = `${key}_${id}`;
		}

		Inspector._usedKeys.add(key);
		Inspector._keys.set(node, key);
		Inspector._stores.add(new WeakRef(node));
	}

	/** Register a dependency edge between parent and child nodes */
	static registerEdge(parent: object, child: object): void {
		if (!Inspector.enabled) return;
		const parentKey = Inspector._resolveKey(parent);
		const childKey = Inspector._resolveKey(child);
		const children = Inspector._edges.get(parentKey);
		if (children) {
			if (!children.includes(childKey)) children.push(childKey);
		} else {
			Inspector._edges.set(parentKey, [childKey]);
		}
	}

	/** Get dependency edges: parent → children */
	static getEdges(): Map<string, string[]> {
		return new Map(Inspector._edges);
	}

	/** Get the name of a node */
	static getName(node: object): string | undefined {
		if (!Inspector.enabled) return undefined;
		return Inspector._names.get(node);
	}

	/** Get the kind of a node */
	static getKind(node: object): string | undefined {
		return Inspector._kinds.get(node);
	}

	/** Inspect a single graph node — includes status and value (if available) */
	static inspect<T = unknown>(node: object): StoreInfo<T> {
		return {
			name: Inspector._names.get(node),
			kind: Inspector._kinds.get(node) ?? "unknown",
			value: (typeof (node as any).get === "function" ? (node as any).get() : undefined) as T,
			status: (node as any)._status,
		};
	}

	/** Get all living nodes as a Map. Also prunes dead edges from GC'd nodes. */
	static graph(): Map<string, StoreInfo> {
		const result = new Map<string, StoreInfo>();
		const livingKeys = new Set<string>();
		for (const ref of Inspector._stores) {
			const node = ref.deref();
			if (!node) {
				Inspector._stores.delete(ref); // cleanup GC'd refs
				continue;
			}
			const key = Inspector._resolveKey(node);
			livingKeys.add(key);
			result.set(key, Inspector.inspect(node));
		}
		// Prune edges referencing GC'd stores
		for (const [key, children] of Inspector._edges) {
			if (!livingKeys.has(key)) {
				Inspector._edges.delete(key);
				Inspector._usedKeys.delete(key);
				continue;
			}
			const alive = children.filter((c) => livingKeys.has(c));
			if (alive.length === 0) {
				Inspector._edges.delete(key);
			} else if (alive.length !== children.length) {
				Inspector._edges.set(key, alive);
			}
		}
		return result;
	}

	/** Trace a specific store's value changes (raw callbag — no extra/ dependency) */
	static trace<T>(store: Store<T>, cb: (value: T, prev: T | undefined) => void): () => void {
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
	}

	/** Pretty-print the entire store graph for console/CLI debugging */
	static dumpGraph(): string {
		const g = Inspector.graph();
		const edges = Inspector.getEdges();

		// Build reverse map: child key → parent keys (deps)
		const depsMap = new Map<string, string[]>();
		for (const [parent, children] of edges) {
			for (const child of children) {
				const deps = depsMap.get(child);
				if (deps) {
					if (!deps.includes(parent)) deps.push(parent);
				} else {
					depsMap.set(child, [parent]);
				}
			}
		}

		const lines: string[] = [];
		for (const [key, info] of g) {
			const deps = depsMap.get(key);
			const children = edges.get(key);
			const depsStr = deps?.length ? `  ← [${deps.join(", ")}]` : "";
			const childStr = children?.length ? `  → [${children.join(", ")}]` : "";
			lines.push(
				`  ${key} (${info.kind}) = ${JSON.stringify(info.value)}  [${info.status ?? "?"}]${depsStr}${childStr}`,
			);
		}
		const header = `Store Graph (${g.size} nodes):`;
		return [header, ...lines].join("\n");
	}

	/**
	 * Internal observe implementation shared by observe() and spy().
	 */
	private static _observe<T>(
		store: Store<T>,
		label?: string,
		log?: (...args: any[]) => void,
	): ObserveResult<T> {
		let talkback: ((type: number) => void) | null = null;
		const name = label ?? Inspector.getName(store);
		const result: ObserveResult<T> = {
			values: [],
			signals: [],
			events: [],
			ended: false,
			endError: undefined,
			dirtyCount: 0,
			resolvedCount: 0,
			name,
			dispose: () => talkback?.(END),
		};

		store.source(START, (type: number, data: any) => {
			if (type === START) {
				talkback = data;
				return;
			}
			if (type === DATA) {
				result.values.push(data);
				result.events.push({ type: "data", data });
				if (log) log(`[${name}] DATA:`, data);
			} else if (type === STATE) {
				result.signals.push(data);
				result.events.push({ type: "signal", data });
				if (data === DIRTY) result.dirtyCount++;
				else if (data === RESOLVED) result.resolvedCount++;
				if (log) log(`[${name}] STATE:`, data);
			} else if (type === END) {
				result.ended = true;
				result.endError = data;
				result.events.push({ type: "end", data });
				if (log) log(`[${name}] END`, data !== undefined ? data : "");
				talkback = null;
			}
		});

		return result;
	}

	/**
	 * Observe a store's full callbag protocol — the test-friendly alternative
	 * to hooks. Captures DATA values, STATE signals, END, and provides
	 * convenience accessors.
	 *
	 * Returns a live observation object — arrays grow as the store emits.
	 *
	 * ```ts
	 * const obs = Inspector.observe(myStore);
	 * myState.set(5);
	 * obs.values       // [5]
	 * obs.signals       // [DIRTY]
	 * obs.ended         // false
	 * obs.dirtyCount    // 1
	 * obs.dispose()     // stop observing
	 * ```
	 */
	static observe<T>(store: Store<T>): ObserveResult<T> {
		return Inspector._observe(store);
	}

	/**
	 * Create a transparent passthrough wrapper for graph visualization.
	 * The wrapper delegates `get()` and `source()` to the original store,
	 * appearing as a distinct node in the Inspector graph. Zero overhead —
	 * subscribers connect directly to the original store's source.
	 */
	static tap<T>(store: Store<T>, name?: string): Store<T> {
		const tapName = name ?? `tap(${Inspector.getName(store) ?? "anon"})`;
		const wrapper: Store<T> = {
			get: () => store.get(),
			source: store.source,
		};
		Inspector.register(wrapper, { name: tapName, kind: "tap" });
		Inspector.registerEdge(store, wrapper);
		return wrapper;
	}

	/**
	 * Enhanced observe() with logging — for interactive debugging.
	 * Returns the same observation object as observe(), but also logs each
	 * event as it happens. Pass a custom logger or defaults to console.log.
	 */
	static spy<T>(
		store: Store<T>,
		opts?: { name?: string; log?: (...args: any[]) => void },
	): ObserveResult<T> {
		const label = opts?.name ?? Inspector.getName(store) ?? "spy";
		const log = opts?.log ?? console.log;
		return Inspector._observe(store, label, log);
	}

	/**
	 * JSON-serializable snapshot of the entire graph — nodes + edges.
	 * Designed for AI consumption during debugging sessions.
	 */
	static snapshot(): {
		nodes: Array<{ name: string; kind: string; value: unknown; status: string | undefined }>;
		edges: Array<{ from: string; to: string }>;
	} {
		const g = Inspector.graph();
		const edgeMap = Inspector.getEdges();
		const nodes: Array<{ name: string; kind: string; value: unknown; status: string | undefined }> =
			[];
		for (const [key, info] of g) {
			nodes.push({ name: key, kind: info.kind, value: info.value, status: info.status });
		}
		const edges: Array<{ from: string; to: string }> = [];
		for (const [parent, children] of edgeMap) {
			for (const child of children) {
				edges.push({ from: parent, to: child });
			}
		}
		return { nodes, edges };
	}

	/** Reset all state (for testing) */
	static _reset(): void {
		Inspector._names = new WeakMap<object, string>();
		Inspector._kinds = new WeakMap<object, string>();
		Inspector._keys = new WeakMap<object, string>();
		Inspector._stores = new Set<WeakRef<object>>();
		Inspector._edges = new Map();
		Inspector._usedKeys = new Set();
		Inspector._nextId = 0;
		Inspector._explicitEnabled = null;
		Inspector._cachedDefault = null;
	}
}
