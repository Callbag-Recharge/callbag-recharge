// ---------------------------------------------------------------------------
// admin — topic/subscription introspection API (SA-2g)
// ---------------------------------------------------------------------------
// Provides listTopics, inspectSubscription, resetCursor for operational
// management of the messaging system.
// ---------------------------------------------------------------------------

import type { Topic, TopicSubscription } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TopicInfo {
	/** Topic name. */
	name: string;
	/** Number of messages currently in the log. */
	depth: number;
	/** First sequence number in the log. */
	headSeq: number;
	/** Last sequence number in the log. */
	tailSeq: number;
	/** Whether the topic is paused. */
	paused: boolean;
	/** Total number of messages ever published. */
	publishCount: number;
}

export interface SubscriptionInfo {
	/** Subscription name. */
	name: string;
	/** Subscription mode. */
	mode: string;
	/** Current cursor position. */
	position: number;
	/** Number of unread messages. */
	backlog: number;
	/** Number of pulled-but-unacked messages. */
	pending: number;
	/** Consumer lag in ms. */
	lag: number;
	/** Whether the subscription is paused. */
	paused: boolean;
}

// ---------------------------------------------------------------------------
// Admin functions
// ---------------------------------------------------------------------------

/**
 * List information about a set of topics.
 *
 * @param topics - Map of name → topic instance (or array of topics).
 * @returns Array of `TopicInfo` snapshots.
 *
 * @category messaging
 */
export function listTopics(topics: Record<string, Topic<any>> | Topic<any>[]): TopicInfo[] {
	const arr = Array.isArray(topics) ? topics : Object.values(topics);
	return arr.map((t) => ({
		name: t.name,
		depth: t.depth.get(),
		headSeq: t.headSeq,
		tailSeq: t.tailSeq,
		paused: t.paused,
		publishCount: t.publishCount.get(),
	}));
}

/**
 * Inspect a subscription's current state.
 *
 * @param sub - The subscription to inspect.
 * @returns `SubscriptionInfo` snapshot.
 *
 * @category messaging
 */
export function inspectSubscription(sub: TopicSubscription<any>): SubscriptionInfo {
	return {
		name: sub.name,
		mode: sub.mode,
		position: sub.position.get(),
		backlog: sub.backlog.get(),
		pending: sub.pending.get(),
		lag: sub.lag.get(),
		paused: sub.isPaused,
	};
}

/**
 * Reset a subscription's cursor to a new position.
 *
 * Wraps `sub.seek()` for consistency with the admin API surface.
 *
 * @param sub - The subscription to reset.
 * @param position - New cursor position: sequence number, "earliest", or "latest".
 *
 * @category messaging
 */
export function resetCursor(
	sub: TopicSubscription<any>,
	position: number | "earliest" | "latest",
): void {
	sub.seek(position);
}
