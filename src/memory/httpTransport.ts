// ---------------------------------------------------------------------------
// HTTP Transport — sends SessionEvents via HTTP POST (with optional batching)
// ---------------------------------------------------------------------------

import type { HttpTransportOptions, SessionEvent, SessionTransport } from "./types";

/**
 * Creates a `SessionTransport` that sends session events via HTTP.
 *
 * When `batchMs > 0`, events are collected and sent together in a single
 * request after the batch window elapses. Timer usage here is at a true
 * system boundary (network I/O batching), per architecture §1.18.
 *
 * @param url - The HTTP endpoint to POST events to.
 * @param opts - Optional configuration.
 *
 * @returns `SessionTransport` — pass to `sessionSync()`.
 *
 * @example
 * ```ts
 * import { httpTransport, sessionSync, collection } from 'callbag-recharge/memory';
 *
 * const transport = httpTransport('https://api.example.com/sessions', {
 *   headers: { Authorization: 'Bearer token' },
 *   batchMs: 500,
 * });
 * const { dispose } = sessionSync(collection(), transport);
 * ```
 *
 * @category memory
 */
export function httpTransport<T = unknown>(
	url: string,
	opts?: HttpTransportOptions<T>,
): SessionTransport<T> {
	const method = opts?.method ?? "POST";
	const headers = { "Content-Type": "application/json", ...opts?.headers };
	const batchMs = opts?.batchMs ?? 0;
	const serialize = opts?.serialize ?? ((events: SessionEvent<T>[]) => JSON.stringify(events));

	let closed = false;
	let pendingBatch: SessionEvent<T>[] = [];
	let batchTimer: ReturnType<typeof setTimeout> | null = null;

	function flush(): void {
		if (pendingBatch.length === 0) return;
		const events = pendingBatch;
		pendingBatch = [];
		batchTimer = null;

		const body = serialize(events);
		// Fire-and-forget — transport is a sink, not a request-response bridge.
		// Errors are silently dropped (consistent with toWebSocket pattern).
		fetch(url, { method, headers, body }).catch(() => {});
	}

	return {
		send(event: SessionEvent<T>): void {
			if (closed) return;

			if (batchMs <= 0) {
				// Immediate mode — send single-event array
				const body = serialize([event]);
				fetch(url, { method, headers, body }).catch(() => {});
				return;
			}

			// Batch mode — collect and flush on timer
			pendingBatch.push(event);
			if (!batchTimer) {
				batchTimer = setTimeout(flush, batchMs);
			}
		},
		close(): void {
			closed = true;
			if (batchTimer) {
				clearTimeout(batchTimer);
				batchTimer = null;
			}
			// Flush remaining events on close
			flush();
		},
	};
}
