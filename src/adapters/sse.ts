// ---------------------------------------------------------------------------
// SSE adapter — Server-Sent Events sink (Node.js / edge)
// ---------------------------------------------------------------------------
// Streams reactive store values to connected SSE clients. Works with
// Node.js http module or any framework that exposes (req, res).
//
// Usage:
//   const sse = toSSE(source, { port: 3000, path: "/events" });
//   await sse.listen();
//   // Browser: const es = new EventSource("http://localhost:3000/events");
//   sse.close();
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { state } from "../core/state";
import { subscribe as coreSub } from "../core/subscribe";
import type { Store } from "../core/types";
import { rawFromAny } from "../raw/fromAny";
import { fromNodeCallback } from "../raw/fromNodeCallback";
import type { CallbagSource } from "../raw/subscribe";
import { rawSubscribe } from "../raw/subscribe";

export interface SSEOptions {
	/** Port to listen on. Required when using `listen()`. */
	port?: number;
	/** Path to match for SSE connections (default: "/"). */
	path?: string;
	/** Debug name for Inspector. */
	name?: string;
	/** Serializer for store values. Default: JSON.stringify. */
	serialize?: (value: unknown) => string;
	/** Hostname to bind to (default: "0.0.0.0"). */
	hostname?: string;
	/** SSE event name (default: "message"). */
	eventName?: string;
	/** Ping interval in ms to keep connections alive. Default: 30000. Set 0 to disable. */
	pingInterval?: number;
}

export interface SSEStore {
	/** Number of connected SSE clients. */
	connectionCount: Store<number>;
	/**
	 * Handler function compatible with Node.js http.createServer callback.
	 * Use this to mount SSE on an existing server.
	 */
	handler: (req: any, res: any) => void;
	/** Start listening on the configured port. Returns a callbag source that emits when ready. */
	listen(): CallbagSource;
	/** Close the server and disconnect all clients. */
	close(): void;
}

/**
 * Server-Sent Events sink. Streams store values to connected browser clients (Tier 2).
 *
 * @param source - The store to stream.
 * @param opts - Configuration for the SSE server.
 *
 * @returns `SSEStore` — contains the connection handler, client count, and server lifecycle methods.
 *
 * @returnsTable connectionCount | Store\<number\> | Number of connected SSE clients.
 * handler | (req, res) => void | Node.js-compatible handler for use with existing servers.
 * listen() | () => Promise\<void\> | Start listening on configured port.
 * close() | () => void | Close server and disconnect all clients.
 *
 * @remarks **Sink:** Subscribes to the source store and broadcasts each value to all connected SSE clients.
 * @remarks **Standalone or embedded:** Use `listen()` for standalone, or `handler` to mount on an existing HTTP server.
 * @remarks **Keep-alive:** Sends SSE comments as pings at configurable intervals (default 30s).
 * @remarks **CORS:** Sets `Access-Control-Allow-Origin: *` for cross-origin access.
 *
 * @example
 * ```ts
 * import { state } from 'callbag-recharge';
 * import { toSSE } from 'callbag-recharge/adapters/sse';
 *
 * const status = state("idle");
 * const sse = toSSE(status, { port: 3000, path: "/status" });
 * await sse.listen();
 * status.set("running"); // broadcast to all connected clients
 * sse.close();
 * ```
 *
 * @example Mount on existing server
 * ```ts
 * import http from 'node:http';
 * import { toSSE } from 'callbag-recharge/adapters/sse';
 *
 * const sse = toSSE(pipelineStatus, { path: "/events" });
 * const server = http.createServer((req, res) => {
 *   if (req.url === "/events") return sse.handler(req, res);
 *   res.writeHead(404);
 *   res.end();
 * });
 * server.listen(8080);
 * ```
 *
 * @seeAlso [fromWebhook](./webhook) — HTTP trigger source, [fromWebSocket](./websocket) — WebSocket bridge
 *
 * @category adapters
 */
export function toSSE<T>(source: Store<T>, opts?: SSEOptions): SSEStore {
	const path = opts?.path ?? "/";
	const baseName = opts?.name ?? "sse";
	const hostname = opts?.hostname ?? "0.0.0.0";
	const serialize = opts?.serialize ?? JSON.stringify;
	const eventName = opts?.eventName ?? "message";
	const pingInterval = opts?.pingInterval ?? 30000;

	const connectionCountStore = state<number>(0, { name: `${baseName}:connections` });

	const clients = new Set<any>(); // Set of response objects
	const pingTimers = new Map<any, ReturnType<typeof setInterval>>();

	// Subscribe to source and broadcast to all clients
	let sourceSub: { unsubscribe(): void } | null = null;

	function ensureSubscription() {
		if (sourceSub) return;
		sourceSub = coreSub(source, (value) => {
			const data = serialize(value);
			const message = `event: ${eventName}\ndata: ${data}\n\n`;
			for (const res of clients) {
				try {
					res.write(message);
				} catch {
					// Client disconnected
					removeClient(res);
				}
			}
		});
	}

	function removeClient(res: any) {
		clients.delete(res);
		const timer = pingTimers.get(res);
		if (timer) {
			clearInterval(timer);
			pingTimers.delete(res);
		}
		connectionCountStore.set(clients.size);
		// Unsubscribe from source when no clients remain
		if (clients.size === 0 && sourceSub) {
			sourceSub.unsubscribe();
			sourceSub = null;
		}
	}

	function handler(req: any, res: any) {
		const method = req.method?.toUpperCase();
		const url = req.url ?? "/";
		const reqPath = url.split("?")[0];

		if (reqPath !== path) {
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not found");
			return;
		}

		if (method === "OPTIONS") {
			res.writeHead(204, {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET",
				"Access-Control-Allow-Headers": "Cache-Control",
			});
			res.end();
			return;
		}

		if (method !== "GET") {
			res.writeHead(405, { "Content-Type": "text/plain" });
			res.end("Method not allowed");
			return;
		}

		// SSE headers
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"Access-Control-Allow-Origin": "*",
		});

		// Send initial comment
		res.write(":ok\n\n");

		clients.add(res);
		connectionCountStore.set(clients.size);

		// Send current value immediately
		try {
			const current = source.get();
			if (current !== undefined) {
				const data = serialize(current);
				res.write(`event: ${eventName}\ndata: ${data}\n\n`);
			}
		} catch {
			// get() may throw on errored stores
		}

		// Ping keep-alive
		if (pingInterval > 0) {
			const timer = setInterval(() => {
				try {
					res.write(":ping\n\n");
				} catch {
					removeClient(res);
				}
			}, pingInterval);
			pingTimers.set(res, timer);
		}

		// Cleanup on client disconnect
		req.on("close", () => removeClient(res));

		ensureSubscription();
	}

	let server: any = null;

	function listen(): CallbagSource {
		if (!opts?.port) {
			return (type: number, sink?: any) => {
				if (type !== 0) return;
				sink(0, () => {});
				sink(2, new Error("toSSE: port is required for listen()"));
			};
		}
		if (server) {
			return (type: number, sink?: any) => {
				if (type !== 0) return;
				sink(0, () => {});
				sink(2, new Error("toSSE: already listening. Call close() first."));
			};
		}
		// Use rawFromAny to wrap the dynamic import, then chain to fromNodeCallback
		return (type: number, sink?: any) => {
			if (type !== 0) return;
			let cancelled = false;
			sink(0, (t: number) => {
				if (t === 2) cancelled = true;
			});
			rawSubscribe(rawFromAny(import("node:http")), (http) => {
				if (cancelled) return;
				rawSubscribe(
					fromNodeCallback((resolve, reject) => {
						server = http.createServer(handler);
						server.once("listening", () => resolve());
						server.once("error", (err: unknown) => {
							server = null;
							reject(err);
						});
						server.listen(opts!.port, hostname);
						return undefined;
					}),
					() => {
						if (!cancelled) {
							sink(1, undefined);
							sink(2);
						}
					},
					{
						onEnd: (err?: unknown) => {
							if (err !== undefined && !cancelled) sink(2, err);
						},
					},
				);
			});
		};
	}

	function close() {
		// Disconnect all clients
		for (const res of clients) {
			try {
				res.end();
			} catch {
				// ignore
			}
		}
		clients.clear();
		for (const timer of pingTimers.values()) clearInterval(timer);
		pingTimers.clear();
		connectionCountStore.set(0);

		// Unsubscribe from source
		sourceSub?.unsubscribe();
		sourceSub = null;

		// Close server
		server?.close();
		server = null;
	}

	Inspector.register(connectionCountStore, { kind: "sse" });

	return {
		connectionCount: connectionCountStore,
		handler,
		listen,
		close,
	};
}
