// ---------------------------------------------------------------------------
// Messaging module types — Pulsar-inspired topic/subscription system
// ---------------------------------------------------------------------------

import type { Store } from "../core/types";
import type { NodeV0 } from "../data/types";
import type { BackoffStrategy } from "../utils/backoff";
import type { CheckpointAdapter } from "../utils/checkpoint";
import type { Namespace } from "../utils/namespace";

// ---------------------------------------------------------------------------
// Message envelope
// ---------------------------------------------------------------------------

/** Internal storage type (without seq, which comes from LogEntry). */
export interface MessageMeta<T> {
	value: T;
	timestamp: number;
	key?: string;
	priority?: number;
	headers?: Record<string, string>;
}

/** Public message type exposed to consumers. */
export interface TopicMessage<T> {
	/** Sequence number (monotonically increasing, 1-based). */
	seq: number;
	/** The message payload. */
	value: T;
	/** Publish timestamp (ms since epoch). */
	timestamp: number;
	/** Optional partition key (for key_shared subscriptions). */
	key?: string;
	/** Optional priority (lower number = higher priority). */
	priority?: number;
	/** Optional headers for metadata. */
	headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Schema (same shape as utils/withSchema)
// ---------------------------------------------------------------------------

export interface MessageSchema<T> {
	parse(value: unknown): T;
}

// ---------------------------------------------------------------------------
// Topic
// ---------------------------------------------------------------------------

export interface TopicOptions<T> {
	/** Maximum number of messages retained. 0 = unlimited (default). */
	maxSize?: number;
	/** Runtime validation for published messages. Compatible with Zod/Valibot/ArkType. */
	schema?: MessageSchema<T>;
	/** Namespace for key scoping. */
	namespace?: Namespace;
	/** Persistence adapter for durable storage. */
	persistence?: CheckpointAdapter;
	/** Log compaction configuration. */
	compaction?: {
		/** Extract dedup key from message value. */
		keyFn: (value: T) => string;
		/** Auto-compact threshold. 0 = manual only (default). */
		threshold?: number;
	};
	/** Dedup window for duplicate detection. */
	dedup?: {
		/** Dedup window in ms. Default: 60_000. */
		windowMs?: number;
	};
}

export interface PublishOptions {
	/** Partition key for key_shared subscriptions. */
	key?: string;
	/** Message priority (lower = higher priority). */
	priority?: number;
	/** Delay delivery by this many ms. */
	delay?: number;
	/** Dedup key — duplicate keys within the dedup window are dropped. */
	dedupKey?: string;
	/** Optional message headers. */
	headers?: Record<string, string>;
}

export interface Topic<T> extends NodeV0 {
	/** Topic name. */
	readonly name: string;

	// --- Publishing ---

	/** Publish a message. Returns the sequence number (-1 if dropped/delayed). */
	publish(value: T, opts?: PublishOptions): number;

	// --- Reading ---

	/** Read a single message by sequence number. */
	get(seq: number): TopicMessage<T> | undefined;
	/** Read a range of messages (inclusive). */
	slice(from?: number, to?: number): TopicMessage<T>[];
	/** First sequence number still in the log. 0 if empty. */
	readonly headSeq: number;
	/** Last sequence number in the log. 0 if empty. */
	readonly tailSeq: number;

	// --- Companion stores (5e-3) ---

	/** Reactive message count. */
	readonly depth: Store<number>;
	/** Reactive latest message. */
	readonly latest: Store<TopicMessage<T> | undefined>;
	/** Reactive total published count. */
	readonly publishCount: Store<number>;

	// --- Lifecycle (5e-3) ---

	/** Peek at the oldest message without consuming. */
	peek(): TopicMessage<T> | undefined;
	/** Pause publishing (messages are dropped while paused). Dispatches PAUSE signal through companion stores. */
	pause(): void;
	/** Resume publishing. Dispatches RESUME signal through companion stores. */
	resume(): void;
	/** Whether the topic is currently paused. */
	readonly paused: boolean;
	/** Tear down all internal stores and timers. */
	destroy(): void;
}

// ---------------------------------------------------------------------------
// Topic internal (accessed by subscription via symbol)
// ---------------------------------------------------------------------------

export const TOPIC_INTERNAL = Symbol.for("callbag-recharge:topic-internal");

export interface TopicInternalAccess<_T> {
	/** Get or create a consumer group for shared/failover/key_shared subscriptions. */
	getOrCreateGroup(name: string): ConsumerGroup;
	/** Unregister a consumer group when empty. */
	removeGroup(name: string): void;
}

// ---------------------------------------------------------------------------
// Consumer group (shared cursor for same-name subscriptions)
// ---------------------------------------------------------------------------

export interface ConsumerGroup {
	/** Shared cursor position (next seq to read). */
	cursor: number;
	/** Round-robin index for shared mode dispatch. */
	roundRobinIndex: number;
	/** Connected consumer IDs. */
	consumers: Set<string>;
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export type SubscriptionMode = "exclusive" | "shared" | "failover" | "key_shared";

export interface SubscriptionOptions<T = unknown> {
	/** Subscription name. Auto-generated if omitted. */
	name?: string;
	/** Subscription mode. Default: 'exclusive'. */
	mode?: SubscriptionMode;
	/** Where to start reading. Default: 'latest'. */
	initialPosition?: "earliest" | "latest" | number;
	/** Default batch size for pull(). Default: 1. */
	batchSize?: number;
	/** Auto-nack timeout in ms. 0 = no timeout. Default: 30_000. */
	ackTimeout?: number;
	/** Persistence adapter for cursor state. */
	persistence?: CheckpointAdapter;
	/** Retry configuration for nacked messages (5e-4). */
	retry?: {
		/** Max retry attempts before sending to DLQ. Default: 3. */
		maxRetries?: number;
		/** Backoff strategy for retry delays. Default: exponential(). */
		backoff?: BackoffStrategy;
	};
	/** Dead letter topic for terminal failures (5e-4). */
	deadLetterTopic?: Topic<T>;
}

export interface TopicSubscription<T> {
	/** Subscription name. */
	readonly name: string;
	/** Subscription mode. */
	readonly mode: SubscriptionMode;

	// --- Pull-based consumption ---

	/** Pull up to `count` messages. Returns immediately with available messages. */
	pull(count?: number): TopicMessage<T>[];

	// --- Ack/Nack ---

	/** Acknowledge a message. Advances the cursor past this seq. */
	ack(seq: number): void;
	/** Negative-acknowledge a message. Routes to retry or DLQ (5e-4). */
	nack(seq: number): void;

	// --- Seeking (5e-3) ---

	/** Rewind or fast-forward the cursor. */
	seek(position: number | "earliest" | "latest"): void;

	// --- Companion stores (5e-3) ---

	/** Reactive cursor position (next seq to read). */
	readonly position: Store<number>;
	/** Reactive count of unread messages (past cursor). */
	readonly backlog: Store<number>;
	/** Reactive count of pulled-but-unacked messages. */
	readonly pending: Store<number>;

	// --- Lifecycle ---

	/** Pause consumption (pull returns empty while paused). Dispatches PAUSE signal through companion stores. */
	pause(): void;
	/** Resume consumption. Dispatches RESUME signal through companion stores. */
	resume(): void;
	/** Whether the subscription is paused. */
	readonly isPaused: boolean;
	/** Tear down the subscription. */
	destroy(): void;
}

// ---------------------------------------------------------------------------
// Repeat publish (5e-5)
// ---------------------------------------------------------------------------

export interface RepeatPublishOptions {
	/** Interval in ms between publishes. */
	every?: number;
	/** Cron expression (requires fromCron). */
	cron?: string;
	/** Maximum number of repetitions. 0 = unlimited (default). */
	limit?: number;
	/** Dedup key for repeated messages. */
	dedupKey?: string;
	/** Partition key for messages. */
	key?: string;
	/** Message headers. */
	headers?: Record<string, string>;
}

export interface RepeatHandle {
	/** Cancel the repeating publication. */
	cancel(): void;
	/** Reactive count of messages published so far. */
	readonly count: Store<number>;
	/** Whether the repeat is still active. */
	readonly active: boolean;
}
