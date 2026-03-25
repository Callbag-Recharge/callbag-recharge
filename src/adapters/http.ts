// ---------------------------------------------------------------------------
// fromHTTP — HTTP client source (fetch-based)
// ---------------------------------------------------------------------------
// Reactive source that fetches data from an HTTP endpoint. Supports
// one-shot, polling, and custom transforms. Uses withStatus() for
// lifecycle tracking (§20 companion store pattern).
//
// Usage:
//   const data = fromHTTP("https://api.example.com/status", { poll: 5000 });
//   subscribe(data, v => console.log(v));
//   subscribe(data.status, s => console.log(s));
//   data.stop();
// ---------------------------------------------------------------------------

import { producer } from "../core/producer";
import type { LifecycleSignal } from "../core/protocol";
import { batch, PAUSE, RESET, RESUME } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";
import { rawFromAny } from "../raw/fromAny";
import { rawSubscribe } from "../raw/subscribe";
import type { WithStatusStatus } from "../utils/withStatus";
import { withStatus } from "../utils/withStatus";

export interface FromHTTPOptions {
	/** HTTP method. Default: "GET". */
	method?: string;
	/** Request headers. */
	headers?: Record<string, string>;
	/** Request body (for POST/PUT/PATCH). */
	body?: string | object;
	/** Poll interval in ms. Omit or set 0 for one-shot. */
	poll?: number;
	/** Transform the Response before emitting. Default: response.json(). */
	transform?: (response: Response) => unknown | Promise<unknown>;
	/** Debug name for Inspector. */
	name?: string;
	/** AbortSignal for external cancellation. */
	signal?: AbortSignal;
	/** Timeout per request in ms. Default: 30000. */
	timeout?: number;
}

export interface HTTPStore<T = unknown> extends Store<T | undefined> {
	/** Lifecycle status: pending → active → completed/errored. */
	status: Store<WithStatusStatus>;
	/** Last error, if any. */
	error: Store<Error | undefined>;
	/** Number of completed fetches. */
	fetchCount: Store<number>;
	/** Manually trigger a fetch (useful with polling disabled). */
	refetch(): void;
	/** Stop polling and cancel any in-flight request. */
	stop(): void;
}

/**
 * Creates a fetch-based HTTP source. Emits transformed response data as reactive values (Tier 2).
 *
 * @param url - The URL to fetch.
 * @param opts - Optional configuration.
 *
 * @returns `HTTPStore<T>` — reactive store with status, error, fetch count, and manual refetch.
 *
 * @remarks **Tier 2:** Cycle boundary — each fetch result starts a new reactive update cycle.
 * @remarks **Polling:** Set `poll` interval for periodic refetch. Omit for one-shot.
 * @remarks **Transform:** Default extracts JSON. Override with `transform` for text, blob, etc.
 * @remarks **Timeout:** Default 30s per request. Uses AbortController internally.
 * @remarks **Status:** Uses withStatus() for lifecycle tracking (pending → active → completed/errored).
 *
 * @example
 * ```ts
 * import { fromHTTP } from 'callbag-recharge/adapters';
 * import { subscribe } from 'callbag-recharge';
 *
 * const api = fromHTTP("https://api.example.com/status", { poll: 5000 });
 * subscribe(api, data => console.log("status:", data));
 * subscribe(api.status, s => console.log("lifecycle:", s));
 * api.stop();
 * ```
 *
 * @category adapters
 */
export function fromHTTP<T = unknown>(url: string, opts?: FromHTTPOptions): HTTPStore<T> {
	const baseName = opts?.name ?? "http";
	const method = opts?.method ?? "GET";
	const headers = opts?.headers;
	const bodyOpt = opts?.body;
	const pollInterval = opts?.poll ?? 0;
	const transform = opts?.transform ?? ((r: Response) => r.json());
	const requestTimeout = opts?.timeout ?? 30000;

	const fetchCountStore = state<number>(0, { name: `${baseName}:fetchCount` });

	let _emit: ((value: T) => void) | null = null;
	let _error: ((e: unknown) => void) | null = null;
	let _complete: (() => void) | null = null;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let currentAbort: AbortController | null = null;
	let active = false;

	function doFetch() {
		if (!active || !_emit) return;

		currentAbort = new AbortController();
		const signals: AbortSignal[] = [currentAbort.signal];
		if (opts?.signal) signals.push(opts.signal);

		// Combine signals
		const combinedAbort = new AbortController();
		for (const sig of signals) {
			if (sig.aborted) {
				combinedAbort.abort(sig.reason);
				break;
			}
			sig.addEventListener("abort", () => combinedAbort.abort(sig.reason), { once: true });
		}

		// Timeout
		const timeoutId = setTimeout(
			() => combinedAbort.abort(new Error("Request timeout")),
			requestTimeout,
		);

		const body =
			bodyOpt !== undefined
				? typeof bodyOpt === "string"
					? bodyOpt
					: JSON.stringify(bodyOpt)
				: undefined;

		rawSubscribe(
			rawFromAny(
				fetch(url, {
					method,
					headers,
					body,
					signal: combinedAbort.signal,
				}),
			),
			(response: Response) => {
				if (!active) {
					clearTimeout(timeoutId);
					currentAbort = null;
					return;
				}

				if (!response.ok) {
					clearTimeout(timeoutId);
					currentAbort = null;
					_error?.(new Error(`HTTP ${response.status}: ${response.statusText}`));
					return;
				}

				rawSubscribe(
					rawFromAny(transform(response)),
					(data: unknown) => {
						clearTimeout(timeoutId);
						currentAbort = null;
						if (!active) return;

						batch(() => {
							fetchCountStore.update((n) => n + 1);
							_emit?.(data as T);
						});
						schedulePoll();
					},
					{
						onEnd: (err?: unknown) => {
							clearTimeout(timeoutId);
							currentAbort = null;
							if (err !== undefined) {
								if (!active) return;
								if ((err as any)?.name === "AbortError") return;
								_error?.(err);
							}
						},
					},
				);
			},
			{
				onEnd: (err?: unknown) => {
					clearTimeout(timeoutId);
					currentAbort = null;
					if (err !== undefined) {
						if (!active) return;
						if ((err as any)?.name === "AbortError") return;
						_error?.(err);
					}
				},
			},
		);
	}

	function schedulePoll() {
		if (!active || paused || pollInterval <= 0) return;
		pollTimer = setTimeout(() => {
			pollTimer = null;
			doFetch();
		}, pollInterval);
	}

	let _refetch: (() => void) | null = null;
	let paused = false;

	const store = producer<T>(
		({ emit, error, complete, onSignal }) => {
			_emit = emit;
			_error = error;
			_complete = complete;
			active = true;
			paused = false;

			_refetch = () => {
				doFetch();
			};

			onSignal((s: LifecycleSignal) => {
				if (s === PAUSE) {
					paused = true;
					if (pollTimer !== null) {
						clearTimeout(pollTimer);
						pollTimer = null;
					}
				} else if (s === RESUME) {
					paused = false;
					schedulePoll();
				} else if (s === RESET) {
					// Cancel in-flight request and reset fetch count
					currentAbort?.abort();
					currentAbort = null;
					if (pollTimer !== null) {
						clearTimeout(pollTimer);
						pollTimer = null;
					}
					fetchCountStore.set(0);
					paused = false;
					// Re-fetch from scratch (schedulePoll called internally on success)
					doFetch();
				}
				// TEARDOWN is handled by ProducerImpl._handleLifecycleSignal → complete()
			});

			// Initial fetch (schedulePoll called internally on success)
			doFetch();

			return () => {
				active = false;
				paused = false;
				_emit = null;
				_error = null;
				_complete = null;
				_refetch = null;
				currentAbort?.abort();
				currentAbort = null;
				if (pollTimer !== null) {
					clearTimeout(pollTimer);
					pollTimer = null;
				}
			};
		},
		{ name: baseName, kind: "http" },
	);

	// Wrap with withStatus for lifecycle tracking
	const tracked = withStatus(store);

	return {
		get: () => tracked.get() as T | undefined,
		source: (type: number, payload?: any) => tracked.source(type, payload),
		status: tracked.status,
		error: tracked.error,
		fetchCount: fetchCountStore,
		refetch() {
			_refetch?.();
		},
		stop() {
			active = false;
			currentAbort?.abort();
			currentAbort = null;
			if (pollTimer !== null) {
				clearTimeout(pollTimer);
				pollTimer = null;
			}
			// Signal END so withStatus transitions to "completed"
			_complete?.();
		},
	};
}
