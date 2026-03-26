// ---------------------------------------------------------------------------
// Message transport types — transport abstraction for distributed messaging
// ---------------------------------------------------------------------------
// Distinct from worker/WorkerTransport which carries raw store values.
// MessageTransport carries TopicMessage<T> envelopes with topic routing,
// echo-dedup, filtering, and backpressure signaling.
// ---------------------------------------------------------------------------

import type { Store } from "../core/types";
import type { TopicMessage } from "./types";

// ---------------------------------------------------------------------------
// Transport connection status
// ---------------------------------------------------------------------------

export type TransportStatus = "connecting" | "connected" | "disconnected";

// ---------------------------------------------------------------------------
// Message filter (SA-2e)
// ---------------------------------------------------------------------------

/** Server-side filter applied at the bridge level before forwarding messages. */
export interface MessageFilter<T = unknown> {
	/** Match messages whose key is in this set. */
	keys?: string[];
	/** Match messages whose headers contain all specified key-value pairs. */
	headers?: Record<string, string>;
	/** Arbitrary content predicate. */
	predicate?: (msg: TopicMessage<T>) => boolean;
}

// ---------------------------------------------------------------------------
// Transport envelope — wire protocol for topic bridge communication
// ---------------------------------------------------------------------------

/** Forward a published message to the remote side. */
export interface PublishEnvelope {
	type: "publish";
	topic: string;
	message: TopicMessage<unknown>;
	/** Origin bridge ID for echo-dedup. */
	originId: string;
}

/** Register interest in a topic (optionally with a filter). */
export interface SubscribeEnvelope {
	type: "subscribe";
	topic: string;
	filter?: MessageFilter;
}

/** Unregister interest in a topic. */
export interface UnsubscribeEnvelope {
	type: "unsubscribe";
	topic: string;
}

/** Acknowledge receipt of a message. */
export interface AckEnvelope {
	type: "ack";
	topic: string;
	seq: number;
}

/** Signal that a consumer is lagging (or recovered). */
export interface BackpressureEnvelope {
	type: "backpressure";
	topic: string;
	lagging: boolean;
}

/** Admin command envelope. */
export interface AdminEnvelope {
	type: "admin";
	command: string;
	args?: Record<string, unknown>;
}

export type TransportEnvelope =
	| PublishEnvelope
	| SubscribeEnvelope
	| UnsubscribeEnvelope
	| AckEnvelope
	| BackpressureEnvelope
	| AdminEnvelope;

// ---------------------------------------------------------------------------
// MessageTransport interface (SA-2a)
// ---------------------------------------------------------------------------

/**
 * Transport abstraction for distributed topic messaging.
 *
 * Carries `TransportEnvelope` messages between bridge instances. Implementations
 * handle the physical connection (WebSocket, HTTP/2, etc.) while the bridge
 * handles topic routing, echo-dedup, filtering, and backpressure.
 *
 * @remarks Callback-based `onMessage` rather than store-based — transports are
 * system boundaries. The bridge converts to reactive stores internally.
 *
 * @category messaging
 */
export interface MessageTransport {
	/** Send an envelope to the remote side. */
	send(envelope: TransportEnvelope): void;

	/** Register a handler for incoming envelopes. Returns unsubscribe function. */
	onMessage(handler: (envelope: TransportEnvelope) => void): () => void;

	/** Reactive connection status. */
	readonly status: Store<TransportStatus>;

	/** Graceful shutdown. */
	close(): void;
}
