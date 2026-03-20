// ---------------------------------------------------------------------------
// asyncQueue — async task queue with concurrency control
// ---------------------------------------------------------------------------
// Generic task queue that limits concurrent execution. Tasks are enqueued
// and processed according to concurrency and strategy settings.
//
// Use cases: tool call execution, file uploads, API batching, LLM requests
//
// Built on: state
// ---------------------------------------------------------------------------

import { state } from "../core/state";
import type { Store } from "../core/types";

export interface AsyncQueueOptions {
	/** Max concurrent tasks. Default: 1 */
	concurrency?: number;
	/** Queue ordering strategy. Default: 'fifo' */
	strategy?: "fifo" | "lifo";
	/** Debug name. */
	name?: string;
}

export interface AsyncQueueResult<T, R> {
	/** Enqueue a task. Returns a promise that resolves when the task completes. */
	enqueue(task: T): Promise<R>;
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
	/** Clear all pending tasks (rejects their promises). Does not cancel running tasks. */
	clear(): void;
	/** Dispose — clears queue, rejects pending, prevents new enqueues. */
	dispose(): void;
}

interface QueueEntry<T, R> {
	task: T;
	resolve: (result: R) => void;
	reject: (error: unknown) => void;
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
 * const results = await Promise.all([
 *   queue.enqueue('/api/a'),
 *   queue.enqueue('/api/b'),
 *   queue.enqueue('/api/c'),
 *   queue.enqueue('/api/d'), // waits for a slot
 * ]);
 *
 * queue.running.get(); // 0 (all done)
 * queue.completed.get(); // 4
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

	const queue: QueueEntry<T, R>[] = [];
	let activeCount = 0;
	let disposed = false;

	function onTaskDone(entry: QueueEntry<T, R>, result: R): void {
		if (disposed) return;
		activeCount--;
		runningStore.set(activeCount);
		completedStore.update((n) => n + 1);
		entry.resolve(result);
		drain();
	}

	function onTaskError(entry: QueueEntry<T, R>, err: unknown): void {
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

	function enqueue(task: T): Promise<R> {
		if (disposed) {
			return Promise.reject(new Error("Queue is disposed"));
		}

		return new Promise<R>((resolve, reject) => {
			queue.push({ task, resolve, reject });
			sizeStore.set(queue.length);
			drain();
		});
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
