// ---------------------------------------------------------------------------
// fromHTTP — HTTP client source (fetch-based)
// ---------------------------------------------------------------------------
// Reactive source that fetches data from an HTTP endpoint. Supports
// one-shot, polling, and custom transforms.
//
// Usage:
//   const data = fromHTTP("https://api.example.com/status", { poll: 5000 });
//   subscribe(data.store, v => console.log(v));
//   data.stop();
// ---------------------------------------------------------------------------

import { producer } from "../core/producer";
import { state } from "../core/state";
import type { Store } from "../core/types";

export type HTTPStatus = "idle" | "fetching" | "success" | "error";

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

export interface HTTPStore<T = unknown> {
	/** Reactive store emitting fetched values. */
	store: Store<T | undefined>;
	/** Fetch status store. */
	status: Store<HTTPStatus>;
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
 * @returns `HTTPStore<T>` — reactive store with status, fetch count, and manual refetch.
 *
 * @returnsTable store | Store\<T \| undefined\> | Reactive store emitting fetched values.
 * status | Store\<HTTPStatus\> | Fetch status: "idle", "fetching", "success", "error".
 * fetchCount | Store\<number\> | Number of completed fetches.
 * refetch() | () => void | Manually trigger a fetch.
 * stop() | () => void | Stop polling and cancel in-flight request.
 *
 * @remarks **Tier 2:** Cycle boundary — each fetch result starts a new DIRTY+value cycle.
 * @remarks **Polling:** Set `poll` interval for periodic refetch. Omit for one-shot.
 * @remarks **Transform:** Default extracts JSON. Override with `transform` for text, blob, etc.
 * @remarks **Timeout:** Default 30s per request. Uses AbortController internally.
 *
 * @example
 * ```ts
 * import { fromHTTP } from 'callbag-recharge/adapters/http';
 * import { subscribe } from 'callbag-recharge';
 *
 * const api = fromHTTP("https://api.example.com/status", { poll: 5000 });
 * subscribe(api.store, data => console.log("status:", data));
 * // Fetches immediately, then every 5s
 * api.stop();
 * ```
 *
 * @example One-shot POST
 * ```ts
 * const result = fromHTTP("https://api.example.com/submit", {
 *   method: "POST",
 *   headers: { "Content-Type": "application/json" },
 *   body: { name: "test" },
 * });
 * subscribe(result.store, v => console.log(v));
 * ```
 *
 * @seeAlso [fromWebhook](./webhook) — HTTP trigger (server-side), [fromWebSocket](./websocket) — WebSocket source
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

	const statusStore = state<HTTPStatus>("idle", {
		name: `${baseName}:status`,
		equals: () => false,
	});
	const fetchCountStore = state<number>(0, { name: `${baseName}:fetchCount` });

	let _emit: ((value: T) => void) | null = null;
	let _error: ((e: unknown) => void) | null = null;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let currentAbort: AbortController | null = null;
	let active = false;

	async function doFetch() {
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

		try {
			statusStore.set("fetching");

			const body =
				bodyOpt !== undefined
					? typeof bodyOpt === "string"
						? bodyOpt
						: JSON.stringify(bodyOpt)
					: undefined;

			const response = await fetch(url, {
				method,
				headers,
				body,
				signal: combinedAbort.signal,
			});

			if (!active) return;

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const data = (await transform(response)) as T;

			if (!active) return;

			fetchCountStore.update((n) => n + 1);
			statusStore.set("success");
			_emit(data);
		} catch (err: any) {
			if (!active) return;
			if (err?.name === "AbortError") return; // Cancelled
			statusStore.set("error");
			_error?.(err);
		} finally {
			clearTimeout(timeoutId);
			currentAbort = null;
		}
	}

	function schedulePoll() {
		if (!active || pollInterval <= 0) return;
		pollTimer = setTimeout(() => {
			pollTimer = null;
			doFetch()
				.then(() => {
					if (active) schedulePoll();
				})
				.catch(() => {
					// Already handled internally
				});
		}, pollInterval);
	}

	let _refetch: (() => void) | null = null;

	const store = producer<T>(
		({ emit, error }) => {
			_emit = emit;
			_error = error;
			active = true;

			_refetch = () => {
				doFetch();
			};

			// Initial fetch
			doFetch().then(() => {
				if (active) schedulePoll();
			});

			return () => {
				active = false;
				_emit = null;
				_error = null;
				_refetch = null;
				currentAbort?.abort();
				currentAbort = null;
				if (pollTimer !== null) {
					clearTimeout(pollTimer);
					pollTimer = null;
				}
				// Don't overwrite error/success status on teardown
				const currentStatus = statusStore.get();
				if (currentStatus !== "error" && currentStatus !== "success") {
					statusStore.set("idle");
				}
			};
		},
		{ name: baseName, kind: "http" },
	);

	return {
		store,
		status: statusStore,
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
			// Reset fetching status to idle on explicit stop
			if (statusStore.get() === "fetching") {
				statusStore.set("idle");
			}
		},
	};
}
