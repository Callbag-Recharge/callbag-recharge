// ---------------------------------------------------------------------------
// topicBridge — bidirectional local↔remote topic sync (SA-2d)
// ---------------------------------------------------------------------------
// Bridges local topic instances to remote counterparts via a MessageTransport.
// Messages published locally are forwarded to the remote side, and vice versa.
// Echo-dedup via originId prevents infinite loops.
// ---------------------------------------------------------------------------

import type { Subscription } from "../core/protocol";
import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";
import { subscribe } from "../extra/subscribe";
import type { MessageFilter, MessageTransport, TransportEnvelope } from "./transportTypes";
import type { Topic, TopicMessage } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TopicBridgeOpts {
	/** Debug name. */
	name?: string;
	/** Backpressure threshold: number of unread messages before signaling lagging. Default: 100. */
	backpressureThreshold?: number;
}

export interface BridgedTopic<T = unknown> {
	/** The local topic instance. */
	topic: Topic<T>;
	/** Optional filter: only forward messages matching this filter to the remote side. */
	filter?: MessageFilter<T>;
}

export interface TopicBridgeResult {
	/** Bridge name. */
	readonly name: string;
	/** Origin ID used for echo-dedup. */
	readonly originId: string;
	/** Reactive connection status (from underlying transport). */
	readonly status: Store<"connecting" | "connected" | "disconnected">;
	/** Per-topic backpressure signals from the remote side (SA-2h). */
	readonly backpressure: ReadonlyMap<string, Store<boolean>>;
	/** Add a topic to the bridge after creation. */
	addTopic<T>(name: string, bridgedTopic: BridgedTopic<T>): void;
	/** Remove a topic from the bridge. */
	removeTopic(name: string): void;
	/** Destroy the bridge and all subscriptions. */
	destroy(): void;
}

// ---------------------------------------------------------------------------
// Filter matching utility
// ---------------------------------------------------------------------------

function matchesFilter<T>(msg: TopicMessage<T>, filter?: MessageFilter<T>): boolean {
	if (!filter) return true;

	if (filter.keys && filter.keys.length > 0) {
		if (!msg.key || !filter.keys.includes(msg.key)) return false;
	}

	if (filter.headers) {
		if (!msg.headers) return false;
		for (const [k, v] of Object.entries(filter.headers)) {
			if (msg.headers[k] !== v) return false;
		}
	}

	if (filter.predicate && !filter.predicate(msg)) return false;

	return true;
}

// ---------------------------------------------------------------------------
// topicBridge
// ---------------------------------------------------------------------------

let bridgeCounter = 0;

/**
 * Create a bidirectional bridge between local topics and a remote endpoint.
 *
 * Messages published to local topics are forwarded to the remote side via the
 * transport. Messages received from the remote side are published to the
 * corresponding local topic. Echo-dedup via `originId` prevents infinite loops.
 *
 * @param transport - The message transport to use for communication.
 * @param topics - Map of topic name → bridged topic config.
 * @param opts - Bridge options.
 *
 * @returns `TopicBridgeResult` — reactive status, backpressure signals, lifecycle control.
 *
 * @remarks **Echo-dedup:** Each bridge instance has a unique `originId`. Outgoing
 * messages carry this ID. Incoming messages with the same `originId` are dropped.
 * @remarks **Filtering:** Outgoing messages are filtered per-topic before forwarding.
 * Incoming messages are always published to the local topic (the remote side filters).
 * @remarks **Backpressure (SA-2h):** When a remote consumer's backlog exceeds the
 * threshold, the bridge receives a backpressure envelope. The corresponding
 * `backpressure` store flips to `true`.
 *
 * @category messaging
 */
export function topicBridge(
	transport: MessageTransport,
	topics: Record<string, BridgedTopic>,
	opts?: TopicBridgeOpts,
): TopicBridgeResult {
	const bridgeId = ++bridgeCounter;
	const bridgeName = opts?.name ?? `bridge-${bridgeId}`;
	const originId =
		typeof crypto !== "undefined" && crypto.randomUUID
			? crypto.randomUUID()
			: `${bridgeName}-${bridgeId}-${Date.now()}`;
	const _threshold = opts?.backpressureThreshold ?? 100;

	// --- Per-topic tracking ---
	interface TopicEntry {
		topic: Topic<any>;
		filter?: MessageFilter<any>;
		/** Subscription to topic.latest for outgoing forwarding. */
		localSub: Subscription;
		/** Last seq we forwarded (avoid re-forwarding on subscribe). */
		lastForwardedSeq: number;
	}

	const _topics = new Map<string, TopicEntry>();

	// --- Backpressure stores (SA-2h) ---
	const _backpressureStores = new Map<string, ReturnType<typeof state<boolean>>>();

	function _getOrCreateBackpressure(topicName: string): ReturnType<typeof state<boolean>> {
		let s = _backpressureStores.get(topicName);
		if (!s) {
			s = state(false, { name: `${bridgeName}:bp:${topicName}` });
			_backpressureStores.set(topicName, s);
		}
		return s;
	}

	// --- Outgoing: subscribe to local topic.latest and forward ---

	function _forwardMessage(
		name: string,
		msg: TopicMessage<any>,
		filter: MessageFilter<any> | undefined,
	): void {
		if (!matchesFilter(msg, filter as MessageFilter | undefined)) return;
		// Don't re-forward messages that came from any bridge (prevents infinite loops)
		if (msg.headers?.["x-bridge-origin"]) return;
		transport.send({
			type: "publish",
			topic: name,
			message: msg,
			originId,
		});
	}

	function _subscribeLocal(name: string, bridged: BridgedTopic): TopicEntry {
		const t = bridged.topic;
		const filter = bridged.filter;

		const entry: TopicEntry = {
			topic: t,
			filter,
			localSub: null as any,
			lastForwardedSeq: t.tailSeq,
		};

		// Subscribe to topic.latest — catch up all messages since lastForwardedSeq
		// This handles batched publishes where latest only fires once with the last message.
		entry.localSub = subscribe(t.latest, (msg) => {
			if (!msg) return;
			if (msg.seq <= entry.lastForwardedSeq) return;

			// Catch up: forward all messages from lastForwardedSeq+1 to msg.seq
			const startSeq = entry.lastForwardedSeq + 1;
			if (msg.seq > startSeq) {
				const missed = t.slice(startSeq, msg.seq - 1);
				for (const m of missed) {
					_forwardMessage(name, m, filter);
				}
			}
			_forwardMessage(name, msg, filter);
			entry.lastForwardedSeq = msg.seq;
		});

		return entry;
	}

	// --- Incoming: handle messages from remote ---
	let _destroyed = false;

	const _transportUnsub = transport.onMessage((envelope: TransportEnvelope) => {
		if (_destroyed) return;

		switch (envelope.type) {
			case "publish": {
				// Echo-dedup: drop messages from ourselves
				if (envelope.originId === originId) return;

				const entry = _topics.get(envelope.topic);
				if (!entry) return;

				// Publish to local topic with origin header for echo prevention
				const msg = envelope.message;
				entry.topic.publish(msg.value, {
					key: msg.key,
					priority: msg.priority,
					headers: {
						...msg.headers,
						"x-bridge-origin": envelope.originId,
					},
				});
				break;
			}

			case "subscribe": {
				// Remote side is subscribing to a topic — store filter if provided
				// (For future use: server-side filtering of what we send)
				break;
			}

			case "unsubscribe": {
				// Remote side unsubscribing
				break;
			}

			case "ack": {
				// Remote acknowledged receipt — no-op for now
				break;
			}

			case "backpressure": {
				// SA-2h: update backpressure store
				const bpStore = _getOrCreateBackpressure(envelope.topic);
				bpStore.set(envelope.lagging);
				break;
			}

			case "admin": {
				// Handled by admin module, not the bridge
				break;
			}
		}
	});

	// --- Initialize all topics ---
	for (const [name, bridged] of Object.entries(topics)) {
		const entry = _subscribeLocal(name, bridged);
		_topics.set(name, entry);

		// Notify remote we're subscribing
		transport.send({
			type: "subscribe",
			topic: name,
			filter: bridged.filter as MessageFilter | undefined,
		});
	}

	// --- Public API ---
	return {
		get name() {
			return bridgeName;
		},
		get originId() {
			return originId;
		},
		status: transport.status,

		get backpressure() {
			return _backpressureStores as ReadonlyMap<string, Store<boolean>>;
		},

		addTopic<T>(name: string, bridged: BridgedTopic<T>): void {
			if (_destroyed) return;
			if (_topics.has(name)) return;

			const entry = _subscribeLocal(name, bridged as BridgedTopic);
			_topics.set(name, entry);

			transport.send({
				type: "subscribe",
				topic: name,
				filter: bridged.filter as MessageFilter | undefined,
			});
		},

		removeTopic(name: string): void {
			if (_destroyed) return;
			const entry = _topics.get(name);
			if (!entry) return;
			entry.localSub.unsubscribe();
			_topics.delete(name);

			// Clean up backpressure store for this topic
			const bpStore = _backpressureStores.get(name);
			if (bpStore) {
				teardown(bpStore);
				_backpressureStores.delete(name);
			}

			transport.send({ type: "unsubscribe", topic: name });
		},

		destroy(): void {
			if (_destroyed) return;
			_destroyed = true;

			// Unsubscribe from all local topics
			for (const entry of _topics.values()) {
				entry.localSub.unsubscribe();
			}
			_topics.clear();

			// Tear down backpressure stores
			batch(() => {
				for (const s of _backpressureStores.values()) {
					teardown(s);
				}
			});
			_backpressureStores.clear();

			// Close transport listener
			_transportUnsub();
			transport.close();
		},
	};
}
