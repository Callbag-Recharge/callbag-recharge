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
// - annotate/traceLog/clearTrace: reasoning trace for AI agent observability
// ---------------------------------------------------------------------------

import type { NodeStatus, Signal } from "./protocol";
import { DATA, DIRTY, END, isBatching, RESOLVED, START, STATE } from "./protocol";
import type { Store } from "./types";

export interface StoreInfo<T = unknown> {
	name: string | undefined;
	kind: string;
	value: T;
	/** v4: node lifecycle status */
	status: NodeStatus | undefined;
}

export interface TraceEntry {
	/** Node key (from Inspector registration). */
	node: string;
	/** Reasoning annotation — *why* a decision was made. */
	reason: string;
	/** Timestamp (ms since epoch). */
	timestamp: number;
}

export interface ObserveResult<T> {
	/** All DATA (type 1) values received, in order */
	values: T[];
	/** All STATE (type 3) payloads received (DIRTY, RESOLVED, or unknown) */
	signals: Signal[];
	/** All events in protocol order: { type, data, inBatch } */
	events: Array<{ type: "data" | "signal" | "end"; data: unknown; inBatch: boolean }>;
	/** Whether END (type 2) has been received */
	ended: boolean;
	/** Error payload from END, if any */
	endError: unknown;
	/** True when ended without error (clean completion) */
	readonly completedCleanly: boolean;
	/** True when ended with an error */
	readonly errored: boolean;
	/** Count of DIRTY signals received */
	dirtyCount: number;
	/** Count of RESOLVED signals received */
	resolvedCount: number;
	/** Store name (from Inspector, if registered) */
	name: string | undefined;
	/**
	 * Compact event log: `["DIRTY", value, "RESOLVED", ...]`
	 *
	 * Signals become their string name, DATA becomes the value, END becomes `"END"` or `["END", error]`.
	 * Note: when `T` is `string`, DATA values may collide with signal labels. Use `events` for unambiguous checks.
	 */
	readonly eventLog: Array<T | string | [string, unknown]>;
	/** Disconnect the observer */
	dispose: () => void;
	/** Disconnect and return a fresh observation on the same store */
	reconnect: () => ObserveResult<T>;
}

export interface TimelineEntry<T = unknown> {
	/** Timestamp (ms since epoch). */
	timestamp: number;
	/** Protocol event type. */
	type: "data" | "signal" | "end";
	/** Payload (value for data, signal for signal, error for end). */
	data: T | Signal | unknown;
	/** Whether this event occurred during batch(). */
	inBatch: boolean;
}

export interface TimelineResult<T> {
	/** All timeline entries, in chronological order. */
	entries: TimelineEntry<T>[];
	/** Disconnect the timeline observer. */
	dispose: () => void;
}

export interface DerivedObserveEntry<T> {
	/** The computed result. */
	result: T;
	/** Snapshot of all dep values at the time of computation. */
	depValues: unknown[];
	/** Timestamp (ms since epoch). */
	timestamp: number;
}

export interface DerivedObserveResult<T> extends ObserveResult<T> {
	/** Per-evaluation snapshots: result + dep values. */
	evaluations: DerivedObserveEntry<T>[];
}

export interface TaskStateTransition {
	/** Previous status. */
	from: string;
	/** New status. */
	to: string;
	/** Error value (if transitioning to "error"). */
	error?: unknown;
	/** Timestamp (ms since epoch). */
	timestamp: number;
}

export interface TaskStateObserveResult {
	/** All status transitions, in order. */
	transitions: TaskStateTransition[];
	/** Current status value. */
	readonly currentStatus: string;
	/** Disconnect the observer. */
	dispose: () => void;
}

export interface CausalityEntry<T = unknown> {
	/** The computed result. */
	result: T;
	/** Index of the dep that triggered this evaluation (-1 if unknown/initial). */
	triggerDepIndex: number;
	/** Name of the triggering dep (if registered with Inspector). */
	triggerDepName: string | undefined;
	/** Snapshot of all dep values at evaluation time. */
	depValues: unknown[];
	/** Timestamp (ms since epoch). */
	timestamp: number;
}

export interface CausalityResult<T> extends ObserveResult<T> {
	/** Per-evaluation causality records. */
	causality: CausalityEntry<T>[];
}

// Static-only class is intentional API for Inspector namespace
/**
 * Opt-in graph observability (`inspect`, `graph`, `trace`, `observe`, …). Metadata in WeakMaps.
 *
 * @example
 * ```ts
 * const n = state(0, { name: "n" });
 * Inspector.inspect(n).value; // 0
 * Inspector.inspect(n).kind; // "state"
 * ```
 */
// biome-ignore lint/complexity/noStaticOnlyClass: public API surface
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

	// Reasoning trace — annotations keyed by node, plus chronological log
	private static _annotations = new WeakMap<object, string>();
	private static _traceLog: TraceEntry[] = [];
	private static _traceHead = 0;
	private static _traceFull = false;
	static maxTraceEntries = 1000;

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

	/** Resolve a node to its unique graph key. Unregistered nodes get a stable unique key. */
	private static _resolveKey(node: object): string {
		const existing = Inspector._keys.get(node) ?? Inspector._names.get(node);
		if (existing) return existing;
		// Assign a stable unique key so multiple calls for the same unregistered node are consistent
		const key = `anonymous_${Inspector._nextId++}`;
		Inspector._keys.set(node, key);
		return key;
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

	/** Map a STATE signal to its string name for eventLog */
	private static _signalLabel(sig: Signal): string {
		if (sig === DIRTY) return "DIRTY";
		if (sig === RESOLVED) return "RESOLVED";
		return typeof sig === "symbol" ? (sig.description ?? String(sig)) : String(sig);
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
		let _hasError = false;
		const name = label ?? Inspector.getName(store);
		const _eventLog: Array<T | string | [string, unknown]> = [];
		const result: ObserveResult<T> = {
			values: [],
			signals: [],
			events: [],
			ended: false,
			endError: undefined,
			get completedCleanly() {
				return result.ended && !_hasError;
			},
			get errored() {
				return result.ended && _hasError;
			},
			dirtyCount: 0,
			resolvedCount: 0,
			name,
			get eventLog() {
				return _eventLog;
			},
			dispose: () => talkback?.(END),
			reconnect: () => {
				talkback?.(END);
				return Inspector._observe(store, label, log);
			},
		};

		store.source(START, (type: number, data: any) => {
			if (type === START) {
				talkback = data;
				return;
			}
			const batched = isBatching();
			if (type === DATA) {
				result.values.push(data);
				result.events.push({ type: "data", data, inBatch: batched });
				_eventLog.push(data as T);
				if (log) log(`[${name}] DATA:`, data);
			} else if (type === STATE) {
				result.signals.push(data);
				result.events.push({ type: "signal", data, inBatch: batched });
				_eventLog.push(Inspector._signalLabel(data));
				if (data === DIRTY) result.dirtyCount++;
				else if (data === RESOLVED) result.resolvedCount++;
				if (log) log(`[${name}] STATE:`, data);
			} else if (type === END) {
				result.ended = true;
				result.endError = data;
				_hasError = data !== undefined;
				result.events.push({ type: "end", data, inBatch: batched });
				_eventLog.push(_hasError ? ["END", data] : "END");
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
	 * Subscribe to a store just to activate it. Returns a dispose function.
	 * Use when the test doesn't need to inspect values — just trigger
	 * the subscription lifecycle.
	 *
	 * ```ts
	 * const dispose = Inspector.activate(myStore);
	 * // ... store is now connected
	 * dispose();
	 * ```
	 */
	static activate<T>(store: Store<T>): () => void {
		let talkback: ((type: number) => void) | null = null;
		store.source(START, (type: number, data: any) => {
			if (type === START) talkback = data;
			if (type === END) talkback = null;
		});
		return () => talkback?.(END);
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
	 * JSON-serializable snapshot of the entire graph — nodes + edges + trace.
	 * Designed for AI consumption during debugging sessions.
	 */
	static snapshot(): {
		nodes: Array<{
			name: string;
			kind: string;
			value: unknown;
			status: string | undefined;
			annotation?: string;
		}>;
		edges: Array<{ from: string; to: string }>;
		trace: TraceEntry[];
	} {
		const g = Inspector.graph();
		const edgeMap = Inspector.getEdges();

		// Build key→annotation lookup from living nodes
		const keyAnnotations = new Map<string, string>();
		for (const ref of Inspector._stores) {
			const node = ref.deref();
			if (!node) continue;
			const ann = Inspector._annotations.get(node);
			if (ann !== undefined) {
				keyAnnotations.set(Inspector._resolveKey(node), ann);
			}
		}

		const nodes: Array<{
			name: string;
			kind: string;
			value: unknown;
			status: string | undefined;
			annotation?: string;
		}> = [];
		for (const [key, info] of g) {
			const entry: (typeof nodes)[0] = {
				name: key,
				kind: info.kind,
				value: info.value,
				status: info.status,
			};
			const ann = keyAnnotations.get(key);
			if (ann !== undefined) entry.annotation = ann;
			nodes.push(entry);
		}
		const edges: Array<{ from: string; to: string }> = [];
		for (const [parent, children] of edgeMap) {
			for (const child of children) {
				edges.push({ from: parent, to: child });
			}
		}
		return { nodes, edges, trace: Inspector.traceLog() };
	}

	/**
	 * Export the graph as a Mermaid flowchart string.
	 *
	 * ```ts
	 * console.log(Inspector.toMermaid());
	 * // graph TD
	 * //   count["count (state) = 0"]
	 * //   doubled["doubled (derived) = 0"]
	 * //   count --> doubled
	 * ```
	 */
	static toMermaid(opts?: { direction?: "TD" | "LR" | "BT" | "RL" }): string {
		const direction = opts?.direction ?? "TD";
		const snap = Inspector.snapshot();
		const lines: string[] = [`graph ${direction}`];

		const statusStyle: Record<string, string> = {
			SETTLED: ":::settled",
			DIRTY: ":::dirty",
			ERRORED: ":::errored",
			COMPLETED: ":::completed",
		};

		// Sanitize for Mermaid node IDs — use deterministic suffix on collision
		const usedIds = new Map<string, number>();
		function sanitizeId(name: string): string {
			const base = name.replace(/[^a-zA-Z0-9_]/g, "_");
			const count = usedIds.get(base);
			if (count === undefined) {
				usedIds.set(base, 1);
				return base;
			}
			usedIds.set(base, count + 1);
			return `${base}__${count}`;
		}

		// Cache name→id mapping for edge resolution
		const nameToId = new Map<string, string>();

		function truncateValue(v: unknown): string {
			const s = JSON.stringify(v);
			return s && s.length > 30 ? `${s.slice(0, 27)}...` : (s ?? "undefined");
		}

		for (const node of snap.nodes) {
			const id = sanitizeId(node.name);
			nameToId.set(node.name, id);
			const label = `${node.name} (${node.kind}) = ${truncateValue(node.value)}`;
			const style = statusStyle[node.status ?? ""] ?? "";
			lines.push(`  ${id}["${label}"]${style}`);
		}

		for (const edge of snap.edges) {
			const fromId = nameToId.get(edge.from) ?? sanitizeId(edge.from);
			const toId = nameToId.get(edge.to) ?? sanitizeId(edge.to);
			lines.push(`  ${fromId} --> ${toId}`);
		}

		// classDef declarations for status-based styling
		lines.push("");
		lines.push("  classDef settled fill:#d4edda,stroke:#28a745");
		lines.push("  classDef dirty fill:#fff3cd,stroke:#ffc107");
		lines.push("  classDef errored fill:#f8d7da,stroke:#dc3545");
		lines.push("  classDef completed fill:#cce5ff,stroke:#007bff");

		return lines.join("\n");
	}

	/**
	 * Export the graph as a D2 diagram string.
	 *
	 * ```ts
	 * console.log(Inspector.toD2());
	 * // count: "count (state) = 0" { shape: rectangle }
	 * // doubled: "doubled (derived) = 0" { shape: rectangle }
	 * // count -> doubled
	 * ```
	 */
	static toD2(opts?: { direction?: "right" | "down" | "left" | "up" }): string {
		const direction = opts?.direction ?? "down";
		const snap = Inspector.snapshot();
		const lines: string[] = [`direction: ${direction}`, ""];

		const kindShape: Record<string, string> = {
			state: "rectangle",
			derived: "hexagon",
			effect: "oval",
			producer: "rectangle",
			operator: "parallelogram",
			"pipeline-step": "rectangle",
			"pipeline-status": "diamond",
			checkpoint: "cylinder",
		};

		// Sanitize with collision avoidance
		const usedIds = new Map<string, number>();
		function sanitizeId(name: string): string {
			const base = name.replace(/[^a-zA-Z0-9_]/g, "_");
			const count = usedIds.get(base);
			if (count === undefined) {
				usedIds.set(base, 1);
				return base;
			}
			usedIds.set(base, count + 1);
			return `${base}__${count}`;
		}

		const nameToId = new Map<string, string>();

		function truncateValue(v: unknown): string {
			const s = JSON.stringify(v);
			return s && s.length > 30 ? `${s.slice(0, 27)}...` : (s ?? "undefined");
		}

		for (const node of snap.nodes) {
			const id = sanitizeId(node.name);
			nameToId.set(node.name, id);
			const shape = kindShape[node.kind] ?? "rectangle";
			const label = `${node.name} (${node.kind}) = ${truncateValue(node.value)}`;
			const statusStr = node.status ? ` [${node.status}]` : "";
			lines.push(`${id}: "${label}${statusStr}" { shape: ${shape} }`);
		}

		if (snap.edges.length > 0) lines.push("");

		for (const edge of snap.edges) {
			const fromId = nameToId.get(edge.from) ?? sanitizeId(edge.from);
			const toId = nameToId.get(edge.to) ?? sanitizeId(edge.to);
			lines.push(`${fromId} -> ${toId}`);
		}

		return lines.join("\n");
	}

	/**
	 * Annotate a node with a reasoning trace — captures *why* a decision was made.
	 * Stored both on the node (latest annotation) and in the chronological trace log.
	 */
	static annotate(node: object, reason: string): void {
		if (!Inspector.enabled) return;
		Inspector._annotations.set(node, reason);
		const entry: TraceEntry = {
			node: Inspector._resolveKey(node),
			reason,
			timestamp: Date.now(),
		};
		const max = Inspector.maxTraceEntries;
		if (max <= 0) return;
		if (Inspector._traceLog.length < max) {
			Inspector._traceLog.push(entry);
		} else {
			Inspector._traceLog[Inspector._traceHead] = entry;
			Inspector._traceFull = true;
		}
		Inspector._traceHead = (Inspector._traceHead + 1) % max;
	}

	/** Get the latest annotation for a node, if any. */
	static getAnnotation(node: object): string | undefined {
		return Inspector._annotations.get(node);
	}

	/** Get the full chronological trace log of all annotations. */
	static traceLog(): TraceEntry[] {
		if (!Inspector._traceFull)
			return Inspector._traceLog.slice(0, Inspector._traceHead || Inspector._traceLog.length);
		// Ring buffer is full — return in chronological order: [head..end, 0..head)
		return [
			...Inspector._traceLog.slice(Inspector._traceHead),
			...Inspector._traceLog.slice(0, Inspector._traceHead),
		];
	}

	/** Clear the trace log (keeps per-node annotations in WeakMap). */
	static clearTrace(): void {
		Inspector._traceLog = [];
		Inspector._traceHead = 0;
		Inspector._traceFull = false;
	}

	/**
	 * Per-store event timeline with timestamps and batch context.
	 * Each entry records what happened and when — ideal for debugging
	 * ordering issues and batch drain behavior.
	 *
	 * ```ts
	 * const tl = Inspector.timeline(myStore);
	 * myState.set(5);
	 * tl.entries // [{ timestamp, type: "signal", data: DIRTY, inBatch: false },
	 * //            { timestamp, type: "data", data: 5, inBatch: false }]
	 * tl.dispose();
	 * ```
	 */
	static timeline<T>(store: Store<T>): TimelineResult<T> {
		let talkback: ((type: number) => void) | null = null;
		const entries: TimelineEntry<T>[] = [];

		store.source(START, (type: number, data: any) => {
			if (type === START) {
				talkback = data;
				return;
			}
			const entry: TimelineEntry<T> = {
				timestamp: Date.now(),
				type: type === DATA ? "data" : type === STATE ? "signal" : "end",
				data,
				inBatch: isBatching(),
			};
			entries.push(entry);
			if (type === END) talkback = null;
		});

		return {
			entries,
			dispose: () => talkback?.(END),
		};
	}

	/**
	 * Observe a derived store with per-evaluation dep snapshots.
	 * Temporarily wraps the derived's computation function to capture
	 * dep values on each evaluation. Opt-in — removed on dispose.
	 *
	 * ```ts
	 * const obs = Inspector.observeDerived(myDerived);
	 * source.set(5);
	 * obs.evaluations[0].depValues // [5] — snapshot of deps when derived recomputed
	 * obs.evaluations[0].result    // computed result
	 * obs.dispose();
	 * ```
	 */
	static observeDerived<T>(store: Store<T>): DerivedObserveResult<T> {
		const evaluations: DerivedObserveEntry<T>[] = [];
		const impl = store as any;

		// Wrap _fn to capture dep values + result on each evaluation
		const originalFn = impl._fn;
		if (typeof originalFn !== "function" || !Array.isArray(impl._deps)) {
			// Not a derived — fall back to regular observe
			const base = Inspector.observe<T>(store);
			return { ...base, evaluations };
		}

		impl._fn = () => {
			const depValues = (impl._deps as Store<unknown>[]).map((d: Store<unknown>) => d.get());
			const result = originalFn();
			evaluations.push({ result, depValues, timestamp: Date.now() });
			return result;
		};

		const base = Inspector._observe<T>(store);

		const originalDispose = base.dispose;
		const result: DerivedObserveResult<T> = {
			...base,
			evaluations,
			dispose: () => {
				impl._fn = originalFn;
				originalDispose();
			},
			reconnect: () => {
				impl._fn = originalFn;
				originalDispose();
				return Inspector.observeDerived(store);
			},
		};

		return result;
	}

	/**
	 * Observe a taskState's status transitions over time. Captures each
	 * status change with previous/new status, error (if any), and timestamp.
	 *
	 * ```ts
	 * const obs = Inspector.observeTaskState(myTask);
	 * await myTask.run(async () => "done");
	 * obs.transitions
	 * // [{ from: "idle", to: "running", timestamp: ... },
	 * //  { from: "running", to: "success", timestamp: ... }]
	 * obs.dispose();
	 * ```
	 */
	static observeTaskState(taskState: {
		status: Store<any>;
		error: Store<any>;
	}): TaskStateObserveResult {
		let prevStatus: string = taskState.status.get();
		const transitions: TaskStateTransition[] = [];

		// Subscribe directly to capture status transitions
		let talkback: ((type: number) => void) | null = null;
		taskState.status.source(START, (type: number, data: any) => {
			if (type === START) {
				talkback = data;
				return;
			}
			if (type === DATA) {
				const newStatus = data as string;
				if (newStatus !== prevStatus) {
					const entry: TaskStateTransition = {
						from: prevStatus,
						to: newStatus,
						timestamp: Date.now(),
					};
					if (newStatus === "error") {
						entry.error = taskState.error.get();
					}
					transitions.push(entry);
					prevStatus = newStatus;
				}
			}
			if (type === END) talkback = null;
		});

		return {
			transitions,
			get currentStatus() {
				return taskState.status.get() as string;
			},
			dispose: () => {
				talkback?.(END);
			},
		};
	}

	/**
	 * Observe a derived store with causality tracking — records which dep
	 * triggered each recomputation. Wraps the derived's `_fn` to snapshot
	 * dep values before and after, identifying the changed dep.
	 *
	 * ```ts
	 * const obs = Inspector.causalityTrace(myDerived);
	 * depA.set(5);
	 * obs.causality[0].triggerDepIndex // 0 — depA triggered it
	 * obs.causality[0].triggerDepName  // "depA" (if named)
	 * obs.dispose();
	 * ```
	 *
	 * @remarks Only one _fn-wrapping observer (`causalityTrace` or `observeDerived`)
	 * may be active per derived store at a time. Activating a second without
	 * disposing the first will overwrite the wrapped `_fn`, causing the first
	 * observer to stop recording and its `dispose()` to restore the wrong original.
	 */
	static causalityTrace<T>(store: Store<T>): CausalityResult<T> {
		const causality: CausalityEntry<T>[] = [];
		const impl = store as any;

		const originalFn = impl._fn;
		if (typeof originalFn !== "function" || !Array.isArray(impl._deps)) {
			// Not a derived — fall back to regular observe with empty causality
			const base = Inspector.observe<T>(store);
			return { ...base, causality };
		}

		const deps: Store<unknown>[] = impl._deps;
		let prevDepValues: unknown[] = deps.map((d) => d.get());

		impl._fn = () => {
			const currentDepValues = deps.map((d) => d.get());
			const result = originalFn();

			// Find which dep changed
			let triggerIndex = -1;
			for (let i = 0; i < deps.length; i++) {
				if (!Object.is(currentDepValues[i], prevDepValues[i])) {
					triggerIndex = i;
					break; // First changed dep is the trigger
				}
			}

			causality.push({
				result,
				triggerDepIndex: triggerIndex,
				triggerDepName: triggerIndex >= 0 ? Inspector.getName(deps[triggerIndex]) : undefined,
				depValues: currentDepValues,
				timestamp: Date.now(),
			});

			prevDepValues = currentDepValues;
			return result;
		};

		const base = Inspector._observe<T>(store);

		const originalDispose = base.dispose;
		const result: CausalityResult<T> = {
			...base,
			causality,
			dispose: () => {
				impl._fn = originalFn;
				originalDispose();
			},
			reconnect: () => {
				impl._fn = originalFn;
				originalDispose();
				return Inspector.causalityTrace(store);
			},
		};

		return result;
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
		Inspector._annotations = new WeakMap<object, string>();
		Inspector._traceLog = [];
		Inspector._traceHead = 0;
		Inspector._traceFull = false;
		Inspector.maxTraceEntries = 1000;
	}
}
