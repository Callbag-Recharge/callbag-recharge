// ---------------------------------------------------------------------------
// jobQueue — job processing built on topic + subscription (SA-3)
// ---------------------------------------------------------------------------
// Wraps a topic (work queue) + subscription (shared consumer) + per-job task
// processing. Each message becomes a job with status tracking. Includes event
// subscriptions, stall detection, progress reporting, priority ordering,
// scheduled jobs, batch add, introspection, rate limiting, persistence,
// and distributed job support via topicBridge.
//
// Usage:
//   const q = jobQueue<string, number>("emails", async (signal, data, progress) => {
//     progress(0.5);
//     await sendEmail(data);
//     progress(1);
//     return 1;
//   }, { concurrency: 5 });
//   q.add("user@example.com");
//   q.on("completed", (job) => console.log(job.result));
// ---------------------------------------------------------------------------

import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";
import { interval } from "../extra/interval";
import { rawFromAny } from "../raw/fromAny";
import { fromTimer } from "../raw/fromTimer";
import { rawSubscribe } from "../raw/subscribe";
import { exponential } from "../utils/backoff";
import type { RateLimiter } from "../utils/rateLimiter";
import { slidingWindow } from "../utils/rateLimiter";
import { subscription } from "./subscription";
import { topic } from "./topic";
import type {
	AddJobOptions,
	JobEvent,
	JobInfo,
	JobQueue,
	JobQueueOptions,
	JobStatus,
	Topic,
	TopicMessage,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of finished jobs retained for introspection (Fix B). */
const MAX_FINISHED_JOBS = 10_000;

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
	progress: number;
	startTime?: number;
	/** Scheduled execution time (ms since epoch). */
	runAt?: number;
	/** Per-job abort controller, child of the queue-level controller. */
	abort: AbortController;
	/** Set to true when removed via remove() — guards against double-decrement (Fix 2). */
	removed?: boolean;
}

/** Persisted representation used by jobQueue persistence recovery. */
interface PersistedJobRecord<T, R> {
	seq: number;
	data: T;
	status: JobStatus;
	result?: R;
	error?: unknown;
	duration?: number;
	attempts: number;
	progress?: number;
	runAt?: number;
}

// ---------------------------------------------------------------------------
// Persistence key helpers
// ---------------------------------------------------------------------------

function _jobKey(queueName: string, seq: number): string {
	return `jobQueue:${queueName}:job:${seq}`;
}

function _indexKey(queueName: string): string {
	return `jobQueue:${queueName}:index`;
}

/** Dummy AbortController for recovered finished jobs (Fix F). */
const _dummyAbort = new AbortController();

/**
 * Fire-and-forget persistence side effects.
 * Persistence adapters may return a callbag source (async); we must subscribe
 * so the adapter actually performs the save/load/clear operation.
 */
function _safePersist(result: undefined | ((type: number, payload?: any) => void) | unknown): void {
	if (typeof result === "function") {
		rawSubscribe(result as any, () => {});
	}
}

/**
 * Load a value from a checkpoint adapter, supporting both sync return values
 * and async callbag sources.
 */
function _loadMaybe<T>(
	loaded: T | undefined | ((type: number, payload?: any) => void) | unknown,
	onValue: (v: T | undefined) => void,
): void {
	if (typeof loaded === "function") {
		rawSubscribe(loaded as any, (v: T) => onValue(v));
		return;
	}
	onValue(loaded as T | undefined);
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
 * @param processor - Function called per job. Receives `(signal, data, progress)`. Signal is aborted on stall (if configured) or destroy. Progress is a callback accepting 0-1 values.
 * @param opts - Queue configuration.
 *
 * @returns `JobQueue<T, R>` — queue with add, event subscription, companion stores, and lifecycle.
 *
 * @category messaging
 */
export function jobQueue<T, R = void>(
	name: string,
	processor: (signal: AbortSignal, data: T, progress: (value: number) => void) => R | Promise<R>,
	opts?: JobQueueOptions<T>,
): JobQueue<T, R> {
	const concurrency = opts?.concurrency ?? 1;
	const ackTimeoutMs = opts?.ackTimeout ?? 30_000;
	const stallIntervalMs = opts?.stallInterval ?? 5_000;
	const stalledJobAction = opts?.stalledJobAction ?? "none";
	// Fix 4: maxRetries means N retries on top of the initial attempt.
	// Total attempts = 1 (initial) + maxRetries.
	const maxRetries = opts?.retry?.maxRetries ?? 3;
	const backoffStrategy = opts?.retry?.backoff ?? exponential();
	const _persistence = opts?.persistence;

	// --- Rate limiter (SA-3f) ---
	let _rateLimiter: RateLimiter | undefined;
	if (opts?.rateLimit) {
		_rateLimiter = slidingWindow({
			max: opts.rateLimit.max,
			windowMs: opts.rateLimit.windowMs,
		});
	}

	// --- Internal state ---
	// _pausedStore is a reactive store so retry-path code can await unpause
	// via firstValueFrom (push-based, no polling).
	const _pausedStore = state<boolean>(false, { name: `${name}:paused` });
	let _destroyed = false;
	let _processing = 0; // current active job count
	const _queueAbort = new AbortController();
	const _jobs = new Map<number, JobRecord<T, R>>();
	// Track completed/failed jobs for introspection (SA-3d)
	const _finishedJobs = new Map<number, JobRecord<T, R>>();
	// FIFO eviction order for _finishedJobs (Fix B)
	const _finishedOrder: number[] = [];
	// Rate-limited jobs waiting for a token (SA-3f)
	const _rateLimitQueue: JobRecord<T, R>[] = [];
	// Deferred jobs waiting for concurrency slot (Fix 1)
	const _deferredQueue: JobRecord<T, R>[] = [];

	// --- Event listeners ---
	const _listeners: Record<JobEvent, Set<(job: JobInfo<T, R>) => void>> = {
		completed: new Set(),
		failed: new Set(),
		stalled: new Set(),
		progress: new Set(),
	};

	// --- Companion stores (5e-7) ---
	const _activeStore = state<number>(0, { name: `${name}:active` });
	const _completedStore = state<number>(0, { name: `${name}:completed` });
	const _failedStore = state<number>(0, { name: `${name}:failed` });
	const _waitingStore = state<number>(0, { name: `${name}:waiting` });
	const _progressStore = state<number>(0, { name: `${name}:progress` });

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
			progress: rec.progress,
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

	/** Recalculate aggregate progress across active jobs. */
	function _updateProgress(): void {
		if (_destroyed) return;
		let total = 0;
		let count = 0;
		for (const rec of _jobs.values()) {
			if (rec.status === "active") {
				total += rec.progress;
				count++;
			}
		}
		_progressStore.set(count > 0 ? total / count : 0);
	}

	/** Persist a job record (SA-3h). Does NOT rebuild the index — call _persistIndex() separately. */
	function _persistJob(rec: JobRecord<T, R>): void {
		if (!_persistence) return;
		const data = {
			seq: rec.seq,
			data: rec.data,
			status: rec.status,
			result: rec.result,
			error: rec.error,
			duration: rec.duration,
			attempts: rec.attempts,
			progress: rec.progress,
			runAt: rec.runAt,
		};
		_safePersist(_persistence.save(_jobKey(name, rec.seq), data));
	}

	/** Rebuild and persist the index (Fix C: only called on add/remove, not progress). */
	function _persistIndex(): void {
		if (!_persistence) return;
		const allSeqs = new Set<number>();
		for (const s of _jobs.keys()) allSeqs.add(s);
		for (const s of _finishedJobs.keys()) allSeqs.add(s);
		_safePersist(_persistence.save(_indexKey(name), Array.from(allSeqs)));
	}

	/** Remove persisted job and update the index (Fix E). */
	function _unpersistJob(seq: number): void {
		if (!_persistence) return;
		_safePersist(_persistence.clear(_jobKey(name, seq)));
		_persistIndex();
	}

	/** Add a record to _finishedJobs with FIFO eviction (Fix B). */
	function _addFinished(rec: JobRecord<T, R>): void {
		_finishedJobs.set(rec.seq, rec);
		_finishedOrder.push(rec.seq);
		while (_finishedJobs.size > MAX_FINISHED_JOBS) {
			const oldest = _finishedOrder.shift();
			if (oldest !== undefined) {
				_finishedJobs.delete(oldest);
				// Also remove from persistence
				if (_persistence) _safePersist(_persistence.clear(_jobKey(name, oldest)));
			}
		}
	}

	// --- Deferred queue drain (Fix 1) ---
	// When a job finishes and a slot opens, drain deferred (scheduled/rate-limited) jobs first.
	function _drainDeferred(): void {
		while (_deferredQueue.length > 0 && _processing < concurrency) {
			const rec = _deferredQueue.shift()!;
			if (rec.removed || _destroyed) continue;
			// Check pause (Fix G)
			if (_pausedStore.get()) {
				_deferredQueue.unshift(rec);
				return;
			}
			_processJob(rec);
		}
	}

	// --- Job processing (recursive continuation, no async/await) ---

	function _processJob(rec: JobRecord<T, R>): void {
		if (_destroyed || rec.removed) {
			_finishJob(rec);
			return;
		}

		// Fix 1: Concurrency check — defer if at capacity
		if (_processing >= concurrency) {
			_deferredQueue.push(rec);
			return;
		}

		// Rate limiting (SA-3f): check before starting
		if (_rateLimiter && !_rateLimiter.tryAcquire()) {
			// Queue for later — wait for a token via callbag acquire()
			_rateLimitQueue.push(rec);
			rawSubscribe(
				_rateLimiter.acquire(rec.abort.signal),
				() => {
					// Token acquired — remove from wait queue and process
					const idx = _rateLimitQueue.indexOf(rec);
					if (idx >= 0) _rateLimitQueue.splice(idx, 1);
					if (_destroyed || rec.removed) {
						_finishJob(rec);
						return;
					}
					// Fix 1: Re-check concurrency after wait
					if (_processing >= concurrency) {
						_deferredQueue.push(rec);
						return;
					}
					// Fix G: Check pause
					if (_pausedStore.get()) {
						_deferredQueue.push(rec);
						return;
					}
					_startJob(rec);
				},
				{
					onEnd: (err?: unknown) => {
						if (err !== undefined) {
							// Aborted while waiting for rate limit token
							const idx = _rateLimitQueue.indexOf(rec);
							if (idx >= 0) _rateLimitQueue.splice(idx, 1);
							_finishJob(rec);
						}
					},
				},
			);
			return;
		}

		_startJob(rec);
	}

	function _startJob(rec: JobRecord<T, R>): void {
		if (rec.removed) return; // Fix 2: guard

		rec.status = "active";
		rec.startTime = Date.now();
		rec.attempts++;
		rec.progress = 0;
		_processing++;

		batch(() => {
			_activeStore.update((v) => v + 1);
			_updateWaiting();
		});

		_persistJob(rec);

		// Progress callback (SA-3a)
		const progressFn = (value: number): void => {
			if (_destroyed || rec.removed) return;
			rec.progress = Math.max(0, Math.min(1, value));
			_updateProgress();
			_emit("progress", rec);
			// Fix C: Only persist job data, not the index
			_persistJob(rec);
		};

		rawSubscribe(
			rawFromAny(processor(rec.abort.signal, rec.data, progressFn)),
			(result: R) => {
				// Fix 2: Guard against removed jobs
				if (rec.removed) return;
				if (_destroyed) {
					_finishJob(rec);
					return;
				}

				rec.status = "completed";
				rec.result = result;
				rec.progress = 1;
				rec.duration = Date.now() - rec.startTime!;
				_processing--;

				_sub.ack(rec.seq);

				batch(() => {
					_activeStore.update((v) => Math.max(0, v - 1));
					_completedStore.update((v) => v + 1);
					_updateWaiting();
					_updateProgress();
				});

				// Move to finished for introspection
				_addFinished(rec);
				_persistJob(rec);
				_persistIndex();
				_emit("completed", rec);
				_finishJob(rec);
			},
			{
				onEnd: (err?: unknown) => {
					if (err === undefined) return; // success — handled in DATA callback
					// Fix 2: Guard against removed jobs
					if (rec.removed) return;
					if (_destroyed) {
						_finishJob(rec);
						return;
					}

					rec.duration = Date.now() - rec.startTime!;
					_processing--;

					batch(() => {
						_activeStore.update((v) => Math.max(0, v - 1));
						_updateProgress();
					});

					// Fix 4: maxRetries means N retries, total attempts = 1 + maxRetries
					if (rec.attempts <= maxRetries) {
						const delay = backoffStrategy(rec.attempts - 1, err, undefined);
						if (delay === null) {
							_failJob(rec, err);
							_finishJob(rec);
							return;
						}

						const retryAfterDelay = () => {
							if (rec.removed) return; // Fix 2
							// Wait for unpause if paused (push-based via _pausedStore, no polling)
							if (_pausedStore.get()) {
								const unsub = subscribe(_pausedStore, (v) => {
									if (v) return; // still paused
									unsub.unsubscribe();
									if (_destroyed || rec.removed) {
										_finishJob(rec);
										return;
									}
									rec.abort = _createJobAbort();
									_processJob(rec); // retry
								});
								return;
							}

							if (_destroyed) {
								_finishJob(rec);
								return;
							}
							// Re-create abort controller for the retry attempt
							rec.abort = _createJobAbort();
							_processJob(rec); // retry
						};

						if (delay > 0) {
							rawSubscribe(
								fromTimer(delay, rec.abort.signal),
								() => {
									retryAfterDelay();
								},
								{
									onEnd: (timerErr?: unknown) => {
										if (timerErr !== undefined) {
											// Timer aborted (job cancelled) — bail out
											_finishJob(rec);
										}
									},
								},
							);
						} else {
							retryAfterDelay();
						}
						return;
					}

					_failJob(rec, err);
					_finishJob(rec);
				},
			},
		);
	}

	function _finishJob(rec: JobRecord<T, R>): void {
		_jobs.delete(rec.seq);
		if (!_destroyed) {
			_drainDeferred();
			_tryPull();
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
			_updateProgress();
		});

		// Move to finished for introspection
		_addFinished(rec);
		_persistJob(rec);
		_persistIndex();

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

	let _pulling = false;

	function _tryPull(): void {
		if (_pulling) return;
		if (_pausedStore.get() || _destroyed) return;

		_pulling = true;
		try {
			const maxRounds = Math.max(10, concurrency * 10);
			let rounds = 0;

			while (rounds < maxRounds) {
				if (_pausedStore.get() || _destroyed) return;

				const available = concurrency - _processing;
				if (available <= 0) return;

				const messages = _sub.pull(available);
				if (messages.length === 0) return;

				_updateWaiting();

				// SA-3b: Sort by priority (lower number = higher priority)
				if (messages.length > 1) {
					messages.sort((a: TopicMessage<T>, b: TopicMessage<T>) => {
						const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
						const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
						return pa - pb;
					});
				}

				for (const msg of messages) {
					const rec: JobRecord<T, R> = {
						seq: msg.seq,
						data: msg.value,
						status: "waiting",
						attempts: 0,
						progress: 0,
						abort: _createJobAbort(),
					};
					_jobs.set(msg.seq, rec);

					// SA-3c: Check for scheduled execution via header
					const runAtHeader = msg.headers?.["x-run-at"];
					if (runAtHeader) {
						const runAtMs = Number(runAtHeader);
						const delay = runAtMs - Date.now();
						if (delay > 0) {
							rec.status = "scheduled";
							rec.runAt = runAtMs;
							_persistJob(rec);
							_persistIndex();
							rawSubscribe(
								fromTimer(delay, rec.abort.signal),
								() => {
									if (_destroyed || rec.removed) {
										_finishJob(rec);
										return;
									}
									// Fix G: Check pause
									if (_pausedStore.get()) {
										_deferredQueue.push(rec);
										return;
									}
									// Fix 1: Concurrency check via _processJob
									_processJob(rec);
								},
								{
									onEnd: (err?: unknown) => {
										if (err !== undefined) {
											_finishJob(rec);
										}
									},
								},
							);
							continue;
						}
					}

					_processJob(rec);
				}

				rounds++;
			}
		} finally {
			_pulling = false;
		}
	}

	// --- Push-based pull trigger ---
	// React to topic depth changes instead of polling. When a message is
	// published, the topic's depth store updates, triggering a pull.
	const _depthSub = subscribe(_topic.depth, () => {
		if (!_pausedStore.get() && !_destroyed) {
			_updateWaiting();
			_tryPull();
		}
	});

	// --- Stall detection (5e-7) ---
	const _stallTick$ = interval(stallIntervalMs);
	const _stallSub = subscribe(_stallTick$, () => {
		if (_destroyed) return;
		const now = Date.now();
		for (const rec of _jobs.values()) {
			if (rec.status === "active" && rec.startTime && now - rec.startTime > ackTimeoutMs) {
				// Fix 3: For "none", keep status as "active" so stall events re-fire
				// as a heartbeat. Only change status for "cancel"/"retry".
				if (stalledJobAction === "cancel" || stalledJobAction === "retry") {
					rec.status = "stalled";
				}
				_emit("stalled", rec);

				// Apply stall recovery action
				if (stalledJobAction === "cancel" || stalledJobAction === "retry") {
					// Abort the job's signal — processor should respect this
					rec.abort.abort();
					// The abort will cause the processor Promise to reject (if it
					// checks signal), which flows through the normal catch path.
					// "retry" works because the catch path retries if attempts <= maxRetries.
					// "cancel" works because we set attempts past maxRetries so catch falls through to _failJob.
					if (stalledJobAction === "cancel") {
						rec.attempts = maxRetries + 1; // ensure no retry (Fix 4: aligned)
					}
				}
			}
		}
	});

	// --- Persistence recovery (SA-3h) ---
	if (_persistence) {
		_loadMaybe<number[]>(_persistence.load(_indexKey(name)), (indexRaw) => {
			if (!Array.isArray(indexRaw)) return;
			for (const seq of indexRaw) {
				_loadMaybe<PersistedJobRecord<T, R>>(_persistence.load(_jobKey(name, seq)), (jobData) => {
					if (!jobData) return;
					// Only recover non-terminal jobs
					if (jobData.status === "completed" || jobData.status === "failed") {
						// Store in finished for introspection (Fix F: use dummy abort)
						const finishedRec: JobRecord<T, R> = {
							seq: jobData.seq,
							data: jobData.data,
							status: jobData.status,
							result: jobData.result,
							error: jobData.error,
							duration: jobData.duration,
							attempts: jobData.attempts,
							progress: jobData.progress ?? 0,
							abort: _dummyAbort,
						};
						_addFinished(finishedRec);
					}
					// Active/waiting/scheduled jobs will be re-pulled from the topic
				});
			}
		});
	}

	// Initial pull
	_updateWaiting();
	_tryPull();

	// --- Public API ---

	return {
		get name() {
			return name;
		},

		// Fix A: Removed queueMicrotask — _depthSub already triggers _tryPull reactively
		add(data: T, addOpts?: AddJobOptions): number {
			// SA-3c: Scheduled jobs via runAt
			const headers = { ...addOpts?.headers };
			if (addOpts?.runAt) {
				headers["x-run-at"] = String(addOpts.runAt.getTime());
			}
			const seq = _topic.publish(data, { ...addOpts, headers });
			_updateWaiting();
			return seq;
		},

		// SA-3e: Batch add (Fix A: no queueMicrotask)
		addBatch(items: T[], addOpts?: AddJobOptions): number[] {
			const seqs: number[] = [];
			batch(() => {
				for (const item of items) {
					const headers = { ...addOpts?.headers };
					if (addOpts?.runAt) {
						headers["x-run-at"] = String(addOpts.runAt.getTime());
					}
					seqs.push(_topic.publish(item, { ...addOpts, headers }));
				}
			});
			_updateWaiting();
			return seqs;
		},

		// SA-3d: Introspection
		getJob(seq: number): JobInfo<T, R> | undefined {
			const rec = _jobs.get(seq) ?? _finishedJobs.get(seq);
			return rec ? _toJobInfo(rec) : undefined;
		},

		remove(seq: number): boolean {
			const rec = _jobs.get(seq);
			if (!rec) return false;

			const wasActive = rec.status === "active";

			// Fix 2: Mark as removed to guard in-flight callbacks
			rec.removed = true;

			// Abort the job
			rec.abort.abort();
			rec.status = "failed";
			rec.error = new Error("Job removed");
			_sub.ack(rec.seq);

			if (wasActive) {
				_processing--;
				batch(() => {
					_activeStore.update((v) => Math.max(0, v - 1));
					_updateProgress();
				});
			}

			// Fix D: Update failed store, waiting, and emit event
			batch(() => {
				_failedStore.update((v) => v + 1);
				_updateWaiting();
			});
			_emit("failed", rec);

			_jobs.delete(seq);
			_unpersistJob(seq);

			// Remove from rate limit queue if queued
			const rlIdx = _rateLimitQueue.indexOf(rec);
			if (rlIdx >= 0) _rateLimitQueue.splice(rlIdx, 1);

			return true;
		},

		// Companion stores
		active: _activeStore as Store<number>,
		completed: _completedStore as Store<number>,
		failed: _failedStore as Store<number>,
		waiting: _waitingStore as Store<number>,
		progress: _progressStore as Store<number>,

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
			_drainDeferred();
			_tryPull();
		},

		get isPaused() {
			return _pausedStore.get();
		},

		// SA-3g: Expose internal topic for bridging
		get inner() {
			return { topic: _topic };
		},

		destroy(): void {
			if (_destroyed) return;
			_destroyed = true;
			_queueAbort.abort();

			_depthSub.unsubscribe();
			_stallSub.unsubscribe();

			_sub.destroy();
			_topic.destroy();
			_jobs.clear();
			_finishedJobs.clear();
			_finishedOrder.length = 0;
			_rateLimitQueue.length = 0;
			_deferredQueue.length = 0;

			batch(() => {
				teardown(_pausedStore);
				teardown(_activeStore);
				teardown(_completedStore);
				teardown(_failedStore);
				teardown(_waitingStore);
				teardown(_progressStore);
			});
		},
	};
}
