// ---------------------------------------------------------------------------
// ReactiveLog — Level 3 append-only reactive log
// ---------------------------------------------------------------------------
// An ordered, append-only sequence of entries. Each entry gets a monotonic
// sequence number. Supports bounded size (circular buffer semantics — oldest
// entries are trimmed when maxSize is exceeded).
//
// Reactive API:
//   - lengthStore: reactive count of entries
//   - entries(n?): reactive store of the last N entries (default: all)
//   - events: keyspace notification store (append/trim/clear)
//   - latest: reactive store of the most recent entry
//
// Non-reactive API:
//   - append(value): add entry, returns sequence number
//   - appendMany(values): batch append
//   - get(seq): point read by sequence number — O(1)
//   - slice(from?, to?): range read by sequence number
//   - toArray(): snapshot of all entries
//   - length: current count
//   - clear(): remove all entries
//   - destroy(): tear down all stores
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";
import type { LogEntry, LogEvent, LogSnapshot, ReactiveLog, ReactiveLogOptions } from "./types";

let logCounter = 0;

/**
 * Restore a reactiveLog from a snapshot. Preserves id; version resets to 0.
 */
reactiveLog.from = function from<V>(
	snap: LogSnapshot<V>,
	opts?: Omit<ReactiveLogOptions, "id">,
): ReactiveLog<V> {
	const log = reactiveLog<V>({ ...opts, id: snap.id });
	for (const entry of snap.entries) log.append(entry.value);
	return log;
};

export function reactiveLog<V>(opts?: ReactiveLogOptions): ReactiveLog<V> {
	const counter = ++logCounter;
	const nodeId = opts?.id ?? `rlog-${counter}`;
	const maxSize = opts?.maxSize ?? 0; // 0 = unlimited

	// Storage — circular buffer via array + head pointer
	const _entries: LogEntry<V>[] = [];
	let _seq = 0; // next sequence number (monotonically increasing)
	let _headSeq = 1; // sequence number of the oldest entry still in the log

	// Version counter — bumped on every structural change (append/trim/clear)
	const _version = state<number>(0, { name: `${nodeId}:ver` });

	// Events — zero cost if unsubscribed
	const _events = state<LogEvent<V> | undefined>(undefined, {
		name: `${nodeId}:events`,
		equals: () => false, // always emit
	});

	// Cached tail() derived stores — keyed by n (undefined = "all")
	const _tails = new Map<number | undefined, Store<LogEntry<V>[]>>();

	let destroyed = false;

	// ---- Internal helpers ----

	function _seqToIndex(seq: number): number | null {
		if (seq < _headSeq || seq > _seq) return null;
		// Because we splice from front when trimming, index = seq - _headSeq
		return seq - _headSeq;
	}

	function _trim(): void {
		if (maxSize <= 0 || _entries.length <= maxSize) return;
		const overflow = _entries.length - maxSize;
		_entries.splice(0, overflow);
		_headSeq = _seq - _entries.length + 1;
	}

	// ---- Public API ----

	const log: ReactiveLog<V> = {
		get id() {
			return nodeId;
		},
		get version() {
			return _version.get();
		},

		append(value: V): number {
			if (destroyed) return -1;
			const seq = ++_seq;
			_entries.push({ seq, value });
			_trim();
			_version.update((v) => v + 1);
			_events.set({ type: "append", seq, value });
			return seq;
		},

		appendMany(values: V[]): number[] {
			if (destroyed || values.length === 0) return [];
			const seqs: number[] = [];
			batch(() => {
				for (const value of values) {
					seqs.push(log.append(value));
				}
			});
			return seqs;
		},

		get(seq: number): LogEntry<V> | undefined {
			const idx = _seqToIndex(seq);
			if (idx === null) return undefined;
			return _entries[idx];
		},

		slice(from?: number, to?: number): LogEntry<V>[] {
			const fromSeq = from ?? _headSeq;
			const toSeq = to ?? _seq;
			const startIdx = _seqToIndex(Math.max(fromSeq, _headSeq));
			const endIdx = _seqToIndex(Math.min(toSeq, _seq));
			if (startIdx === null || endIdx === null) return [];
			return _entries.slice(startIdx, endIdx + 1);
		},

		toArray(): LogEntry<V>[] {
			return _entries.slice();
		},

		get length() {
			return _entries.length;
		},

		get headSeq() {
			return _entries.length > 0 ? _headSeq : 0;
		},

		get tailSeq() {
			return _seq;
		},

		clear(): void {
			if (_entries.length === 0) return;
			batch(() => {
				_entries.length = 0;
				_headSeq = _seq + 1;
				_version.update((v) => v + 1);
				_events.set({ type: "clear" });
			});
		},

		// --- Reactive ---

		lengthStore: derived([_version], () => _entries.length, {
			name: `${nodeId}:length`,
		}) as Store<number>,

		latest: derived(
			[_version],
			() => (_entries.length > 0 ? _entries[_entries.length - 1] : undefined),
			{ name: `${nodeId}:latest` },
		) as Store<LogEntry<V> | undefined>,

		tail(n?: number): Store<LogEntry<V>[]> {
			let cached = _tails.get(n);
			if (cached) return cached;
			cached = derived(
				[_version],
				() => {
					if (n === undefined || n >= _entries.length) return _entries.slice();
					return _entries.slice(-n);
				},
				{ name: `${nodeId}:tail${n ?? ""}` },
			);
			_tails.set(n, cached);
			return cached;
		},

		events: _events as Store<LogEvent<V> | undefined>,

		// --- Serialization ---

		snapshot(): LogSnapshot<V> {
			return {
				type: "reactiveLog",
				id: nodeId,
				version: _version.get(),
				entries: _entries.map((e) => ({ seq: e.seq, value: e.value })),
				headSeq: _entries.length > 0 ? _headSeq : 0,
				tailSeq: _seq,
			};
		},

		// --- Lifecycle ---

		destroy(): void {
			if (destroyed) return;
			destroyed = true;
			_entries.length = 0;
			teardown(_version);
			teardown(_events);
		},
	};

	return log;
}
