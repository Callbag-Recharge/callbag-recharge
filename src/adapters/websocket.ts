// ---------------------------------------------------------------------------
// WebSocket adapter — fromWebSocket / toWebSocket
// ---------------------------------------------------------------------------
// Reactive WebSocket bridge using browser-native WebSocket API. Uses
// withStatus() for lifecycle tracking (§20 companion store pattern).
//
// Usage:
//   const ws = fromWebSocket("ws://localhost:8080");
//   subscribe(ws, msg => console.log(msg));
//   subscribe(ws.status, s => console.log(s));
//   ws.send("hello");
//   ws.close();
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { LifecycleSignal, Subscription } from "../core/protocol";
import { PAUSE, RESET, RESUME } from "../core/protocol";
import { state } from "../core/state";
import { subscribe as coreSub } from "../core/subscribe";
import type { Store } from "../core/types";
import type { WithStatusStatus } from "../utils/withStatus";
import { withStatus } from "../utils/withStatus";

export type WebSocketConnectionState = "connecting" | "open" | "closed";

export interface FromWebSocketOptions {
	/** WebSocket subprotocols. */
	protocols?: string | string[];
	/** Debug name for Inspector. */
	name?: string;
	/**
	 * Message parser. Receives raw MessageEvent.data, returns parsed value.
	 * Default: identity (returns raw data as-is).
	 */
	parse?: (data: any) => unknown;
	/**
	 * Auto-reconnect on close. Provide a delay in ms, or false to disable.
	 * Default: false.
	 */
	reconnect?: number | false;
	/**
	 * How to handle parse errors.
	 * - "warn": log a warning and skip the message (default).
	 * - "error": terminate the stream with the parse error.
	 * - "skip": silently skip the message.
	 */
	onParseError?: "warn" | "error" | "skip";
}

export interface WebSocketStore<T = unknown> extends Store<T | undefined> {
	/** Lifecycle status: pending → active → completed/errored. */
	status: Store<WithStatusStatus>;
	/** Last error, if any. */
	error: Store<Error | undefined>;
	/** Domain-specific connection state: connecting → open → closed. */
	connectionState: Store<WebSocketConnectionState>;
	/** Send a message through the WebSocket. Queues if not yet open. */
	send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
	/** Close the WebSocket connection. */
	close(code?: number, reason?: string): void;
}

/**
 * Creates a reactive WebSocket source. Emits parsed messages as store values (Tier 2).
 *
 * @param url - WebSocket server URL (ws:// or wss://).
 * @param opts - Optional configuration.
 *
 * @returns `WebSocketStore<T>` — reactive message store with send/close methods.
 *
 * @remarks **Tier 2:** Cycle boundary — each message starts a new reactive update cycle.
 * @remarks **No deps:** Uses browser-native WebSocket API. Works in Node.js 21+ and all modern browsers.
 * @remarks **Reconnect:** Optional auto-reconnect with configurable delay.
 * @remarks **Send queue:** Messages sent before the connection is open are queued and flushed on open.
 * @remarks **Parse errors:** Default "warn" — logs and skips. Use "error" to terminate, "skip" to silently drop.
 * @remarks **Status:** Uses withStatus() for lifecycle tracking (pending → active → completed/errored).
 *
 * @example
 * ```ts
 * import { fromWebSocket } from 'callbag-recharge/adapters';
 * import { subscribe } from 'callbag-recharge';
 *
 * const ws = fromWebSocket("ws://localhost:8080");
 * subscribe(ws, msg => console.log("received:", msg));
 * subscribe(ws.status, s => console.log("status:", s));
 * ws.send("hello");
 * ws.close();
 * ```
 *
 * @category adapters
 */
export function fromWebSocket<T = unknown>(
	url: string,
	opts?: FromWebSocketOptions,
): WebSocketStore<T> {
	const baseName = opts?.name ?? "websocket";
	const parse = opts?.parse ?? ((d: any) => d);
	const reconnectDelay = opts?.reconnect ?? false;
	const onParseError = opts?.onParseError ?? "warn";

	const connectionStateStore = state<WebSocketConnectionState>("connecting", {
		name: `${baseName}:connectionState`,
		equals: () => false,
	});

	let ws: WebSocket | null = null;
	let _emit: ((value: T) => void) | null = null;
	let _error: ((e: unknown) => void) | null = null;
	let _complete: (() => void) | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let intentionalClose = false;
	let lastError: unknown = null;
	const sendQueue: (string | ArrayBufferLike | Blob | ArrayBufferView)[] = [];

	function flushSendQueue() {
		while (sendQueue.length > 0 && ws?.readyState === WebSocket.OPEN) {
			ws.send(sendQueue.shift()!);
		}
	}

	function connect() {
		intentionalClose = false;
		connectionStateStore.set("connecting");

		try {
			ws = new WebSocket(url, opts?.protocols);
		} catch (err) {
			connectionStateStore.set("closed");
			_error?.(err);
			return;
		}

		ws.onopen = () => {
			connectionStateStore.set("open");
			flushSendQueue();
		};

		ws.onmessage = (event: MessageEvent) => {
			if (messagePaused) return; // Drop messages while paused
			try {
				const parsed = parse(event.data) as T;
				_emit?.(parsed);
			} catch (err) {
				if (onParseError === "error") {
					_error?.(err);
				} else if (onParseError === "warn") {
					console.warn(`[${baseName}] parse error:`, err);
				}
				// "skip" and "warn" both continue the stream
			}
		};

		ws.onerror = () => {
			// Capture that an error preceded close — used in onclose to signal error vs clean close
			lastError = new Error(`WebSocket error on ${url}`);
		};

		ws.onclose = () => {
			connectionStateStore.set("closed");
			ws = null;
			const err = lastError;
			lastError = null;

			if (!intentionalClose && reconnectDelay !== false) {
				reconnectTimer = setTimeout(() => {
					reconnectTimer = null;
					if (_emit) {
						// Only reconnect if producer is still active
						connect();
					}
				}, reconnectDelay);
			} else if (err && !intentionalClose) {
				_error?.(err);
			} else {
				_complete?.();
			}
		};
	}

	let messagePaused = false;

	const messages = producer<T>(
		({ emit, error, complete, onSignal }) => {
			_emit = emit;
			_error = error;
			_complete = complete;
			messagePaused = false;
			connect();

			onSignal((s: LifecycleSignal) => {
				if (s === PAUSE) {
					messagePaused = true;
				} else if (s === RESUME) {
					messagePaused = false;
				} else if (s === RESET) {
					// Close and reconnect from scratch
					messagePaused = false;
					sendQueue.length = 0;
					if (reconnectTimer !== null) {
						clearTimeout(reconnectTimer);
						reconnectTimer = null;
					}
					if (ws) {
						intentionalClose = true;
						ws.onopen = null;
						ws.onmessage = null;
						ws.onerror = null;
						ws.onclose = null;
						ws.close();
						ws = null;
					}
					connectionStateStore.set("closed");
					// Reconnect fresh
					connect();
				}
				// TEARDOWN is handled by ProducerImpl._handleLifecycleSignal → complete()
			});

			return () => {
				_emit = null;
				_error = null;
				_complete = null;
				messagePaused = false;
				intentionalClose = true;
				sendQueue.length = 0;
				if (reconnectTimer !== null) {
					clearTimeout(reconnectTimer);
					reconnectTimer = null;
				}
				if (ws) {
					ws.onopen = null;
					ws.onmessage = null;
					ws.onerror = null;
					ws.onclose = null;
					ws.close();
					ws = null;
				}
				connectionStateStore.set("closed");
			};
		},
		{ name: baseName, kind: "websocket" },
	);

	Inspector.register(messages, { kind: "websocket" });

	// Wrap with withStatus for lifecycle tracking
	const tracked = withStatus(messages);

	return {
		get: () => tracked.get() as T | undefined,
		source: (type: number, payload?: any) => tracked.source(type, payload),
		status: tracked.status,
		error: tracked.error,
		connectionState: connectionStateStore,
		send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(data);
			} else {
				// Queue for delivery when connection opens
				sendQueue.push(data);
			}
		},
		close(code?: number, reason?: string) {
			intentionalClose = true;
			sendQueue.length = 0;
			if (reconnectTimer !== null) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			ws?.close(code, reason);
		},
	};
}

export interface ToWebSocketOptions {
	/** Debug name for Inspector. */
	name?: string;
	/** Serializer. Default: JSON.stringify for objects, identity for strings. */
	serialize?: (value: unknown) => string | ArrayBufferLike | Blob | ArrayBufferView;
}

/**
 * Sends store values to a WebSocket connection. Returns an unsubscribe function.
 *
 * @param ws - A WebSocket instance or a `WebSocketStore` from `fromWebSocket()`.
 * @param source - The store to subscribe to.
 * @param opts - Optional configuration.
 *
 * @returns `Subscription` — call `.unsubscribe()` to stop sending.
 *
 * @category adapters
 */
export function toWebSocket<T>(
	ws: WebSocketStore | WebSocket,
	source: Store<T>,
	opts?: ToWebSocketOptions,
): Subscription {
	const defaultSerialize = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));
	const serialize = opts?.serialize ?? defaultSerialize;

	const sendFn =
		"send" in ws && typeof ws.send === "function"
			? (ws as WebSocket | WebSocketStore).send.bind(ws)
			: null;

	if (!sendFn) {
		throw new Error("toWebSocket: invalid WebSocket target");
	}

	return coreSub(source, (value) => {
		try {
			const data = serialize(value);
			sendFn(data as any);
		} catch (_) {
			// Silently drop if WebSocket is not open
		}
	});
}
