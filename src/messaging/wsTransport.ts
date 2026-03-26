// ---------------------------------------------------------------------------
// wsMessageTransport — WebSocket transport for topic bridge (SA-2b)
// ---------------------------------------------------------------------------
// Browser + Node compatible. Uses native WebSocket (globalThis.WebSocket).
// Node 21+ has native WebSocket; older Node versions need the 'ws' package
// assigned to globalThis.WebSocket before calling this.
// ---------------------------------------------------------------------------

import { teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";
import type { MessageTransport, TransportEnvelope, TransportStatus } from "./transportTypes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WsTransportOpts {
	/** Debug name. */
	name?: string;
	/** Auto-reconnect on disconnect. Default: true. */
	reconnect?: boolean;
	/** Reconnect delay in ms. Default: 1000. Doubles on each attempt up to maxReconnectDelay. */
	reconnectDelay?: number;
	/** Maximum reconnect delay in ms. Default: 30000. */
	maxReconnectDelay?: number;
	/** Maximum reconnect attempts. 0 = unlimited (default). */
	maxReconnectAttempts?: number;
	/** WebSocket protocols (subprotocol negotiation). */
	protocols?: string | string[];
	/** Maximum number of buffered messages while disconnected. Oldest dropped first. 0 = unlimited (default). */
	maxBufferSize?: number;
}

// ---------------------------------------------------------------------------
// wsMessageTransport
// ---------------------------------------------------------------------------

let wsCounter = 0;

/**
 * Create a WebSocket-based message transport for topic bridges.
 *
 * @param url - WebSocket URL (ws:// or wss://).
 * @param opts - Transport options.
 *
 * @returns `MessageTransport` — send/receive envelopes over WebSocket with auto-reconnect.
 *
 * @remarks **Auto-reconnect:** When the connection drops, the transport automatically
 * reconnects with exponential backoff (up to `maxReconnectDelay`). Set `reconnect: false`
 * to disable.
 * @remarks **Browser + Node:** Uses native `WebSocket` from `globalThis`. Node 21+ has
 * native WebSocket support. For older Node, assign the `ws` package to `globalThis.WebSocket`.
 *
 * @category messaging
 */
export function wsMessageTransport(url: string, opts?: WsTransportOpts): MessageTransport {
	const id = ++wsCounter;
	const name = opts?.name ?? `ws-transport-${id}`;
	const shouldReconnect = opts?.reconnect ?? true;
	const baseDelay = opts?.reconnectDelay ?? 1000;
	const maxDelay = opts?.maxReconnectDelay ?? 30_000;
	const maxAttempts = opts?.maxReconnectAttempts ?? 0;
	const protocols = opts?.protocols;
	const maxBufferSize = opts?.maxBufferSize ?? 0;

	const _status = state<TransportStatus>("connecting", { name: `${name}:status` });
	const _handlers = new Set<(envelope: TransportEnvelope) => void>();
	let _ws: WebSocket | null = null;
	let _closed = false;
	let _reconnectAttempts = 0;
	let _reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	// Buffer messages while disconnected/connecting
	let _sendBuffer: string[] = [];

	function _connect(): void {
		if (_closed) return;
		_status.set("connecting");

		try {
			_ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
		} catch {
			_status.set("disconnected");
			_scheduleReconnect();
			return;
		}

		_ws.onopen = () => {
			_reconnectAttempts = 0;
			_status.set("connected");

			// Flush send buffer
			for (const msg of _sendBuffer) {
				_ws!.send(msg);
			}
			_sendBuffer = [];
		};

		_ws.onmessage = (event) => {
			try {
				const envelope = JSON.parse(
					typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data),
				) as TransportEnvelope;
				for (const handler of _handlers) {
					handler(envelope);
				}
			} catch {
				// Ignore malformed messages
			}
		};

		_ws.onclose = () => {
			_ws = null;
			if (!_closed) {
				_status.set("disconnected");
				_scheduleReconnect();
			}
		};

		_ws.onerror = () => {
			// onclose will fire after onerror
		};
	}

	function _scheduleReconnect(): void {
		if (_closed || !shouldReconnect) return;
		if (maxAttempts > 0 && _reconnectAttempts >= maxAttempts) return;

		const delay = Math.min(baseDelay * 2 ** _reconnectAttempts, maxDelay);
		_reconnectAttempts++;
		_reconnectTimer = setTimeout(() => {
			_reconnectTimer = undefined;
			_connect();
		}, delay);
	}

	// --- Start connection ---
	_connect();

	return {
		send(envelope: TransportEnvelope): void {
			if (_closed) return;
			const msg = JSON.stringify(envelope);
			if (_ws && _ws.readyState === WebSocket.OPEN) {
				_ws.send(msg);
			} else {
				// Buffer while not connected — drop oldest if over limit
				_sendBuffer.push(msg);
				if (maxBufferSize > 0 && _sendBuffer.length > maxBufferSize) {
					_sendBuffer.splice(0, _sendBuffer.length - maxBufferSize);
				}
			}
		},

		onMessage(handler: (envelope: TransportEnvelope) => void): () => void {
			_handlers.add(handler);
			return () => {
				_handlers.delete(handler);
			};
		},

		status: _status as Store<TransportStatus>,

		close(): void {
			if (_closed) return;
			_closed = true;

			if (_reconnectTimer) {
				clearTimeout(_reconnectTimer);
				_reconnectTimer = undefined;
			}

			if (_ws) {
				_ws.onclose = null;
				_ws.onerror = null;
				_ws.onmessage = null;
				_ws.close();
				_ws = null;
			}

			_handlers.clear();
			_sendBuffer = [];
			_status.set("disconnected");
			teardown(_status);
		},
	};
}
