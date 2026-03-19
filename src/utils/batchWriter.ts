// ---------------------------------------------------------------------------
// Batch Writer — accumulate items and flush on count or time threshold
// ---------------------------------------------------------------------------
// Pure utility with reactive flush notifications. Accumulates items into a
// batch and flushes when:
// - Batch reaches maxSize
// - maxWaitMs elapses since first item in current batch
// - Manual flush() is called
// - stop() is called (flushes remaining)
//
// Provides reactive stores for size, totalFlushed, and flushing state.
// ---------------------------------------------------------------------------

import { state } from "../core/state";
import type { Store } from "../core/types";

export interface BatchWriterOptions<T> {
	/** Flush when batch reaches this size. */
	maxSize: number;
	/** Flush after this many ms since first item in batch. Default: no time limit. */
	maxWaitMs?: number;
	/** Flush handler — called with accumulated items. */
	onFlush: (items: T[]) => void | Promise<void>;
	/** Debug name. */
	name?: string;
}

export interface BatchWriterResult<T> {
	/** Add an item to the batch. May trigger flush. */
	add: (item: T) => void;
	/** Force flush the current batch. */
	flush: () => void;
	/** Current batch size. */
	size: Store<number>;
	/** Total items flushed across all batches. */
	totalFlushed: Store<number>;
	/** Whether a flush is currently in progress (for async onFlush). */
	flushing: Store<boolean>;
	/** Stop the writer and flush remaining items. */
	stop: () => void;
}

/**
 * Creates a batch writer that accumulates items and flushes on size or time threshold.
 *
 * @param opts - Configuration options.
 *
 * @returns `BatchWriterResult<T>` — `add`, `flush`, `size`, `totalFlushed`, `flushing`, `stop`.
 *
 * @example
 * ```ts
 * import { batchWriter } from 'callbag-recharge/utils';
 *
 * const writer = batchWriter({
 *   maxSize: 100,
 *   maxWaitMs: 5000,
 *   onFlush: async (items) => {
 *     await fetch('/api/batch', {
 *       method: 'POST',
 *       body: JSON.stringify(items),
 *     });
 *   },
 * });
 *
 * writer.add({ type: 'event', data: 'click' });
 * writer.size.get(); // 1
 * writer.flush(); // force flush
 * ```
 *
 * @category utils
 */
export function batchWriter<T>(opts: BatchWriterOptions<T>): BatchWriterResult<T> {
	const { maxSize, onFlush } = opts;
	const maxWaitMs = opts.maxWaitMs ?? null;
	const name = opts.name ?? "batchWriter";

	const sizeStore = state<number>(0, { name: `${name}.size` });
	const totalFlushedStore = state<number>(0, { name: `${name}.totalFlushed` });
	const flushingStore = state<boolean>(false, { name: `${name}.flushing` });

	let buffer: T[] = [];
	let waitTimer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;
	let flushing = false; // reentrancy guard
	let pendingFlushCount = 0; // track concurrent async flushes

	function clearWaitTimer(): void {
		if (waitTimer !== null) {
			clearTimeout(waitTimer);
			waitTimer = null;
		}
	}

	function doFlush(): void {
		if (buffer.length === 0 || flushing) return;

		flushing = true;
		const items = buffer;
		buffer = [];
		clearWaitTimer();
		sizeStore.set(0);

		try {
			const result = onFlush(items);

			if (result && typeof result.then === "function") {
				pendingFlushCount++;
				flushingStore.set(true);
				result.then(
					() => {
						totalFlushedStore.update((n) => n + items.length);
						pendingFlushCount--;
						if (pendingFlushCount === 0) flushingStore.set(false);
					},
					() => {
						// Even on error, count items as flushed (they left the buffer)
						totalFlushedStore.update((n) => n + items.length);
						pendingFlushCount--;
						if (pendingFlushCount === 0) flushingStore.set(false);
					},
				);
			} else {
				totalFlushedStore.update((n) => n + items.length);
			}
		} catch {
			// Sync onFlush threw — items are lost but we track them as flushed
			totalFlushedStore.update((n) => n + items.length);
		} finally {
			flushing = false;
		}
	}

	function add(item: T): void {
		if (stopped) return;

		buffer.push(item);
		sizeStore.set(buffer.length);

		// Start wait timer on first item in batch
		if (maxWaitMs !== null && buffer.length === 1) {
			waitTimer = setTimeout(() => {
				waitTimer = null;
				doFlush();
			}, maxWaitMs);
		}

		// Flush on size threshold
		if (buffer.length >= maxSize) {
			doFlush();
		}
	}

	function flush(): void {
		doFlush();
	}

	function stop(): void {
		stopped = true;
		clearWaitTimer();
		doFlush();
	}

	return {
		add,
		flush,
		size: sizeStore,
		totalFlushed: totalFlushedStore,
		flushing: flushingStore,
		stop,
	};
}
