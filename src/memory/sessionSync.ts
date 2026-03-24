// ---------------------------------------------------------------------------
// Session Sync — wires a Collection to a SessionTransport via reactive diffs
// ---------------------------------------------------------------------------
// Subscribes to collection.nodes, computes add/remove/update diffs, and
// sends structured SessionEvents through a pluggable transport.
//
// "Same graph, different edge." — the collection graph is unchanged;
// swap wsTransport ↔ httpTransport to change the transport layer.
//
// Two subscription layers:
// 1. collection.nodes — structural changes (add/remove)
// 2. Per-node meta stores — content/metadata updates (via subscribe, per §1.19)
// ---------------------------------------------------------------------------

import { subscribe } from "../core/subscribe";
import type {
	Collection,
	MemoryNode,
	SerializedNode,
	SessionSyncOptions,
	SessionTransport,
} from "./types";

function serializeNode<T>(node: MemoryNode<T>): SerializedNode<T> {
	const meta = node.meta.get();
	return {
		id: node.id,
		content: node.content.get(),
		meta: {
			id: meta.id,
			createdAt: meta.createdAt,
			updatedAt: meta.updatedAt,
			accessedAt: meta.accessedAt,
			accessCount: meta.accessCount,
			importance: meta.importance,
			tags: Array.from(meta.tags),
		},
	};
}

/**
 * Syncs a `Collection` to a remote via a pluggable `SessionTransport`.
 *
 * Subscribes to `collection.nodes` for structural changes (add/remove) and
 * to each node's `meta` store for content/metadata updates. All metadata
 * changes — including `touch()`, `tag()`, `setImportance()` — propagate as
 * `"update"` events. Sends structured diff events through the transport.
 * Uses lightweight `subscribe()` throughout (single dep per subscription,
 * no DIRTY/RESOLVED overhead per §1.19).
 *
 * `dispose()` stops syncing but does **not** close the transport — the
 * caller manages transport lifecycle separately.
 *
 * @param col - The collection to sync.
 * @param transport - Transport backend (wsTransport, httpTransport, or custom).
 * @param opts - Optional configuration.
 *
 * @returns `{ dispose() }` — call to stop syncing.
 *
 * @example
 * ```ts
 * import { collection } from 'callbag-recharge/memory';
 * import { sessionSync, wsTransport } from 'callbag-recharge/memory';
 *
 * const mem = collection<string>({ maxSize: 100 });
 * const transport = wsTransport(new WebSocket('ws://localhost:8080'));
 * const { dispose } = sessionSync(mem, transport);
 *
 * mem.add("hello"); // → transport receives { type: "add", nodes: [...] }
 * dispose();
 * transport.close(); // caller manages transport lifecycle
 * ```
 *
 * @category memory
 */
export function sessionSync<T>(
	col: Collection<T>,
	transport: SessionTransport<T>,
	opts?: SessionSyncOptions,
): { dispose(): void } {
	const sendSnapshot = opts?.initialSnapshot !== false;
	let disposed = false;

	// Per-node meta subscriptions for detecting content/metadata updates.
	// Node content changes don't bump collection._version, so col.nodes
	// won't re-emit — we need direct per-node subscriptions.
	const nodeMetaSubs = new Map<string, { unsubscribe(): void }>();

	function trackNode(node: MemoryNode<T>): void {
		if (nodeMetaSubs.has(node.id)) return;
		// subscribe() on state stores does NOT fire an initial callback
		// (RxJS Observable semantics — no initial-value callback on subscribe).
		// Every callback here is a real change.
		const sub = subscribe(node.meta, () => {
			// Guard: node may have been evicted (maxSize) or destroyed before
			// the structural diff runs untrackNode. Skip if gone.
			if (disposed || !col.has(node.id)) return;
			transport.send({ type: "update", nodes: [serializeNode(node)] });
		});
		nodeMetaSubs.set(node.id, sub);
	}

	function untrackNode(nodeId: string): void {
		const sub = nodeMetaSubs.get(nodeId);
		if (sub) {
			sub.unsubscribe();
			nodeMetaSubs.delete(nodeId);
		}
	}

	// Track previous node IDs for structural diffing
	let prevIds = new Set<string>();

	// Read initial state eagerly via get() — derived uses deferred start,
	// so subscribe callback won't fire synchronously on connect.
	const initialNodes = col.nodes.get();
	prevIds = new Set(initialNodes.map((n) => n.id));

	if (sendSnapshot) {
		transport.send({ type: "snapshot", nodes: initialNodes.map(serializeNode) });
	}

	// Start tracking all existing nodes for updates
	for (const node of initialNodes) {
		trackNode(node);
	}

	// Subscribe for structural changes (add/remove)
	const structSub = subscribe(col.nodes, (nodes: MemoryNode<T>[]) => {
		if (disposed) return;
		const currentIds = new Set(nodes.map((n) => n.id));

		// Detect adds
		const added: MemoryNode<T>[] = [];
		for (const node of nodes) {
			if (!prevIds.has(node.id)) {
				added.push(node);
				trackNode(node);
			}
		}

		// Detect removes
		const removedIds: string[] = [];
		for (const id of prevIds) {
			if (!currentIds.has(id)) {
				removedIds.push(id);
				untrackNode(id);
			}
		}

		// Send events
		if (added.length > 0) {
			transport.send({ type: "add", nodes: added.map(serializeNode) });
		}
		if (removedIds.length > 0) {
			transport.send({ type: "remove", nodeIds: removedIds });
		}

		prevIds = currentIds;
	});

	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			structSub.unsubscribe();
			for (const sub of nodeMetaSubs.values()) sub.unsubscribe();
			nodeMetaSubs.clear();
		},
	};
}

export { serializeNode };
