import { afterEach, describe, expect, it } from "vitest";
import { fromWebhook } from "../../adapters/webhook";
import { subscribe } from "../../extra/subscribe";

// ==========================================================================
// fromWebhook
// ==========================================================================
describe("fromWebhook", () => {
	let webhook: ReturnType<typeof fromWebhook> | null = null;

	afterEach(() => {
		webhook?.close();
		webhook = null;
	});

	it("handler emits parsed JSON body on POST", async () => {
		webhook = fromWebhook({ path: "/hook" });

		const values: any[] = [];
		const unsub = subscribe(webhook, (v) => values.push(v));

		// Simulate a POST request via the handler directly
		const req = createMockReq("POST", "/hook", JSON.stringify({ key: "value" }));
		const res = createMockRes();

		webhook.handler(req, res);
		await waitForRes(res);

		expect(res._statusCode).toBe(200);
		expect(values).toEqual([{ key: "value" }]);
		expect(webhook.requestCount.get()).toBe(1);

		unsub();
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
		unsub();
	});

	it("custom parse function", async () => {
		webhook = fromWebhook({
			path: "/",
			parse: (body) => body.toUpperCase(),
		});

		const values: any[] = [];
		const unsub = subscribe(webhook, (v) => values.push(v));

		const req = createMockReq("POST", "/", "hello");
		const res = createMockRes();

		webhook.handler(req, res);
		await waitForRes(res);

		expect(values).toEqual(["HELLO"]);
		unsub();
	});

	it("requestCount increments on each request", async () => {
		webhook = fromWebhook({ path: "/" });
		const unsub = subscribe(webhook, () => {});

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
		unsub();
	});

	it("multiple subscribers receive the same values", async () => {
		webhook = fromWebhook({ path: "/" });

		const v1: any[] = [];
		const v2: any[] = [];
		const u1 = subscribe(webhook, (v) => v1.push(v));
		const u2 = subscribe(webhook, (v) => v2.push(v));

		const req = createMockReq("POST", "/", JSON.stringify({ x: 1 }));
		const res = createMockRes();
		webhook.handler(req, res);
		await waitForRes(res);

		expect(v1).toEqual([{ x: 1 }]);
		expect(v2).toEqual([{ x: 1 }]);

		u1();
		u2();
	});

	it("rejects body exceeding maxBodySize with 413", async () => {
		webhook = fromWebhook({ path: "/", maxBodySize: 10 });
		const unsub = subscribe(webhook, () => {});

		const req = createMockReq("POST", "/", "a]".repeat(20));
		const res = createMockRes();

		webhook.handler(req, res);
		await waitForRes(res);

		expect(res._statusCode).toBe(413);
		unsub();
	});

	it("handles request stream errors gracefully", async () => {
		webhook = fromWebhook({ path: "/" });
		const unsub = subscribe(webhook, () => {});

		const req = createMockReqWithError("POST", "/");
		const res = createMockRes();

		webhook.handler(req, res);
		await waitForRes(res);

		expect(res._statusCode).toBe(400);
		unsub();
	});

	it("listen() rejects if already listening", async () => {
		const port = 19876 + Math.floor(Math.random() * 1000);
		webhook = fromWebhook({ port, path: "/" });
		await webhook.listen();
		await expect(webhook.listen()).rejects.toThrow(/already listening/);
		webhook.close();
		webhook = null;
	});

	it("listen() rejects without port", async () => {
		webhook = fromWebhook({ path: "/" });
		await expect(webhook.listen()).rejects.toThrow(/port is required/);
	});

	it("listen() and close() lifecycle", async () => {
		const port = 19876 + Math.floor(Math.random() * 1000);
		webhook = fromWebhook({ port, path: "/test" });

		const values: any[] = [];
		const unsub = subscribe(webhook, (v) => values.push(v));

		await webhook.listen();

		// Send a real HTTP request
		const body = JSON.stringify({ hello: "world" });
		const response = await fetch(`http://localhost:${port}/test`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
		});

		expect(response.status).toBe(200);
		expect(values).toEqual([{ hello: "world" }]);

		unsub();
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
