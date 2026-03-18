// ---------------------------------------------------------------------------
// PubSub — thin topic-based publish/subscribe channel
// ---------------------------------------------------------------------------
// A lightweight message bus built on state stores. Each topic is a lazily
// created state store. publish() sets the value; subscribe() returns a
// read-only derived. Zero cost for unobserved topics.
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store, WritableStore } from "../core/types";
import type { PubSub, PubSubSnapshot } from "./types";

let pubsubCounter = 0;

/**
 * Restore a pubsub from a snapshot. Preserves id; version resets to 0.
 * Only channels with non-undefined values are restored.
 */
pubsub.from = function from<T>(snap: PubSubSnapshot<T>): PubSub<T> {
	const bus = pubsub<T>({ id: snap.id });
	for (const [topic, value] of Object.entries(snap.channels)) {
		if (value !== undefined) bus.publish(topic, value as T);
	}
	return bus;
};

export function pubsub<T = unknown>(opts?: { id?: string }): PubSub<T> {
	const counter = ++pubsubCounter;
	const nodeId = opts?.id ?? `pubsub-${counter}`;
	const _channels = new Map<string, WritableStore<T | undefined>>();
	const _views = new Map<string, Store<T | undefined>>();
	const _version = state<number>(0, { name: `${nodeId}:ver` });
	let destroyed = false;

	function _getOrCreate(topic: string): WritableStore<T | undefined> {
		let ch = _channels.get(topic);
		if (!ch) {
			ch = state<T | undefined>(undefined, {
				name: `${nodeId}:${topic}`,
				equals: () => false, // always emit (messages are ephemeral)
			});
			_channels.set(topic, ch);
			_version.update((v) => v + 1);
		}
		return ch;
	}

	function _getView(topic: string): Store<T | undefined> {
		let view = _views.get(topic);
		if (!view) {
			const ch = _getOrCreate(topic);
			view = derived([ch], () => ch.get(), {
				name: `${nodeId}:${topic}:view`,
				equals: () => false,
			});
			_views.set(topic, view);
		}
		return view;
	}

	return {
		get id() {
			return nodeId;
		},
		get version() {
			return _version.get();
		},

		publish(topic: string, message: T): void {
			if (destroyed) return;
			_getOrCreate(topic).set(message);
		},

		subscribe(topic: string): Store<T | undefined> {
			if (destroyed) throw new Error("PubSub is destroyed");
			return _getView(topic);
		},

		topics(): string[] {
			return Array.from(_channels.keys());
		},

		snapshot(): PubSubSnapshot<T> {
			const channels: Record<string, T | undefined> = {};
			for (const [topic, ch] of _channels) {
				channels[topic] = ch.get();
			}
			return {
				type: "pubsub",
				id: nodeId,
				version: _version.get(),
				channels,
			};
		},

		destroy(): void {
			if (destroyed) return;
			destroyed = true;
			batch(() => {
				for (const v of _views.values()) teardown(v);
				_views.clear();
				for (const ch of _channels.values()) teardown(ch);
				_channels.clear();
				teardown(_version);
			});
		},
	};
}
