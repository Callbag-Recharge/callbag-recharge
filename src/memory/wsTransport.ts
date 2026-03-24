// ---------------------------------------------------------------------------
// WebSocket Transport — sends SessionEvents over a WebSocket connection
// ---------------------------------------------------------------------------

import type { SessionEvent, SessionTransport, WsTransportOptions } from "./types";

/**
 * Creates a `SessionTransport` that sends session events over a WebSocket.
 *
 * @param ws - A WebSocket instance (browser-native or compatible).
 * @param opts - Optional configuration.
 *
 * @returns `SessionTransport` — pass to `sessionSync()`.
 *
 * @example
 * ```ts
 * import { wsTransport, sessionSync, collection } from 'callbag-recharge/memory';
 *
 * const ws = new WebSocket('ws://localhost:8080/sessions');
 * const transport = wsTransport(ws);
 * const { dispose } = sessionSync(collection(), transport);
 * ```
 *
 * @category memory
 */
export function wsTransport<T = unknown>(
	ws: WebSocket,
	opts?: WsTransportOptions<T>,
): SessionTransport<T> {
	const serialize = opts?.serialize ?? ((event: SessionEvent<T>) => JSON.stringify(event));

	return {
		send(event: SessionEvent<T>): void {
			try {
				ws.send(serialize(event));
			} catch {
				// Silently drop if WebSocket is not open (matches toWebSocket pattern)
			}
		},
		close(): void {
			try {
				ws.close();
			} catch {
				// Already closed
			}
		},
	};
}
