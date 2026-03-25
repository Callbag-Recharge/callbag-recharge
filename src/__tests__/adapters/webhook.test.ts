import { afterEach, describe, expect, it } from "vitest";
import type { WebhookRequest } from "../../adapters/webhook";
import { fromWebhook } from "../../adapters/webhook";
import { subscribe } from "../../extra/subscribe";
import { firstValueFrom } from "../../raw/firstValueFrom";

// ==========================================================================
// fromWebhook
// ==========================================================================
describe("fromWebhook", () => {
	let webhook: ReturnType<typeof fromWebhook> | null = null;

	afterEach(() => {
		webhook?.close();
		webhook = null;
	});

	it("handler emits WebhookRequest with parsed body on POST", async () => {
		webhook = fromWebhook({ path: "/hook" });

		const values: WebhookRequest[] = [];
		const unsub = subscribe(webhook, (v) => values.push(v));

		const req = createMockReq("POST", "/hook", JSON.stringify({ key: "value" }));
		const res = createMockRes();

		webhook.handler(req, res);

		// respond() hasn't been called yet — no response
		await new Promise((r) => setTimeout(r, 10));
		expect(values).toHaveLength(1);
		expect(values[0].body).toEqual({ key: "value" });
		expect(values[0].responded).toBe(false);

		// Call respond to send HTTP response
		values[0].respond({ ok: true });
		expect(res._statusCode).toBe(200);
		expect(JSON.parse(res._body)).toEqual({ ok: true });
		expect(values[0].responded).toBe(true);

		expect(webhook.requestCount.get()).toBe(1);
		unsub.unsubscribe();
	});

	it("respond() with custom status code", async () => {
		webhook = fromWebhook({ path: "/" });

		const values: WebhookRequest[] = [];
		const unsub = subscribe(webhook, (v) => values.push(v));

		const req = createMockReq("POST", "/", JSON.stringify({ data: 1 }));
		const res = createMockRes();

		webhook.handler(req, res);
		await new Promise((r) => setTimeout(r, 10));

		values[0].respond({ created: true }, 201);
		expect(res._statusCode).toBe(201);

		unsub.unsubscribe();
	});

	it("respond() is idempotent — second call is no-op", async () => {
		webhook = fromWebhook({ path: "/" });

		const values: WebhookRequest[] = [];
		const unsub = subscribe(webhook, (v) => values.push(v));

		const req = createMockReq("POST", "/", "{}");
		const res = createMockRes();

		webhook.handler(req, res);
		await new Promise((r) => setTimeout(r, 10));

		values[0].respond({ first: true });
		values[0].respond({ second: true }); // should be ignored

		expect(JSON.parse(res._body)).toEqual({ first: true });
		unsub.unsubscribe();
	});

	it("auto-responds with 504 on timeout", async () => {
		webhook = fromWebhook({ path: "/", responseTimeout: 50 });

		const unsub = subscribe(webhook, () => {
			// Intentionally don't call respond()
		});

		const req = createMockReq("POST", "/", "{}");
		const res = createMockRes();

		webhook.handler(req, res);
		await waitForRes(res);

		expect(res._statusCode).toBe(504);
		expect(JSON.parse(res._body)).toEqual({ error: "Response timeout" });
		unsub.unsubscribe();
	});

	it("rejects non-POST requests with 404", async () => {
		webhook = fromWebhook({ path: "/hook" });

		const req = createMockReq("GET", "/hook", "");
		const res = createMockRes();

		webhook.handler(req, res);
		await waitForRes(res);

		expect(res._statusCode).toBe(404);
	});

	it("rejects wrong path with 404", async () => {
		webhook = fromWebhook({ path: "/hook" });

		const req = createMockReq("POST", "/other", "{}");
		const res = createMockRes();

		webhook.handler(req, res);
		await waitForRes(res);

		expect(res._statusCode).toBe(404);
	});

	it("returns 400 on invalid JSON", async () => {
		webhook = fromWebhook({ path: "/" });

		const values: any[] = [];
		const unsub = subscribe(webhook, (v) => values.push(v));

		const req = createMockReq("POST", "/", "not-json{{{");
		const res = createMockRes();

		webhook.handler(req, res);
		await waitForRes(res);

		expect(res._statusCode).toBe(400);
		expect(values).toEqual([]); // no emission on parse error
		unsub.unsubscribe();
	});

	it("custom parse function", async () => {
		webhook = fromWebhook({
			path: "/",
			parse: (body) => body.toUpperCase(),
		});

		const values: WebhookRequest[] = [];
		const unsub = subscribe(webhook, (v) => values.push(v));

		const req = createMockReq("POST", "/", "hello");
		const res = createMockRes();

		webhook.handler(req, res);
		await new Promise((r) => setTimeout(r, 10));

		expect(values[0].body).toBe("HELLO");
		values[0].respond({ ok: true });
		unsub.unsubscribe();
	});

	it("requestCount increments on each request", async () => {
		webhook = fromWebhook({ path: "/" });
		const unsub = subscribe(webhook, (v) => v.respond({ ok: true }));

		expect(webhook.requestCount.get()).toBe(0);

		const req1 = createMockReq("POST", "/", JSON.stringify({ n: 1 }));
		const res1 = createMockRes();
		webhook.handler(req1, res1);
		await waitForRes(res1);

		expect(webhook.requestCount.get()).toBe(1);

		const req2 = createMockReq("POST", "/", JSON.stringify({ n: 2 }));
		const res2 = createMockRes();
		webhook.handler(req2, res2);
		await waitForRes(res2);

		expect(webhook.requestCount.get()).toBe(2);
		unsub.unsubscribe();
	});

	it("multiple subscribers receive the same request", async () => {
		webhook = fromWebhook({ path: "/" });

		const v1: WebhookRequest[] = [];
		const v2: WebhookRequest[] = [];
		const u1 = subscribe(webhook, (v) => v1.push(v));
		const u2 = subscribe(webhook, (v) => v2.push(v));

		const req = createMockReq("POST", "/", JSON.stringify({ x: 1 }));
		const res = createMockRes();
		webhook.handler(req, res);
		await new Promise((r) => setTimeout(r, 10));

		expect(v1).toHaveLength(1);
		expect(v2).toHaveLength(1);
		expect(v1[0].body).toEqual({ x: 1 });

		// Either subscriber can respond
		v1[0].respond({ handled: true });
		expect(res._statusCode).toBe(200);

		u1.unsubscribe();
		u2.unsubscribe();
	});

	it("rejects body exceeding maxBodySize with 413", async () => {
		webhook = fromWebhook({ path: "/", maxBodySize: 10 });
		const unsub = subscribe(webhook, () => {});

		const req = createMockReq("POST", "/", "a]".repeat(20));
		const res = createMockRes();

		webhook.handler(req, res);
		await waitForRes(res);

		expect(res._statusCode).toBe(413);
		unsub.unsubscribe();
	});

	it("handles request stream errors gracefully", async () => {
		webhook = fromWebhook({ path: "/" });
		const unsub = subscribe(webhook, () => {});

		const req = createMockReqWithError("POST", "/");
		const res = createMockRes();

		webhook.handler(req, res);
		await waitForRes(res);

		expect(res._statusCode).toBe(400);
		unsub.unsubscribe();
	});

	it("listen() rejects if already listening", async () => {
		const port = 19876 + Math.floor(Math.random() * 1000);
		webhook = fromWebhook({ port, path: "/" });
		await firstValueFrom(webhook.listen());
		await expect(firstValueFrom(webhook.listen())).rejects.toThrow(/already listening/);
		webhook.close();
		webhook = null;
	});

	it("listen() rejects without port", async () => {
		webhook = fromWebhook({ path: "/" });
		await expect(firstValueFrom(webhook.listen())).rejects.toThrow(/port is required/);
	});

	it("listen() and close() lifecycle with request-response", async () => {
		const port = 19876 + Math.floor(Math.random() * 1000);
		webhook = fromWebhook<{ hello: string }>({ port, path: "/test" });

		const unsub = subscribe(webhook, (req) => {
			req.respond({ echo: req.body.hello });
		});

		await firstValueFrom(webhook.listen());

		// Send a real HTTP request
		const body = JSON.stringify({ hello: "world" });
		const response = await fetch(`http://localhost:${port}/test`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
		});

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json).toEqual({ echo: "world" });

		unsub.unsubscribe();
		webhook.close();
		webhook = null;
	});
});

// ==========================================================================
// Mock helpers
// ==========================================================================

function createMockReq(method: string, url: string, body: string) {
	const { EventEmitter } = require("node:events");
	const req = new EventEmitter();
	req.method = method;
	req.url = url;

	// Simulate data chunks async
	process.nextTick(() => {
		if (body.length > 0) {
			req.emit("data", Buffer.from(body));
		}
		req.emit("end");
	});

	return req;
}

function createMockReqWithError(method: string, url: string) {
	const { EventEmitter } = require("node:events");
	const req = new EventEmitter();
	req.method = method;
	req.url = url;
	req.destroy = () => {};

	process.nextTick(() => {
		req.emit("error", new Error("connection reset"));
	});

	return req;
}

function createMockRes() {
	const res: any = {
		_statusCode: 0,
		_headers: {} as Record<string, string>,
		_body: "",
		_ended: false,
		writeHead(code: number, headers?: Record<string, string>) {
			res._statusCode = code;
			if (headers) res._headers = headers;
		},
		end(body?: string) {
			res._body = body ?? "";
			res._ended = true;
			res._resolve?.();
		},
		_resolve: null as (() => void) | null,
	};
	return res;
}

function waitForRes(res: any): Promise<void> {
	if (res._ended) return Promise.resolve();
	return new Promise((resolve) => {
		res._resolve = resolve;
	});
}
