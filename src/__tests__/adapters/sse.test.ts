import { describe, expect, it, vi } from "vitest";
import { toSSE } from "../../adapters/sse";
import { state } from "../../index";
import { firstValueFrom } from "../../raw/firstValueFrom";

describe("toSSE", () => {
	it("creates SSE store with handler", () => {
		const source = state("hello");
		const sse = toSSE(source, { path: "/events" });

		expect(sse.connectionCount.get()).toBe(0);
		expect(typeof sse.handler).toBe("function");
		expect(typeof sse.close).toBe("function");
	});

	it("handler returns 404 for wrong path", () => {
		const source = state("hello");
		const sse = toSSE(source, { path: "/events" });

		const req = {
			method: "GET",
			url: "/wrong",
			on: vi.fn(),
		};
		const res = {
			writeHead: vi.fn(),
			end: vi.fn(),
			write: vi.fn(),
		};

		sse.handler(req, res);
		expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
	});

	it("handler returns 405 for non-GET", () => {
		const source = state("hello");
		const sse = toSSE(source, { path: "/events" });

		const req = {
			method: "POST",
			url: "/events",
			on: vi.fn(),
		};
		const res = {
			writeHead: vi.fn(),
			end: vi.fn(),
			write: vi.fn(),
		};

		sse.handler(req, res);
		expect(res.writeHead).toHaveBeenCalledWith(405, expect.any(Object));
	});

	it("handler sets SSE headers and sends initial comment", () => {
		const source = state("hello");
		const sse = toSSE(source, { path: "/events" });

		const closeHandlers: Array<() => void> = [];
		const req = {
			method: "GET",
			url: "/events",
			on: vi.fn().mockImplementation((event: string, handler: () => void) => {
				if (event === "close") closeHandlers.push(handler);
			}),
		};
		const res = {
			writeHead: vi.fn(),
			end: vi.fn(),
			write: vi.fn(),
		};

		sse.handler(req, res);

		expect(res.writeHead).toHaveBeenCalledWith(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"Access-Control-Allow-Origin": "*",
		});
		expect(res.write).toHaveBeenCalledWith(":ok\n\n");
		expect(sse.connectionCount.get()).toBe(1);

		// Sends current value immediately
		expect(res.write).toHaveBeenCalledWith(
			expect.stringContaining('event: message\ndata: "hello"\n\n'),
		);

		// Simulate client disconnect
		closeHandlers[0]?.();
		expect(sse.connectionCount.get()).toBe(0);

		sse.close();
	});

	it("broadcasts source updates to connected clients", () => {
		const source = state("v1");
		const sse = toSSE(source, { path: "/events", pingInterval: 0 });

		const closeHandlers: Array<() => void> = [];
		const req = {
			method: "GET",
			url: "/events",
			on: vi.fn().mockImplementation((event: string, handler: () => void) => {
				if (event === "close") closeHandlers.push(handler);
			}),
		};
		const res = {
			writeHead: vi.fn(),
			end: vi.fn(),
			write: vi.fn(),
		};

		sse.handler(req, res);

		// Update source
		source.set("v2");

		// Should have broadcast the new value
		const writes = (res.write as any).mock.calls.map((c: any) => c[0]);
		expect(writes.some((w: string) => w.includes('"v2"'))).toBe(true);

		sse.close();
	});

	it("handles CORS preflight", () => {
		const source = state("hello");
		const sse = toSSE(source, { path: "/events" });

		const req = { method: "OPTIONS", url: "/events", on: vi.fn() };
		const res = { writeHead: vi.fn(), end: vi.fn(), write: vi.fn() };

		sse.handler(req, res);
		expect(res.writeHead).toHaveBeenCalledWith(
			204,
			expect.objectContaining({
				"Access-Control-Allow-Origin": "*",
			}),
		);
	});

	it("close() disconnects all clients and unsubscribes", () => {
		const source = state("hello");
		const sse = toSSE(source, { path: "/events", pingInterval: 0 });

		const req = { method: "GET", url: "/events", on: vi.fn() };
		const res = { writeHead: vi.fn(), end: vi.fn(), write: vi.fn() };

		sse.handler(req, res);
		expect(sse.connectionCount.get()).toBe(1);

		sse.close();
		expect(sse.connectionCount.get()).toBe(0);
		expect(res.end).toHaveBeenCalled();
	});

	it("listen() rejects without port", async () => {
		const source = state("hello");
		const sse = toSSE(source);
		await expect(firstValueFrom(sse.listen())).rejects.toThrow("port is required");
	});
});
