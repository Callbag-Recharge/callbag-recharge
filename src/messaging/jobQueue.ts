// ---------------------------------------------------------------------------
// jobQueue — job processing built on topic + subscription (Phase 5e-6 + 5e-7)
// ---------------------------------------------------------------------------
// Wraps a topic (work queue) + subscription (shared consumer) + per-job task
// processing. Each message becomes a job with status tracking. Includes event
// subscriptions and stall detection (5e-7).
//
// Usage:
//   const q = jobQueue<string, number>("emails", async (signal, data) => {
//     await sendEmail(data);
//     return 1;
//   }, { concurrency: 5 });
//   q.add("user@example.com");
//   q.on("completed", (job) => console.log(job.result));
// ---------------------------------------------------------------------------

import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";
import { firstValueFrom } from "../raw/firstValueFrom";
import { fromTimer } from "../raw/fromTimer";
import { exponential } from "../utils/backoff";
import { subscription } from "./subscription";
import { topic } from "./topic";
import type {
	JobEvent,
	JobInfo,
	JobQueue,
	JobQueueOptions,
	JobStatus,
	PublishOptions,
	Topic,
} from "./types";

// ---------------------------------------------------------------------------
// Internal job record
// ---------------------------------------------------------------------------

interface JobRecord<T, R> {
	seq: number;
	data: T;
	status: JobStatus;
	result?: R;
	error?: unknown;
	duration?: number;
	attempts: number;
	startTime?: number;
	/** Per-job abort controller, child of the queue-level controller. */
	abort: AbortController;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a job queue backed by a topic and shared subscription.
 *
 * Each call to `add(data)` publishes a message to the underlying topic.
 * The queue pulls messages, runs them through the processor function with
 * concurrency control, and tracks per-job status. Event listeners fire
 * on completion, failure, and stall detection.
 *
 * @param name - Queue name (used for topic and subscription naming).
 * @param processor - Function called per job. Receives `(signal, data)`. Signal is aborted on stall (if configured) or destroy.
 * @param opts - Queue configuration.
 *
 * @returns `JobQueue<T, R>` — queue with add, event subscription, companion stores, and lifecycle.
 *
 * @category messaging
 */
export function jobQueue<T, R = void>(
	name: string,
	processor: (signal: AbortSignal, data: T) => R | Promise<R>,
	opts?: JobQueueOptions<T>,
): JobQueue<T, R> {
	const concurrency = opts?.concurrency ?? 1;
	const ackTimeoutMs = opts?.ackTimeout ?? 30_000;
	const stallIntervalMs = opts?.stallInterval ?? 5_000;
	const stalledJobAction = opts?.stalledJobAction ?? "none";
	const maxRetries = opts?.retry?.maxRetries ?? 3;
	const backoffStrategy = opts?.retry?.backoff ?? exponential();

	// --- Internal state ---
	// _pausedStore is a reactive store so retry-path code can await unpause
	// via firstValueFrom (push-based, no polling).
	const _pausedStore = state<boolean>(false, { name: `${name}:paused` });
	let _destroyed = false;
	let _processing = 0; // current active job count
	const _queueAbort = new AbortController();
	const _jobs = new Map<number, JobRecord<T, R>>();

	// --- Event listeners ---
	const _listeners: Record<JobEvent, Set<(job: JobInfo<T, R>) => void>> = {
		completed: new Set(),
		failed: new Set(),
		stalled: new Set(),
	};

	// --- Companion stores (5e-7) ---
	const _activeStore = state<number>(0, { name: `${name}:active` });
	const _completedStore = state<number>(0, { name: `${name}:completed` });
	const _failedStore = state<number>(0, { name: `${name}:failed` });
	const _waitingStore = state<number>(0, { name: `${name}:waiting` });

	// --- Underlying topic + subscription ---
	const _topic: Topic<T> = topic<T>(`${name}:jobs`, opts?.topicOptions);
	const _sub = subscription<T>(_topic, {
		name: `${name}:worker`,
		mode: "shared",
		initialPosition: "earliest",
		ackTimeout: 0, // We manage ack timeouts ourselves for stall detection
	});

	// --- Helpers ---

	function _createJobAbort(): AbortController {
		const ac = new AbortController();
		// Chain to queue-level abort: if queue is destroyed, abort all jobs
		_queueAbort.signal.addEventListener("abort", () => ac.abort(), { once: true });
		return ac;
	}

	function _toJobInfo(rec: JobRecord<T, R>): JobInfo<T, R> {
		return {
			seq: rec.seq,
			data: rec.data,
			status: rec.status,
			result: rec.result,
			error: rec.error,
			duration: rec.duration,
			attempts: rec.attempts,
		};
	}

	function _emit(event: JobEvent, rec: JobRecord<T, R>): void {
		const info = _toJobInfo(rec);
		for (const fn of _listeners[event]) {
			try {
				fn(info);
			} catch {
				// Swallow listener errors
			}
		}
	}

	function _updateWaiting(): void {
		if (_destroyed) return;
		_waitingStore.set(Math.max(0, _sub.backlog.get()));
	}

	// --- Job processing (while-loop, no recursion) ---

	async function _processJob(rec: JobRecord<T, R>): Promise<void> {
		while (true) {
			rec.status = "active";
			rec.startTime = Date.now();
			rec.attempts++;
			_processing++;

			batch(() => {
				_activeStore.update((v) => v + 1);
				_updateWaiting();
			});

			try {
				const result = await processor(rec.abort.signal, rec.data);
				if (_destroyed) return;

				rec.status = "completed";
				rec.result = result;
				rec.duration = Date.now() - rec.startTime!;
				_processing--;

				_sub.ack(rec.seq);

				batch(() => {
					_activeStore.update((v) => Math.max(0, v - 1));
					_completedStore.update((v) => v + 1);
					_updateWaiting();
				});

				_emit("completed", rec);
				return;
			} catch (err) {
				if (_destroyed) return;

				rec.duration = Date.now() - rec.startTime!;
				_processing--;

				batch(() => {
					_activeStore.update((v) => Math.max(0, v - 1));
				});

				if (rec.attempts < maxRetries) {
					const delay = backoffStrategy(rec.attempts - 1, err, undefined);
					if (delay === null) {
						_failJob(rec, err);
						return;
					}

					if (delay > 0) {
						await firstValueFrom(fromTimer(delay, rec.abort.signal));
					}

					// Wait for unpause if paused (push-based via _pausedStore, no polling)
					if (_pausedStore.get()) {
						try {
							await firstValueFrom(_pausedStore, (v) => !v);
						} catch {
							// Source ended (destroyed) — bail out
							return;
						}
					}

					if (_destroyed) return;
					// Re-create abort controller for the retry attempt
					rec.abort = _createJobAbort();
					continue; // retry via while loop
				}

				_failJob(rec, err);
				return;
			}
		}
	}

	// Wrapper that handles cleanup around the while loop
	async function _runJob(rec: JobRecord<T, R>): Promise<void> {
		try {
			await _processJob(rec);
		} finally {
			_jobs.delete(rec.seq);
			if (!_destroyed) _tryPull();
		}
	}

	function _failJob(rec: JobRecord<T, R>, err: unknown): void {
		rec.status = "failed";
		rec.error = err;

		// Ack to clear from subscription (jobQueue owns retry, not subscription)
		_sub.ack(rec.seq);

		batch(() => {
			_failedStore.update((v) => v + 1);
			_updateWaiting();
		});

		// Route to DLQ if configured
		if (opts?.deadLetterTopic) {
			try {
				opts.deadLetterTopic.publish(rec.data, {
					headers: {
						"x-original-queue": name,
						"x-retry-count": String(rec.attempts),
						"x-original-seq": String(rec.seq),
					},
				});
			} catch {
				// DLQ publish failure must not prevent "failed" event emission
			}
		}

		_emit("failed", rec);
	}

	// --- Pull loop ---

	function _tryPull(): void {
		if (_pausedStore.get() || _destroyed) return;

		const available = concurrency - _processing;
		if (available <= 0) return;

		const messages = _sub.pull(available);
		if (messages.length === 0) return;

		_updateWaiting();

		for (const msg of messages) {
			const rec: JobRecord<T, R> = {
				seq: msg.seq,
				data: msg.value,
				status: "waiting",
				attempts: 0,
				abort: _createJobAbort(),
			};
			_jobs.set(msg.seq, rec);
			_runJob(rec).catch(() => {
				// Errors handled inside _processJob; swallow unhandled rejections
			});
		}
	}

	// --- Polling for new messages ---
	// We poll because subscription is pull-based; topic publishes may arrive
	// asynchronously. We check on a short interval.
	let _pollTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
		if (!_pausedStore.get() && !_destroyed) {
			_updateWaiting();
			_tryPull();
		}
	}, 100);

	// --- Stall detection (5e-7) ---
	let _stallTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
		if (_destroyed) return;
		const now = Date.now();
		for (const rec of _jobs.values()) {
			if (rec.status === "active" && rec.startTime && now - rec.startTime > ackTimeoutMs) {
				rec.status = "stalled";
				_emit("stalled", rec);

				// Apply stall recovery action
				if (stalledJobAction === "cancel" || stalledJobAction === "retry") {
					// Abort the job's signal — processor should respect this
					rec.abort.abort();
					// The abort will cause the processor Promise to reject (if it
					// checks signal), which flows through the normal catch path.
					// "retry" works because the catch path retries if attempts < maxRetries.
					// "cancel" works because we set attempts to maxRetries so catch falls through to _failJob.
					if (stalledJobAction === "cancel") {
						rec.attempts = maxRetries; // ensure no retry
					}
				}
			}
		}
	}, stallIntervalMs);

	// Initial pull
	_updateWaiting();
	_tryPull();

	// --- Public API ---

	return {
		get name() {
			return name;
		},

		add(data: T, publishOpts?: PublishOptions): number {
			const seq = _topic.publish(data, publishOpts);
			_updateWaiting();
			// Trigger pull on next tick so the message is available
			queueMicrotask(() => _tryPull());
			return seq;
		},

		// Companion stores
		active: _activeStore as Store<number>,
		completed: _completedStore as Store<number>,
		failed: _failedStore as Store<number>,
		waiting: _waitingStore as Store<number>,

		// Events
		on(event: JobEvent, fn: (job: JobInfo<T, R>) => void): () => void {
			_listeners[event].add(fn);
			return () => {
				_listeners[event].delete(fn);
			};
		},

		// Lifecycle
		pause(): void {
			if (_pausedStore.get()) return;
			_pausedStore.set(true);
			_sub.pause();
		},

		resume(): void {
			if (!_pausedStore.get()) return;
			_pausedStore.set(false); // triggers firstValueFrom waiters
			_sub.resume();
			_tryPull();
		},

		get isPaused() {
			return _pausedStore.get();
		},

		destroy(): void {
			if (_destroyed) return;
			_destroyed = true;
			_queueAbort.abort();

			if (_pollTimer) {
				clearInterval(_pollTimer);
				_pollTimer = null;
			}
			if (_stallTimer) {
				clearInterval(_stallTimer);
				_stallTimer = null;
			}

			_sub.destroy();
			_topic.destroy();
			_jobs.clear();

			batch(() => {
				teardown(_pausedStore);
				teardown(_activeStore);
				teardown(_completedStore);
				teardown(_failedStore);
				teardown(_waitingStore);
			});
		},
	};
}
