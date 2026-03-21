// ---------------------------------------------------------------------------
// fromWebhook — HTTP trigger source with request-response (Node.js / edge)
// ---------------------------------------------------------------------------
// Creates a reactive source that emits WebhookRequest objects when an HTTP
// endpoint receives POST requests. Each request carries a `respond()` method
// so pipelines can wire output back as the HTTP response.
//
// Usage:
//   const webhook = fromWebhook<Input>({ port: 3000, path: "/hook" });
//   subscribe(webhook, (req) => {
//     const result = process(req.body);
//     req.respond(result);
//   });
//   webhook.close();
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { state } from "../core/state";
import type { Store } from "../core/types";
import type { WithStatusStatus } from "../utils/withStatus";
import { withStatus } from "../utils/withStatus";

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
	/**
	 * Response timeout in milliseconds. If `respond()` is not called within this
	 * window, the server auto-responds with 504 Gateway Timeout.
	 * Default: 30000 (30s).
	 */
	responseTimeout?: number;
}

/** A webhook request with body and response control. */
export interface WebhookRequest<T = unknown> {
	/** Parsed request body. */
	body: T;
	/**
	 * Send the HTTP response. May only be called once.
	 * @param data - Response body (JSON-serialized).
	 * @param statusCode - HTTP status code. Default: 200.
	 */
	respond(data: unknown, statusCode?: number): void;
	/** Whether a response has already been sent. */
	responded: boolean;
}

export interface WebhookStore<T = unknown> extends Store<WebhookRequest<T> | undefined> {
	/** Lifecycle status: pending → active → completed/errored. */
	status: Store<WithStatusStatus>;
	/** Last error, if any. */
	error: Store<Error | undefined>;
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
 * Creates an HTTP trigger source. Emits `WebhookRequest<T>` objects with parsed body
 * and a `respond()` method so pipelines can wire output back as the HTTP response.
 *
 * @param opts - Configuration for the webhook server.
 *
 * @returns `WebhookStore<T>` — reactive store emitting request objects with response control.
 *
 * @remarks **Request-response:** Each emitted request has a `respond(data, statusCode?)` method.
 * Call it to send the HTTP response. If not called within `responseTimeout` (default 30s),
 * the server auto-responds with 504 Gateway Timeout.
 * @remarks **Status:** Uses withStatus() for lifecycle tracking (pending → active → completed/errored).
 *
 * @example
 * ```ts
 * import { fromWebhook } from 'callbag-recharge/adapters';
 * import { subscribe } from 'callbag-recharge';
 *
 * const webhook = fromWebhook<{ input: string }>({ port: 3000, path: "/process" });
 * subscribe(webhook, (req) => {
 *   const result = transform(req.body);
 *   req.respond({ output: result });
 * });
 * await webhook.listen();
 * ```
 *
 * @category adapters
 */
export function fromWebhook<T = unknown>(opts?: WebhookOptions): WebhookStore<T> {
	const path = opts?.path ?? "/";
	const parse = opts?.parse ?? JSON.parse;
	const baseName = opts?.name ?? "webhook";
	const hostname = opts?.hostname ?? "0.0.0.0";
	const maxBodySize = opts?.maxBodySize ?? 1024 * 1024; // 1MB default
	const responseTimeout = opts?.responseTimeout ?? 30_000;

	const requestCountStore = state<number>(0, { name: `${baseName}:count` });

	let _emit: ((value: WebhookRequest<T>) => void) | null = null;

	const store = producer<WebhookRequest<T>>(
		({ emit }) => {
			_emit = emit;
			return () => {
				_emit = null;
			};
		},
		{ name: baseName, kind: "webhook" },
	);

	Inspector.register(store, { kind: "webhook" });

	// Wrap with withStatus for lifecycle tracking
	const tracked = withStatus(store);

	let server: any = null;
	const _activeTimers = new Set<ReturnType<typeof setTimeout>>();

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

				let hasResponded = false;
				let timer: ReturnType<typeof setTimeout> | null = null;

				const request: WebhookRequest<T> = {
					body: parsed,
					get responded() {
						return hasResponded;
					},
					respond(data: unknown, statusCode = 200) {
						if (hasResponded) return;
						hasResponded = true;
						if (timer !== null) {
							clearTimeout(timer);
							_activeTimers.delete(timer);
							timer = null;
						}
						res.writeHead(statusCode, { "Content-Type": "application/json" });
						res.end(JSON.stringify(data));
					},
				};

				// Auto-respond with 504 if respond() not called in time
				timer = setTimeout(() => {
					_activeTimers.delete(timer!);
					timer = null;
					if (!hasResponded) {
						hasResponded = true;
						res.writeHead(504, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: "Response timeout" }));
					}
				}, responseTimeout);
				_activeTimers.add(timer);

				_emit?.(request);
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
		// Clear all in-flight response timeout timers
		for (const timer of _activeTimers) {
			clearTimeout(timer);
		}
		_activeTimers.clear();
		server?.close();
		server = null;
	}

	return {
		get: () => tracked.get() as WebhookRequest<T> | undefined,
		source: (type: number, payload?: any) => tracked.source(type, payload),
		status: tracked.status,
		error: tracked.error,
		requestCount: requestCountStore,
		handler,
		listen,
		close,
	};
}
