// ---------------------------------------------------------------------------
// asyncQueue — async task queue with concurrency control
// ---------------------------------------------------------------------------
// Generic task queue that limits concurrent execution. Tasks are enqueued
// and processed according to concurrency and strategy settings.
//
// Use cases: tool call execution, file uploads, API batching, LLM requests
//
// Built on: state (no raw new Promise)
// ---------------------------------------------------------------------------

import { state } from "../core/state";
import type { Store } from "../core/types";
import type { CallbagSource } from "../raw/subscribe";

export interface AsyncQueueOptions {
	/** Max concurrent tasks. Default: 1 */
	concurrency?: number;
	/** Queue ordering strategy. Default: 'fifo' */
	strategy?: "fifo" | "lifo";
	/** Debug name. */
	name?: string;
}

export interface AsyncQueueResult<T, _R> {
	/** Enqueue a task. Returns a callbag source that emits the result then completes. */
	enqueue(task: T): CallbagSource;
	/** Number of tasks waiting in queue. */
	size: Store<number>;
	/** Number of tasks currently executing. */
	running: Store<number>;
	/** Total tasks completed successfully. */
	completed: Store<number>;
	/** Total tasks that failed. */
	failed: Store<number>;
	/** Pause processing (in-flight tasks continue, but no new ones start). */
	pause(): void;
	/** Resume processing. */
	resume(): void;
	/** Whether the queue is paused. */
	paused: Store<boolean>;
	/** Clear all pending tasks (errors their sources). Does not cancel running tasks. */
	clear(): void;
	/** Dispose — clears queue, errors pending, prevents new enqueues. */
	dispose(): void;
}

/** Direct callback — no state/subscribe overhead for one-shot completion. */
interface QueueEntry<T> {
	task: T;
	cancelled: boolean;
	resolve: (result: any) => void;
	reject: (err: unknown) => void;
}

/**
 * Creates an async task queue with concurrency control.
 *
 * @param fn - Worker function that processes each task.
 * @param opts - Optional configuration.
 *
 * @returns `AsyncQueueResult<T, R>` — `enqueue`, `size`, `running`, `completed`, `pause`, `resume`, `paused`, `clear`, `dispose`.
 *
 * @example
 * ```ts
 * import { asyncQueue } from 'callbag-recharge/utils';
 * import { rawSubscribe } from 'callbag-recharge/raw';
 *
 * const queue = asyncQueue(
 *   async (url: string) => {
 *     const res = await fetch(url);
 *     return res.json();
 *   },
 *   { concurrency: 3 },
 * );
 *
 * // Enqueue tasks — at most 3 run concurrently
 * rawSubscribe(queue.enqueue('/api/a'), (result) => console.log(result));
 * rawSubscribe(queue.enqueue('/api/b'), (result) => console.log(result));
 * ```
 *
 * @category utils
 */
export function asyncQueue<T, R>(
	fn: (task: T) => Promise<R>,
	opts?: AsyncQueueOptions,
): AsyncQueueResult<T, R> {
	const concurrency = Math.max(1, opts?.concurrency ?? 1);
	const strategy = opts?.strategy ?? "fifo";
	const name = opts?.name ?? "asyncQueue";

	const sizeStore = state<number>(0, { name: `${name}.size` });
	const runningStore = state<number>(0, { name: `${name}.running` });
	const completedStore = state<number>(0, { name: `${name}.completed` });
	const failedStore = state<number>(0, { name: `${name}.failed` });
	const pausedStore = state<boolean>(false, { name: `${name}.paused` });

	const queue: QueueEntry<T>[] = [];
	let activeCount = 0;
	let disposed = false;

	function onTaskDone(entry: QueueEntry<T>, result: R): void {
		if (disposed) return;
		activeCount--;
		runningStore.set(activeCount);
		completedStore.update((n) => n + 1);
		entry.resolve(result);
		drain();
	}

	function onTaskError(entry: QueueEntry<T>, err: unknown): void {
		if (disposed) return;
		activeCount--;
		runningStore.set(activeCount);
		failedStore.update((n) => n + 1);
		entry.reject(err);
		drain();
	}

	function drain(): void {
		if (disposed || pausedStore.get()) return;

		while (activeCount < concurrency && queue.length > 0) {
			const entry = strategy === "lifo" ? queue.pop()! : queue.shift()!;
			sizeStore.set(queue.length);

			// Skip cancelled entries — consumer already unsubscribed
			if (entry.cancelled) continue;

			activeCount++;
			runningStore.set(activeCount);

			try {
				fn(entry.task).then(
					(result) => onTaskDone(entry, result),
					(err) => onTaskError(entry, err),
				);
			} catch (err) {
				// fn() threw synchronously — treat as rejection
				onTaskError(entry, err);
			}
		}
	}

	function enqueue(task: T): CallbagSource {
		return (type: number, sink?: any) => {
			if (type !== 0) return;

			const entry: QueueEntry<T> = {
				task,
				cancelled: false,
				resolve(result: R) {
					if (entry.cancelled) return;
					sink(1, result);
					if (!entry.cancelled) sink(2);
				},
				reject(err: unknown) {
					if (entry.cancelled) return;
					sink(2, err);
				},
			};

			sink(0, (t: number) => {
				if (t === 2) entry.cancelled = true;
			});

			if (disposed) {
				sink(2, new Error("Queue is disposed"));
				return;
			}

			queue.push(entry);
			sizeStore.set(queue.length);
			drain();
		};
	}

	function pause(): void {
		pausedStore.set(true);
	}

	function resume(): void {
		pausedStore.set(false);
		drain();
	}

	function clear(): void {
		const pending = queue.splice(0, queue.length);
		sizeStore.set(0);
		for (const entry of pending) {
			entry.reject(new Error("Queue cleared"));
		}
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		clear();
	}

	return {
		enqueue,
		size: sizeStore,
		running: runningStore,
		completed: completedStore,
		failed: failedStore,
		pause,
		resume,
		paused: pausedStore,
		clear,
		dispose,
	};
}
