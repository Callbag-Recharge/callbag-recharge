// ---------------------------------------------------------------------------
// subscription — cursor-based consumer on a topic
// ---------------------------------------------------------------------------
// Pull-based backpressure: consumer calls pull() to get messages, then ack()
// or nack() each one. Supports subscription modes (exclusive, shared,
// failover, key_shared), cursor persistence, retry with backoff, and dead
// letter routing.
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { effect } from "../core/effect";
import { batch, PAUSE, RESUME, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";
import type { ReactiveLog } from "../data/types";
import { fromAny } from "../extra/fromAny";
import { exponential } from "../utils/backoff";
import type {
	ConsumerGroup,
	MessageMeta,
	SubscriptionMode,
	SubscriptionOptions,
	Topic,
	TopicInternalAccess,
	TopicMessage,
	TopicSubscription,
} from "./types";

const TOPIC_INTERNAL_SYM = Symbol.for("callbag-recharge:topic-internal");
const TOPIC_LOG_SYM = Symbol.for("callbag-recharge:topic-log");

let subCounter = 0;

/** Convert a LogEntry to TopicMessage. */
function toMessage<T>(entry: { seq: number; value: MessageMeta<T> }): TopicMessage<T> {
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
 * Create a cursor-based consumer on a topic.
 *
 * @param topicRef - The topic to consume from.
 * @param opts - Subscription configuration.
 *
 * @returns `TopicSubscription<T>` — pull-based consumption with ack/nack, seeking, and lifecycle.
 *
 * @remarks **Pull-based backpressure:** Consumer controls read pace via `pull(count)`. Messages
 * returned are in-flight until acked. Unacked messages auto-nack after `ackTimeout`.
 * @remarks **Subscription modes:**
 * - `exclusive` (default): Independent cursor. Each subscription reads all messages.
 * - `shared`: Same-name subscriptions share a cursor. Messages dispatched round-robin.
 * - `failover`: Same-name subscriptions share a cursor. Only one active consumer; others standby.
 * - `key_shared`: Same-name subscriptions share a cursor. Messages routed by partition key hash.
 * @remarks **Retry + DLQ (5e-4):** Nacked messages retry with configurable backoff. After
 * `maxRetries`, message routes to `deadLetterTopic` with original headers preserved.
 * @remarks **Cursor persistence:** Pass a `CheckpointAdapter` to persist cursor position.
 *
 * @category messaging
 */
export function subscription<T>(
	topicRef: Topic<T>,
	opts?: SubscriptionOptions<T>,
): TopicSubscription<T> {
	const subId = `sub-${++subCounter}`;
	const subName = opts?.name ?? subId;
	const mode: SubscriptionMode = opts?.mode ?? "exclusive";
	const batchSize = opts?.batchSize ?? 1;
	const ackTimeoutMs = opts?.ackTimeout ?? 30_000;

	// Access topic internals
	const _internal: TopicInternalAccess<T> = (topicRef as any)[TOPIC_INTERNAL_SYM];
	const _log: ReactiveLog<MessageMeta<T>> = (topicRef as any)[TOPIC_LOG_SYM];

	// --- Cursor initialization ---
	let _cursor: number;
	const isGroupMode = mode === "shared" || mode === "failover" || mode === "key_shared";
	let _group: ConsumerGroup | undefined;

	if (isGroupMode) {
		_group = _internal.getOrCreateGroup(subName);
		_group.consumers.add(subId);

		// For new groups, set initial position
		if (_group.consumers.size === 1) {
			_group.cursor = _resolveInitialPosition();
		}
		_cursor = _group.cursor;
	} else {
		_cursor = _resolveInitialPosition();
	}

	function _resolveInitialPosition(): number {
		if (opts?.initialPosition === "earliest") {
			return _log.headSeq > 0 ? _log.headSeq : 1;
		}
		if (typeof opts?.initialPosition === "number") {
			return opts.initialPosition;
		}
		// Default: 'latest' — start after current tail
		return _log.tailSeq + 1;
	}

	// --- In-flight tracking ---
	const _inFlight = new Map<number, { timer: ReturnType<typeof setTimeout> | undefined }>();

	// --- Retry state (5e-4) ---
	// Separate from retry queue so counts survive pull→nack cycles
	const _retryCounts = new Map<number, { attempts: number; prevDelay?: number }>();

	interface RetryEntry {
		seq: number;
		readyAt: number; // timestamp when ready for redelivery
	}
	const _retryQueue: RetryEntry[] = [];
	const _maxRetries = opts?.retry?.maxRetries ?? 3;
	const _backoffStrategy = opts?.retry?.backoff ?? exponential();
	const _deadLetterTopic = opts?.deadLetterTopic;

	// --- State ---
	let _paused = false;
	let _destroyed = false;

	// --- Reactive stores ---
	const _positionStore = state<number>(_cursor, { name: `${subName}:pos` });
	const _pendingStore = state<number>(0, { name: `${subName}:pending` });
	const _backlogStore = derived(
		[_log.lengthStore, _log.events, _positionStore],
		() => {
			const tail = _log.tailSeq;
			const pos = _positionStore.get();
			const head = _log.headSeq;
			// Don't count trimmed messages (pos may point before head after compaction)
			const effectivePos = head > 0 ? Math.max(pos, head) : pos;
			return Math.max(0, tail - effectivePos + 1);
		},
		{ name: `${subName}:backlog` },
	);

	// --- Persistence ---
	const _persistence = opts?.persistence;

	function _persistCursor(): void {
		if (!_persistence) return;
		// Fire and forget
		Promise.resolve(_persistence.save(`${subName}:cursor`, _cursor)).catch(() => {});
	}

	// --- Failover active check ---
	function _isActiveConsumer(): boolean {
		if (mode !== "failover" || !_group) return true;
		// First consumer in the set is active
		const first = _group.consumers.values().next().value;
		return first === subId;
	}

	// --- Key assignment for key_shared ---
	function _hashKey(key: string): number {
		let hash = 0;
		for (let i = 0; i < key.length; i++) {
			hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
		}
		return Math.abs(hash);
	}

	function _isKeyAssignedToMe(key: string | undefined): boolean {
		if (mode !== "key_shared" || !_group) return true;
		if (!key) return true; // unkeyed messages go to any consumer
		const consumers = Array.from(_group.consumers);
		const idx = _hashKey(key) % consumers.length;
		return consumers[idx] === subId;
	}

	// --- Pull ---
	function pull(count?: number): TopicMessage<T>[] {
		if (_paused || _destroyed) return [];

		// Failover: only active consumer can pull
		if (!_isActiveConsumer()) return [];

		const n = count ?? batchSize;
		const messages: TopicMessage<T>[] = [];

		// 1. Check retry queue first (ready entries only)
		const now = Date.now();
		const readyRetries: RetryEntry[] = [];
		const notReady: RetryEntry[] = [];
		for (const entry of _retryQueue) {
			if (entry.readyAt <= now && readyRetries.length < n) {
				readyRetries.push(entry);
			} else {
				notReady.push(entry);
			}
		}
		_retryQueue.length = 0;
		_retryQueue.push(...notReady);

		for (const retry of readyRetries) {
			const logEntry = _log.get(retry.seq);
			if (logEntry) {
				const msg = toMessage(logEntry);
				messages.push(msg);
				_startAckTimer(retry.seq);
			}
		}

		// 2. Read from cursor
		const remaining = n - messages.length;
		let maxCursorSeq = -1; // track highest seq read from cursor (not retries)
		if (remaining > 0) {
			const effectiveCursor = isGroupMode && _group ? _group.cursor : _cursor;
			const tail = _log.tailSeq;
			let read = 0;

			for (let seq = effectiveCursor; seq <= tail && read < remaining; seq++) {
				const logEntry = _log.get(seq);
				if (!logEntry) continue;

				// key_shared: skip messages not assigned to this consumer
				if (mode === "key_shared" && !_isKeyAssignedToMe(logEntry.value.key)) {
					continue;
				}

				// shared: round-robin dispatch — only advance index on actual dispatch
				if (mode === "shared" && _group && _group.consumers.size > 1) {
					const consumers = Array.from(_group.consumers);
					const assignedIdx = _group.roundRobinIndex % consumers.length;
					if (consumers[assignedIdx] !== subId) {
						continue;
					}
					_group.roundRobinIndex++;
				}

				const msg = toMessage(logEntry);
				messages.push(msg);
				_startAckTimer(seq);
				if (seq > maxCursorSeq) maxCursorSeq = seq;
				read++;
			}

			// Advance cursor based only on cursor-read messages (not retries)
			if (maxCursorSeq >= 0) {
				const newCursor = maxCursorSeq + 1;
				if (isGroupMode && _group) {
					_group.cursor = Math.max(_group.cursor, newCursor);
				}
				_cursor = isGroupMode && _group ? _group.cursor : newCursor;
			}
		}

		// Update reactive stores
		if (messages.length > 0) {
			batch(() => {
				_positionStore.set(_cursor);
				_pendingStore.update((v) => v + messages.length);
			});
		}

		return messages;
	}

	// --- Ack timer ---
	function _startAckTimer(seq: number): void {
		let timer: ReturnType<typeof setTimeout> | undefined;
		if (ackTimeoutMs > 0) {
			timer = setTimeout(() => {
				if (_inFlight.has(seq)) {
					nack(seq);
				}
			}, ackTimeoutMs);
		}
		_inFlight.set(seq, { timer });
	}

	// --- Ack ---
	function ack(seq: number): void {
		const entry = _inFlight.get(seq);
		if (!entry) return;
		if (entry.timer) clearTimeout(entry.timer);
		_inFlight.delete(seq);
		_retryCounts.delete(seq);
		_pendingStore.update((v) => Math.max(0, v - 1));
		_persistCursor();
	}

	// --- Route to DLQ helper ---
	function _routeToDLQ(seq: number, retryCount: number): void {
		if (_deadLetterTopic) {
			const logEntry = _log.get(seq);
			if (logEntry) {
				_deadLetterTopic.publish(logEntry.value.value, {
					key: logEntry.value.key,
					headers: {
						...logEntry.value.headers,
						"x-original-topic": topicRef.name,
						"x-retry-count": String(retryCount),
						"x-original-seq": String(seq),
					},
				});
			}
		}
		_retryCounts.delete(seq);
	}

	// --- Nack ---
	function nack(seq: number): void {
		const entry = _inFlight.get(seq);
		if (!entry) return;
		if (entry.timer) clearTimeout(entry.timer);
		_inFlight.delete(seq);
		_pendingStore.update((v) => Math.max(0, v - 1));

		// Get retry state from separate tracking map
		const retryState = _retryCounts.get(seq) ?? { attempts: 0 };
		const nextAttempt = retryState.attempts + 1;

		if (nextAttempt > _maxRetries) {
			// Terminal failure — route to DLQ (5e-4)
			_routeToDLQ(seq, nextAttempt);
			return;
		}

		// Schedule retry with backoff
		const delayMs = _backoffStrategy(nextAttempt - 1, undefined, retryState.prevDelay);
		if (delayMs === null) {
			// Backoff says stop — route to DLQ
			_routeToDLQ(seq, nextAttempt);
			return;
		}

		// Update retry count and schedule redelivery
		_retryCounts.set(seq, { attempts: nextAttempt, prevDelay: delayMs });
		_retryQueue.push({
			seq,
			readyAt: Date.now() + delayMs,
		});
	}

	// --- Seek (5e-3) ---
	function seek(position: number | "earliest" | "latest"): void {
		if (_destroyed) return;
		let newCursor: number;
		if (position === "earliest") {
			newCursor = _log.headSeq > 0 ? _log.headSeq : 1;
		} else if (position === "latest") {
			newCursor = _log.tailSeq + 1;
		} else {
			newCursor = position;
		}

		_cursor = newCursor;
		if (isGroupMode && _group) {
			_group.cursor = newCursor;
		}
		_positionStore.set(newCursor);

		// Clear in-flight on seek (messages from old position are invalid)
		for (const entry of _inFlight.values()) {
			if (entry.timer) clearTimeout(entry.timer);
		}
		_inFlight.clear();
		_pendingStore.set(0);
		_retryQueue.length = 0;
		_retryCounts.clear();

		_persistCursor();
	}

	// --- Persistence: restore cursor (BH-7) ---
	let _loadDispose: (() => void) | undefined;
	let _loadedStore: { source: (type: number, payload?: any) => void } | undefined;
	if (_persistence) {
		const loaded = fromAny(_persistence.load(`${subName}:cursor`));
		_loadedStore = loaded;
		_loadDispose = effect([loaded], () => {
			const val = loaded.get();
			if (typeof val === "number") seek(val);
			return undefined;
		});
	}

	// --- Lifecycle ---
	function destroy(): void {
		if (_destroyed) return;
		_destroyed = true;

		// Cancel persistence load effect and producer
		_loadDispose?.();
		if (_loadedStore) teardown(_loadedStore);

		// Clear ack timers
		for (const entry of _inFlight.values()) {
			if (entry.timer) clearTimeout(entry.timer);
		}
		_inFlight.clear();
		_retryQueue.length = 0;
		_retryCounts.clear();

		// Unregister from group
		if (_group) {
			_group.consumers.delete(subId);
			if (_group.consumers.size === 0) {
				_internal.removeGroup(subName);
			}
		}

		// Tear down stores
		batch(() => {
			teardown(_positionStore);
			teardown(_pendingStore);
			teardown(_backlogStore);
		});
	}

	return {
		get name() {
			return subName;
		},
		get mode() {
			return mode;
		},

		pull,
		ack,
		nack,
		seek,

		position: _positionStore as Store<number>,
		backlog: _backlogStore,
		pending: _pendingStore as Store<number>,

		pause() {
			if (_paused) return;
			_paused = true;
			(_positionStore as any).signal(PAUSE);
			(_pendingStore as any).signal(PAUSE);
		},
		resume() {
			if (!_paused) return;
			_paused = false;
			(_positionStore as any).signal(RESUME);
			(_pendingStore as any).signal(RESUME);
		},
		get isPaused() {
			return _paused;
		},

		destroy,
	};
}
