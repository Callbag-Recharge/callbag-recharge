// ---------------------------------------------------------------------------
// topic — persistent append-only message stream
// ---------------------------------------------------------------------------
// Wraps a reactiveLog with a message envelope, publish options (delay, dedup,
// schema validation, priority), persistence, and compaction. Pulsar-inspired:
// topics are durable streams, subscriptions are cursors on those streams.
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { batch, PAUSE, RESUME, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";
import type { CompactionResult } from "../data/compaction";
import { compaction } from "../data/compaction";
import { reactiveLog } from "../data/reactiveLog";
import type { LogEntry, ReactiveLog } from "../data/types";
import type {
	ConsumerGroup,
	MessageMeta,
	PublishOptions,
	Topic,
	TopicInternalAccess,
	TopicMessage,
	TopicOptions,
} from "./types";

let topicCounter = 0;

/** Convert a LogEntry<MessageMeta<T>> to a public TopicMessage<T>. */
function toMessage<T>(entry: LogEntry<MessageMeta<T>>): TopicMessage<T> {
	return {
		seq: entry.seq,
		value: entry.value.value,
		timestamp: entry.value.timestamp,
		key: entry.value.key,
		priority: entry.value.priority,
		headers: entry.value.headers,
	};
}

/**
 * Create a persistent append-only message stream.
 *
 * @param name - Topic name (used for identification and namespacing).
 * @param opts - Optional configuration.
 *
 * @returns `Topic<T>` — publish messages, read by seq, reactive companions, lifecycle control.
 *
 * @remarks **Backed by reactiveLog:** Messages are stored as `LogEntry<MessageMeta<T>>` in an
 * append-only log with monotonic sequence numbers and optional bounded buffer.
 * @remarks **Schema validation:** Pass `{ parse(v): T }` (Zod/Valibot/ArkType compatible) to
 * validate messages at publish time. Invalid messages throw.
 * @remarks **Dedup:** Pass `dedupKey` in publish options. Duplicate keys within the dedup window
 * (default 60s) are silently dropped.
 * @remarks **Delayed messages:** Pass `delay` in publish options. Message is published after the
 * delay via setTimeout.
 * @remarks **Compaction:** Configure `compaction.keyFn` to enable log compaction (retains latest
 * entry per key). Manual via topic internals or auto-triggered at threshold.
 * @remarks **Namespacing:** Pass a `Namespace` to scope the topic name and persistence keys.
 *
 * @category messaging
 */
export function topic<T>(name: string, opts?: TopicOptions<T>): Topic<T> {
	const counter = ++topicCounter;
	const ns = opts?.namespace;
	const prefixedName = ns ? ns.prefix(name) : name;
	const nodeId = `topic-${prefixedName}-${counter}`;

	// --- Internal log ---
	const _log: ReactiveLog<MessageMeta<T>> = reactiveLog({
		id: `${nodeId}:log`,
		maxSize: opts?.maxSize,
	});

	// --- Compaction ---
	let _compactor: CompactionResult<MessageMeta<T>> | undefined;
	if (opts?.compaction) {
		const keyFn = opts.compaction.keyFn;
		_compactor = compaction(_log, (meta) => keyFn(meta.value), {
			threshold: opts.compaction.threshold,
		});
	}

	// --- Dedup tracking ---
	const _dedupWindow = opts?.dedup?.windowMs ?? 60_000;
	const _dedupMap = new Map<string, number>(); // key -> timestamp
	let _dedupCleanupTimer: ReturnType<typeof setInterval> | undefined;
	if (_dedupWindow > 0) {
		// Periodic cleanup of expired dedup entries — unref so it won't keep process alive
		_dedupCleanupTimer = setInterval(
			() => {
				const now = Date.now();
				for (const [key, ts] of _dedupMap) {
					if (now - ts >= _dedupWindow) _dedupMap.delete(key);
				}
			},
			Math.min(_dedupWindow, 30_000),
		);
		if (
			_dedupCleanupTimer &&
			typeof _dedupCleanupTimer === "object" &&
			"unref" in _dedupCleanupTimer
		) {
			_dedupCleanupTimer.unref();
		}
	}

	// --- State ---
	let _paused = false;
	let _destroyed = false;
	const _pendingDelayed = new Set<ReturnType<typeof setTimeout>>();

	// --- Consumer groups (for shared/failover/key_shared subscriptions) ---
	const _groups = new Map<string, ConsumerGroup>();

	// --- Reactive stores ---
	const _publishCount = state<number>(0, { name: `${nodeId}:pubCount` });
	const _version = state<number>(0, { name: `${nodeId}:ver` });

	const _depth: Store<number> = _log.lengthStore;

	const _latest: Store<TopicMessage<T> | undefined> = derived(
		[_log.latest],
		() => {
			const entry = _log.latest.get();
			return entry ? toMessage(entry) : undefined;
		},
		{ name: `${nodeId}:latest` },
	);

	// --- Schema ---
	const _schema = opts?.schema;

	// --- Persistence ---
	const _persistence = opts?.persistence
		? ns
			? ns.checkpoint(opts.persistence)
			: opts.persistence
		: undefined;

	// --- Internal access for subscriptions ---
	const _internal: TopicInternalAccess<T> = {
		getOrCreateGroup(groupName: string): ConsumerGroup {
			let group = _groups.get(groupName);
			if (!group) {
				group = {
					cursor: _log.tailSeq + 1,
					roundRobinIndex: 0,
					consumers: new Set(),
				};
				_groups.set(groupName, group);
			}
			return group;
		},
		removeGroup(groupName: string): void {
			_groups.delete(groupName);
		},
	};

	// --- Publish ---
	function publish(value: T, publishOpts?: PublishOptions): number {
		if (_destroyed || _paused) return -1;

		// Schema validation (throws on invalid)
		if (_schema) {
			value = _schema.parse(value);
		}

		// Dedup check
		const dedupKey = publishOpts?.dedupKey;
		if (dedupKey) {
			const now = Date.now();
			const lastSeen = _dedupMap.get(dedupKey);
			if (lastSeen !== undefined && now - lastSeen < _dedupWindow) {
				return -1; // duplicate within window
			}
			_dedupMap.set(dedupKey, now);
		}

		// Build message metadata
		const meta: MessageMeta<T> = {
			value,
			timestamp: Date.now(),
			key: publishOpts?.key,
			priority: publishOpts?.priority,
			headers: publishOpts?.headers,
		};

		// Delayed publish
		if (publishOpts?.delay && publishOpts.delay > 0) {
			const timer = setTimeout(() => {
				_pendingDelayed.delete(timer); // always clean up, even if paused/destroyed
				if (!_destroyed && !_paused) {
					batch(() => {
						_log.append(meta);
						_publishCount.update((v) => v + 1);
						_version.update((v) => v + 1);
					});
				}
			}, publishOpts.delay);
			_pendingDelayed.add(timer);
			return -1; // no seq yet
		}

		// Immediate publish
		const seq = batch(() => {
			const s = _log.append(meta);
			_publishCount.update((v) => v + 1);
			_version.update((v) => v + 1);
			return s;
		});
		return seq;
	}

	// --- Reading ---
	function getMessage(seq: number): TopicMessage<T> | undefined {
		const entry = _log.get(seq);
		return entry ? toMessage(entry) : undefined;
	}

	function getMessages(from?: number, to?: number): TopicMessage<T>[] {
		return _log.slice(from, to).map(toMessage);
	}

	// --- Public API ---
	const topicObj: Topic<T> = {
		get id() {
			return nodeId;
		},
		get version() {
			return _version.get();
		},
		get name() {
			return prefixedName;
		},

		publish,

		get(seq: number) {
			return getMessage(seq);
		},

		slice(from?: number, to?: number) {
			return getMessages(from, to);
		},

		get headSeq() {
			return _log.headSeq;
		},

		get tailSeq() {
			return _log.tailSeq;
		},

		// Companion stores
		depth: _depth,
		latest: _latest,
		publishCount: _publishCount as Store<number>,

		// Lifecycle
		peek() {
			if (_log.length === 0) return undefined;
			const entry = _log.get(_log.headSeq);
			return entry ? toMessage(entry) : undefined;
		},

		pause() {
			if (_paused) return;
			_paused = true;
			// Cancel pending delayed messages — they would be dropped anyway (_paused check)
			for (const timer of _pendingDelayed) clearTimeout(timer);
			_pendingDelayed.clear();
			(_publishCount as any).signal(PAUSE);
			(_version as any).signal(PAUSE);
		},

		resume() {
			if (!_paused) return;
			_paused = false;
			(_publishCount as any).signal(RESUME);
			(_version as any).signal(RESUME);
		},

		get paused() {
			return _paused;
		},

		destroy() {
			if (_destroyed) return;
			_destroyed = true;

			// Cancel delayed messages
			for (const timer of _pendingDelayed) clearTimeout(timer);
			_pendingDelayed.clear();

			// Stop dedup cleanup
			if (_dedupCleanupTimer) clearInterval(_dedupCleanupTimer);
			_dedupMap.clear();

			// Stop compaction
			_compactor?.destroy();

			// Tear down stores
			batch(() => {
				teardown(_publishCount);
				teardown(_version);
				teardown(_latest);
				_log.destroy();
			});

			// Clear groups
			_groups.clear();
		},
	};

	// Attach internal access via symbol
	(topicObj as any)[Symbol.for("callbag-recharge:topic-internal")] = _internal;
	// Attach log reference for subscription to read
	(topicObj as any)[Symbol.for("callbag-recharge:topic-log")] = _log;

	return topicObj;
}
