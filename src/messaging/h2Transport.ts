// ---------------------------------------------------------------------------
// h2MessageTransport — HTTP/2 bidirectional stream transport (SA-2c)
// ---------------------------------------------------------------------------
// Node-only. Uses the node:http2 module for bidirectional streaming.
// Client connects to an HTTP/2 server and opens a bidirectional stream.
// Both sides send newline-delimited JSON envelopes over the stream.
// ---------------------------------------------------------------------------

import { teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";
import type { MessageTransport, TransportEnvelope, TransportStatus } from "./transportTypes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface H2TransportOpts {
	/** Debug name. */
	name?: string;
	/** Auto-reconnect on disconnect. Default: true. */
	reconnect?: boolean;
	/** Reconnect delay in ms. Default: 1000. */
	reconnectDelay?: number;
	/** Maximum reconnect delay in ms. Default: 30000. */
	maxReconnectDelay?: number;
	/** Maximum reconnect attempts. 0 = unlimited (default). */
	maxReconnectAttempts?: number;
	/** Path for the bidirectional stream. Default: '/bridge'. */
	path?: string;
	/** Additional HTTP/2 session options. */
	sessionOpts?: Record<string, unknown>;
	/** Maximum number of buffered messages while disconnected. Oldest dropped first. 0 = unlimited (default). */
	maxBufferSize?: number;
}

// ---------------------------------------------------------------------------
// h2MessageTransport (client-side)
// ---------------------------------------------------------------------------

let h2Counter = 0;

/**
 * Create an HTTP/2 bidirectional stream transport for topic bridges (Node only).
 *
 * @param authority - HTTP/2 authority URL (e.g. 'https://localhost:8443').
 * @param opts - Transport options.
 *
 * @returns `MessageTransport` — send/receive envelopes over HTTP/2 bidirectional stream.
 *
 * @remarks **Node only.** Uses `node:http2` module. Not available in browsers.
 * @remarks **Newline-delimited JSON:** Each envelope is sent as a single JSON line
 * terminated by `\n`. Incoming data is buffered and split on newlines.
 * @remarks **Auto-reconnect:** Reconnects with exponential backoff on connection loss.
 *
 * @category messaging
 */
export function h2MessageTransport(authority: string, opts?: H2TransportOpts): MessageTransport {
	const id = ++h2Counter;
	const name = opts?.name ?? `h2-transport-${id}`;
	const shouldReconnect = opts?.reconnect ?? true;
	const baseDelay = opts?.reconnectDelay ?? 1000;
	const maxDelay = opts?.maxReconnectDelay ?? 30_000;
	const maxAttempts = opts?.maxReconnectAttempts ?? 0;
	const streamPath = opts?.path ?? "/bridge";
	const maxBufferSize = opts?.maxBufferSize ?? 0;

	const _status = state<TransportStatus>("connecting", { name: `${name}:status` });
	const _handlers = new Set<(envelope: TransportEnvelope) => void>();
	let _session: any = null; // http2.ClientHttp2Session
	let _stream: any = null; // http2.ClientHttp2Stream
	let _closed = false;
	let _reconnectAttempts = 0;
	let _reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let _sendBuffer: string[] = [];
	let _incomingBuffer = "";

	async function _connect(): Promise<void> {
		if (_closed) return;
		_status.set("connecting");

		try {
			// Dynamic import of node:http2 — fails gracefully in non-Node environments
			const http2 = await import("node:http2");

			_session = http2.connect(authority, opts?.sessionOpts as any);

			_session.on("error", () => {
				_cleanup();
				if (!_closed) {
					_status.set("disconnected");
					_scheduleReconnect();
				}
			});

			_session.on("close", () => {
				_cleanup();
				if (!_closed) {
					_status.set("disconnected");
					_scheduleReconnect();
				}
			});

			// Open a bidirectional stream
			_stream = _session.request({
				":method": "POST",
				":path": streamPath,
				"content-type": "application/x-ndjson",
			});

			_stream.on("response", () => {
				_reconnectAttempts = 0;
				_status.set("connected");

				// Flush send buffer
				for (const msg of _sendBuffer) {
					_stream.write(msg);
				}
				_sendBuffer = [];
			});

			_stream.on("data", (chunk: Buffer | string) => {
				const data = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
				_incomingBuffer += data;

				// Process complete lines
				let nlIdx = _incomingBuffer.indexOf("\n");
				while (nlIdx !== -1) {
					const line = _incomingBuffer.slice(0, nlIdx).trim();
					_incomingBuffer = _incomingBuffer.slice(nlIdx + 1);
					if (line) {
						try {
							const envelope = JSON.parse(line) as TransportEnvelope;
							for (const handler of _handlers) {
								handler(envelope);
							}
						} catch {
							// Ignore malformed messages
						}
					}
					nlIdx = _incomingBuffer.indexOf("\n");
				}
			});

			_stream.on("end", () => {
				_cleanup();
				if (!_closed) {
					_status.set("disconnected");
					_scheduleReconnect();
				}
			});

			_stream.on("error", () => {
				// 'end' or session 'close' will handle cleanup
			});
		} catch {
			_status.set("disconnected");
			_scheduleReconnect();
		}
	}

	let _reconnecting = false;

	function _cleanup(): void {
		_stream = null;
		_incomingBuffer = "";
		if (_session) {
			try {
				_session.close();
			} catch {
				/* ignore */
			}
			_session = null;
		}
	}

	function _scheduleReconnect(): void {
		if (_closed || !shouldReconnect || _reconnecting) return;
		if (maxAttempts > 0 && _reconnectAttempts >= maxAttempts) return;

		_reconnecting = true;
		const delay = Math.min(baseDelay * 2 ** _reconnectAttempts, maxDelay);
		_reconnectAttempts++;
		_reconnectTimer = setTimeout(() => {
			_reconnectTimer = undefined;
			_reconnecting = false;
			_connect().catch(() => {});
		}, delay);
	}

	// --- Start connection ---
	_connect().catch(() => {});

	return {
		send(envelope: TransportEnvelope): void {
			if (_closed) return;
			const msg = `${JSON.stringify(envelope)}\n`;
			if (_stream && _status.get() === "connected") {
				_stream.write(msg);
			} else {
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

			if (_stream) {
				try {
					_stream.end();
				} catch {
					/* ignore */
				}
				_stream = null;
			}

			if (_session) {
				try {
					_session.close();
				} catch {
					/* ignore */
				}
				_session = null;
			}

			_handlers.clear();
			_sendBuffer = [];
			_incomingBuffer = "";
			_status.set("disconnected");
			teardown(_status);
		},
	};
}
