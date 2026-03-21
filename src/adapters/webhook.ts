// ---------------------------------------------------------------------------
// fromWebhook — HTTP trigger source (Node.js / edge)
// ---------------------------------------------------------------------------
// Creates a reactive source that emits parsed request bodies when an HTTP
// endpoint receives POST requests. Works with Node.js http module or any
// edge runtime that provides Request/Response.
//
// Usage:
//   const webhook = fromWebhook({ port: 3000, path: "/hook" });
//   subscribe(webhook.store, payload => console.log(payload));
//   // POST http://localhost:3000/hook  →  emits parsed body
//   webhook.close();
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { state } from "../core/state";
import type { Store } from "../core/types";

export interface WebhookOptions {
	/** Port to listen on. Required when no external server is provided. */
	port?: number;
	/** Path to match (default: "/"). Only POST requests to this path trigger emission. */
	path?: string;
	/** Debug name for Inspector. */
	name?: string;
	/**
	 * Custom body parser. Receives the raw body string, returns parsed value.
	 * Default: JSON.parse.
	 */
	parse?: (body: string) => unknown;
	/** Hostname to bind to (default: "0.0.0.0"). */
	hostname?: string;
	/** Maximum request body size in bytes. Default: 1MB. Rejects with 413 if exceeded. */
	maxBodySize?: number;
}

export interface WebhookStore<T = unknown> {
	/** Reactive store that emits parsed request bodies. */
	store: Store<T | undefined>;
	/** Number of requests received. */
	requestCount: Store<number>;
	/**
	 * Handler function compatible with Node.js http.createServer callback.
	 * Use this when you want to attach the webhook to an existing server
	 * instead of creating a new one.
	 */
	handler: (req: any, res: any) => void;
	/** Start listening on the configured port. Returns a promise that resolves when ready. */
	listen(): Promise<void>;
	/** Close the server and clean up. */
	close(): void;
}

/**
 * Creates an HTTP trigger source. Emits parsed POST bodies as reactive values (Tier 2).
 *
 * @param opts - Configuration for the webhook server.
 *
 * @returns `WebhookStore<T>` — contains the reactive store, request handler, and server lifecycle methods.
 *
 * @returnsTable store | Store\<T \| undefined\> | Reactive store emitting parsed request bodies.
 * requestCount | Store\<number\> | Number of requests received.
 * handler | (req, res) => void | Node.js-compatible request handler for use with existing servers.
 * listen() | () => Promise\<void\> | Start listening on configured port.
 * close() | () => void | Close server and clean up.
 *
 * @remarks **Tier 2:** Cycle boundary — each incoming request starts a new reactive update cycle.
 * @remarks **Standalone or embedded:** Use `listen()` for standalone, or `handler` to mount on an existing HTTP server.
 * @remarks **Body parsing:** Default is JSON.parse. Override with `parse` option for custom formats.
 * @remarks **Body size limit:** Default 1MB. Configure with `maxBodySize`. Rejects with 413 if exceeded.
 *
 * @example
 * ```ts
 * import { fromWebhook } from 'callbag-recharge/adapters/webhook';
 * import { subscribe } from 'callbag-recharge';
 *
 * const webhook = fromWebhook({ port: 3000, path: "/hook" });
 * subscribe(webhook.store, payload => console.log(payload));
 * await webhook.listen();
 * // POST http://localhost:3000/hook with JSON body → emits parsed body
 * webhook.close();
 * ```
 *
 * @example Mount on existing server
 * ```ts
 * import http from 'node:http';
 * import { fromWebhook } from 'callbag-recharge/adapters/webhook';
 *
 * const webhook = fromWebhook({ path: "/events" });
 * const server = http.createServer(webhook.handler);
 * server.listen(8080);
 * ```
 *
 * @seeAlso [fromTrigger](../orchestrate/fromTrigger) — manual trigger, [fromWebSocket](./websocket) — WebSocket source
 *
 * @category adapters
 */
export function fromWebhook<T = unknown>(opts?: WebhookOptions): WebhookStore<T> {
	const path = opts?.path ?? "/";
	const parse = opts?.parse ?? JSON.parse;
	const baseName = opts?.name ?? "webhook";
	const hostname = opts?.hostname ?? "0.0.0.0";
	const maxBodySize = opts?.maxBodySize ?? 1024 * 1024; // 1MB default

	const requestCountStore = state<number>(0, { name: `${baseName}:count` });

	let _emit: ((value: T) => void) | null = null;

	const store = producer<T>(
		({ emit }) => {
			_emit = emit;
			return () => {
				_emit = null;
			};
		},
		{ name: baseName, kind: "webhook" },
	);

	Inspector.register(store, { kind: "webhook" });

	let server: any = null;

	function handler(req: any, res: any) {
		// Match method and path
		const method = req.method?.toUpperCase();
		const url = req.url ?? "/";
		const reqPath = url.split("?")[0];

		if (method !== "POST" || reqPath !== path) {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
			return;
		}

		const chunks: Buffer[] = [];
		let totalSize = 0;
		let aborted = false;

		req.on("error", () => {
			aborted = true;
			if (!res.headersSent) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Request aborted" }));
			}
		});

		req.on("data", (chunk: Buffer) => {
			if (aborted) return;
			totalSize += chunk.length;
			if (totalSize > maxBodySize) {
				aborted = true;
				res.writeHead(413, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Payload too large" }));
				req.destroy?.();
				return;
			}
			chunks.push(chunk);
		});

		req.on("end", () => {
			if (aborted) return;
			try {
				const raw = Buffer.concat(chunks).toString("utf-8");
				const parsed = raw.length > 0 ? (parse(raw) as T) : (undefined as T);
				requestCountStore.update((n) => n + 1);
				_emit?.(parsed);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
			} catch (err: any) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: err?.message ?? "Parse error" }));
			}
		});
	}

	function listen(): Promise<void> {
		if (!opts?.port) {
			return Promise.reject(new Error("fromWebhook: port is required for listen()"));
		}
		if (server) {
			return Promise.reject(new Error("fromWebhook: already listening. Call close() first."));
		}
		return new Promise((resolve, reject) => {
			try {
				// Dynamic import to avoid bundling node:http in browser builds
				const http = require("node:http");
				server = http.createServer(handler);
				server.once("listening", () => resolve());
				server.once("error", (err: unknown) => {
					server = null;
					reject(err);
				});
				server.listen(opts!.port, hostname);
			} catch (err) {
				reject(err);
			}
		});
	}

	function close() {
		server?.close();
		server = null;
	}

	return {
		store,
		requestCount: requestCountStore,
		handler,
		listen,
		close,
	};
}
