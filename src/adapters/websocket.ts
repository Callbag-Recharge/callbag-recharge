// ---------------------------------------------------------------------------
// WebSocket adapter — fromWebSocket / toWebSocket
// ---------------------------------------------------------------------------
// Reactive WebSocket bridge using browser-native WebSocket API. No deps.
//
// Usage:
//   const ws = fromWebSocket("ws://localhost:8080");
//   subscribe(ws.messages, msg => console.log(msg));
//   ws.send("hello");
//   ws.close();
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { state } from "../core/state";
import { subscribe as coreSub } from "../core/subscribe";
import type { Store } from "../core/types";

export type WebSocketStatus = "connecting" | "open" | "closing" | "closed";

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

export interface WebSocketStore<T = unknown> {
	/** Reactive store emitting parsed messages. */
	messages: Store<T | undefined>;
	/** Connection status store. */
	status: Store<WebSocketStatus>;
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
 * @returnsTable messages | Store\<T \| undefined\> | Reactive store emitting parsed messages.
 * status | Store\<WebSocketStatus\> | Connection status: "connecting", "open", "closing", "closed".
 * send(data) | (data) => void | Send data through the WebSocket. Queues if connecting.
 * close(code?, reason?) | (code?, reason?) => void | Close the connection.
 *
 * @remarks **Tier 2:** Cycle boundary — each message starts a new DIRTY+value cycle.
 * @remarks **No deps:** Uses browser-native WebSocket API. Works in Node.js 21+ and all modern browsers.
 * @remarks **Reconnect:** Optional auto-reconnect with configurable delay.
 * @remarks **Send queue:** Messages sent before the connection is open are queued and flushed on open.
 * @remarks **Parse errors:** Default "warn" — logs and skips. Use "error" to terminate, "skip" to silently drop.
 *
 * @example
 * ```ts
 * import { fromWebSocket } from 'callbag-recharge/adapters/websocket';
 * import { subscribe } from 'callbag-recharge';
 *
 * const ws = fromWebSocket("ws://localhost:8080");
 * subscribe(ws.messages, msg => console.log("received:", msg));
 * subscribe(ws.status, s => console.log("status:", s));
 * ws.send("hello");
 * ws.close();
 * ```
 *
 * @seeAlso [fromWebhook](./webhook) — HTTP trigger, [fromEvent](/api/fromEvent) — DOM event source
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

	const statusStore = state<WebSocketStatus>("connecting", {
		name: `${baseName}:status`,
		equals: () => false,
	});

	let ws: WebSocket | null = null;
	let _emit: ((value: T) => void) | null = null;
	let _error: ((e: unknown) => void) | null = null;
	let _complete: (() => void) | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let intentionalClose = false;
	const sendQueue: (string | ArrayBufferLike | Blob | ArrayBufferView)[] = [];

	function flushSendQueue() {
		while (sendQueue.length > 0 && ws?.readyState === WebSocket.OPEN) {
			ws.send(sendQueue.shift()!);
		}
	}

	function connect() {
		intentionalClose = false;
		statusStore.set("connecting");

		try {
			ws = new WebSocket(url, opts?.protocols);
		} catch (err) {
			statusStore.set("closed");
			_error?.(err);
			return;
		}

		ws.onopen = () => {
			statusStore.set("open");
			flushSendQueue();
		};

		ws.onmessage = (event: MessageEvent) => {
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
			// WebSocket errors are followed by close, so we don't complete here
		};

		ws.onclose = () => {
			statusStore.set("closed");
			ws = null;

			if (!intentionalClose && reconnectDelay !== false) {
				reconnectTimer = setTimeout(() => {
					reconnectTimer = null;
					if (_emit) {
						// Only reconnect if producer is still active
						connect();
					}
				}, reconnectDelay);
			} else {
				_complete?.();
			}
		};
	}

	const messages = producer<T>(
		({ emit, error, complete }) => {
			_emit = emit;
			_error = error;
			_complete = complete;
			connect();

			return () => {
				_emit = null;
				_error = null;
				_complete = null;
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
				statusStore.set("closed");
			};
		},
		{ name: baseName, kind: "websocket" },
	);

	Inspector.register(messages, { kind: "websocket" });

	return {
		messages,
		status: statusStore,
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
 * @returns `() => void` — unsubscribe function that stops sending.
 *
 * @remarks **Sink:** Subscribes to the source and forwards each value to the WebSocket via `send()`.
 * @remarks **Serialization:** Objects are JSON.stringify'd by default. Strings pass through as-is.
 *
 * @example
 * ```ts
 * import { state } from 'callbag-recharge';
 * import { fromWebSocket, toWebSocket } from 'callbag-recharge/adapters/websocket';
 *
 * const ws = fromWebSocket("ws://localhost:8080");
 * const output = state("hello");
 * const unsub = toWebSocket(ws, output);
 * output.set("world"); // sends "world" to WebSocket
 * unsub();
 * ```
 *
 * @seeAlso [fromWebSocket](./websocket) — WebSocket source, [subscribe](/api/subscribe) — general sink
 *
 * @category adapters
 */
export function toWebSocket<T>(
	ws: WebSocketStore | WebSocket,
	source: Store<T>,
	opts?: ToWebSocketOptions,
): () => void {
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
