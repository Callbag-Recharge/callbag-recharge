// ---------------------------------------------------------------------------
// ReactiveLog — Level 3 append-only reactive log
// ---------------------------------------------------------------------------
// An ordered, append-only sequence of entries. Each entry gets a monotonic
// sequence number. Supports bounded size (circular buffer semantics — oldest
// entries are trimmed when maxSize is exceeded).
//
// v2: Real circular buffer for bounded mode. O(1) append instead of O(n)
// splice. Uses a fixed-size array + head/write index for bounded mode;
// unbounded mode still uses plain push.
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

/**
 * Creates an append-only reactive log with optional bounded circular buffer semantics.
 *
 * @param opts - Optional configuration.
 *
 * @returns `ReactiveLog<V>` — a reactive log with the following API:
 *
 * @returnsTable append(value) | (value: V) => number | Append a value. Returns the assigned sequence number.
 * appendMany(values) | (values: V[]) => number[] | Batch append. Returns sequence numbers.
 * get(seq) | (seq: number) => LogEntry<V> \| undefined | Point read by sequence number — O(1).
 * slice(from?, to?) | (from?: number, to?: number) => LogEntry<V>[] | Range read by sequence number (inclusive).
 * toArray() | () => LogEntry<V>[] | Snapshot of all entries.
 * tail(n?) | (n?: number) => Store<LogEntry<V>[]> | Reactive derived store of the last n entries.
 * events | Store<LogEvent<V> \| undefined> | Reactive store of append/trim/clear events.
 * length | number | Current number of entries.
 * clear() | () => void | Remove all entries.
 * destroy() | () => void | Tear down all reactive stores.
 *
 * @optionsType ReactiveLogOptions
 * @option id | string | undefined | User-specified ID. Auto-generated if omitted.
 * @option maxSize | number | 0 | Maximum number of entries. 0 = unlimited. Oldest trimmed on overflow.
 *
 * @remarks **Circular buffer:** When `maxSize > 0`, the log uses a fixed-size circular buffer for O(1) appends. Oldest entries are silently overwritten when the buffer is full.
 * @remarks **Reactive views:** `tail()` returns a derived store that updates whenever the log changes. Multiple calls with the same `n` share the same derived store.
 *
 * @example
 * ```ts
 * import { reactiveLog } from 'callbag-recharge';
 *
 * const log = reactiveLog<string>({ maxSize: 100 });
 * log.append('hello');
 * log.toArray(); // [{ seq: 1, value: 'hello' }]
 * ```
 *
 * @seeAlso [executionLog](./executionLog) — pipeline execution log, [pipeline](./pipeline) — workflow builder
 *
 * @category data
 */
export function reactiveLog<V>(opts?: ReactiveLogOptions): ReactiveLog<V> {
	const counter = ++logCounter;
	const nodeId = opts?.id ?? `rlog-${counter}`;
	const maxSize = opts?.maxSize ?? 0; // 0 = unlimited
	const bounded = maxSize > 0;

	// --- Unbounded storage (plain array) ---
	// --- Bounded storage (circular buffer) ---
	const _entries: LogEntry<V>[] = [];
	let _head = 0; // index of oldest entry in circular buffer (bounded only)
	let _count = 0; // number of entries currently in buffer (bounded only)
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

	/** Materialize current entries as an ordered array (for reactive views) */
	function _toArray(): LogEntry<V>[] {
		if (!bounded) return _entries.slice();
		if (_count === 0) return [];
		const result = new Array<LogEntry<V>>(_count);
		for (let i = 0; i < _count; i++) {
			result[i] = _entries[(_head + i) % maxSize];
		}
		return result;
	}

	function _getByIndex(logicalIndex: number): LogEntry<V> | undefined {
		if (!bounded) return _entries[logicalIndex];
		if (logicalIndex < 0 || logicalIndex >= _count) return undefined;
		return _entries[(_head + logicalIndex) % maxSize];
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
			const entry: LogEntry<V> = { seq, value };

			if (bounded) {
				if (_count < maxSize) {
					// Buffer not full yet — just append
					_entries[(_head + _count) % maxSize] = entry;
					_count++;
				} else {
					// Buffer full — overwrite oldest
					_entries[_head] = entry;
					_head = (_head + 1) % maxSize;
				}
				_headSeq = _seq - _count + 1;
			} else {
				_entries.push(entry);
				_headSeq = _entries.length > 0 ? _entries[0].seq : 1;
			}

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
			if (bounded) {
				if (seq < _headSeq || seq > _seq || _count === 0) return undefined;
				return _getByIndex(seq - _headSeq);
			}
			const idx = seq - _headSeq;
			if (idx < 0 || idx >= _entries.length) return undefined;
			return _entries[idx];
		},

		slice(from?: number, to?: number): LogEntry<V>[] {
			const fromSeq = from ?? _headSeq;
			const toSeq = to ?? _seq;
			const currentLength = bounded ? _count : _entries.length;
			if (currentLength === 0) return [];

			const clampedFrom = Math.max(fromSeq, _headSeq);
			const clampedTo = Math.min(toSeq, _seq);
			if (clampedFrom > clampedTo) return [];

			const startIdx = clampedFrom - _headSeq;
			const endIdx = clampedTo - _headSeq;

			if (!bounded) {
				return _entries.slice(startIdx, endIdx + 1);
			}

			const result: LogEntry<V>[] = [];
			for (let i = startIdx; i <= endIdx; i++) {
				result.push(_entries[(_head + i) % maxSize]);
			}
			return result;
		},

		toArray(): LogEntry<V>[] {
			return _toArray();
		},

		get length() {
			return bounded ? _count : _entries.length;
		},

		get headSeq() {
			return (bounded ? _count : _entries.length) > 0 ? _headSeq : 0;
		},

		get tailSeq() {
			return _seq;
		},

		clear(): void {
			const currentLength = bounded ? _count : _entries.length;
			if (currentLength === 0) return;
			batch(() => {
				if (bounded) {
					_count = 0;
					_head = 0;
				} else {
					_entries.length = 0;
				}
				_headSeq = _seq + 1;
				_version.update((v) => v + 1);
				_events.set({ type: "clear" });
			});
		},

		// --- Reactive ---

		lengthStore: derived([_version], () => (bounded ? _count : _entries.length), {
			name: `${nodeId}:length`,
		}) as Store<number>,

		latest: derived(
			[_version],
			() => {
				const len = bounded ? _count : _entries.length;
				if (len === 0) return undefined;
				if (bounded) return _entries[(_head + _count - 1) % maxSize];
				return _entries[_entries.length - 1];
			},
			{ name: `${nodeId}:latest` },
		) as Store<LogEntry<V> | undefined>,

		tail(n?: number): Store<LogEntry<V>[]> {
			let cached = _tails.get(n);
			if (cached) return cached;
			cached = derived(
				[_version],
				() => {
					const all = _toArray();
					if (n === undefined || n >= all.length) return all;
					return all.slice(-n);
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
				entries: _toArray().map((e) => ({ seq: e.seq, value: e.value })),
				headSeq: (bounded ? _count : _entries.length) > 0 ? _headSeq : 0,
				tailSeq: _seq,
			};
		},

		// --- Lifecycle ---

		destroy(): void {
			if (destroyed) return;
			destroyed = true;
			batch(() => {
				// ECH-4: Tear down leaves (derived stores) before roots (_version, _events)
				for (const t of _tails.values()) teardown(t);
				_tails.clear();
				teardown(log.lengthStore);
				teardown(log.latest);
				teardown(_events);
				teardown(_version);
				// Clear storage after teardowns to avoid spurious emissions
				_entries.length = 0;
				_count = 0;
			});
		},
	};

	return log;
}
