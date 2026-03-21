import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromWebSocket, toWebSocket } from "../../adapters/websocket";
import { subscribe } from "../../extra/subscribe";
import { state } from "../../index";

// ==========================================================================
// WebSocket mock (browser-like API)
// ==========================================================================

class MockWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;

	readyState = MockWebSocket.CONNECTING;
	onopen: ((event: any) => void) | null = null;
	onmessage: ((event: any) => void) | null = null;
	onerror: ((event: any) => void) | null = null;
	onclose: ((event: any) => void) | null = null;

	url: string;
	protocols?: string | string[];
	sent: any[] = [];
	closeCode?: number;
	closeReason?: string;

	constructor(url: string, protocols?: string | string[]) {
		this.url = url;
		this.protocols = protocols;

		// Auto-connect async
		setTimeout(() => {
			this.readyState = MockWebSocket.OPEN;
			this.onopen?.({});
		}, 0);
	}

	send(data: any) {
		if (this.readyState !== MockWebSocket.OPEN) {
			throw new Error("WebSocket is not open");
		}
		this.sent.push(data);
	}

	close(code?: number, reason?: string) {
		this.closeCode = code;
		this.closeReason = reason;
		this.readyState = MockWebSocket.CLOSING;
		setTimeout(() => {
			this.readyState = MockWebSocket.CLOSED;
			this.onclose?.({ code: code ?? 1000, reason: reason ?? "" });
		}, 0);
	}

	// Test helpers
	simulateMessage(data: any) {
		this.onmessage?.({ data });
	}

	simulateError() {
		this.onerror?.({});
	}

	simulateClose(code = 1000, reason = "") {
		this.readyState = MockWebSocket.CLOSED;
		this.onclose?.({ code, reason });
	}
}

// Install mock globally
let lastCreatedWs: MockWebSocket | null = null;

beforeEach(() => {
	(globalThis as any).WebSocket = class extends MockWebSocket {
		constructor(url: string, protocols?: string | string[]) {
			super(url, protocols);
			lastCreatedWs = this;
		}
	};
});

afterEach(() => {
	lastCreatedWs = null;
	delete (globalThis as any).WebSocket;
});

// ==========================================================================
// fromWebSocket
// ==========================================================================
describe("fromWebSocket", () => {
	it("emits messages from WebSocket", async () => {
		const ws = fromWebSocket("ws://localhost:8080");
		const values: any[] = [];
		const unsub = subscribe(ws, (v) => values.push(v));

		// Wait for connection
		await vi.waitFor(() => expect(ws.connectionState.get()).toBe("open"));

		lastCreatedWs!.simulateMessage("hello");
		lastCreatedWs!.simulateMessage("world");

		expect(values).toEqual(["hello", "world"]);

		unsub.unsubscribe();
		ws.close();
	});

	it("tracks connection state", async () => {
		const ws = fromWebSocket("ws://localhost:8080");
		const states: string[] = [];
		const unsub = subscribe(ws, () => {});
		const stateUnsub = subscribe(ws.connectionState, (s) => states.push(s));

		// Initially connecting, then open
		await vi.waitFor(() => expect(ws.connectionState.get()).toBe("open"));

		ws.close();
		await vi.waitFor(() => expect(ws.connectionState.get()).toBe("closed"));

		expect(states).toContain("open");
		expect(states).toContain("closed");

		unsub.unsubscribe();
		stateUnsub.unsubscribe();
	});

	it("tracks lifecycle status via withStatus", async () => {
		const ws = fromWebSocket("ws://localhost:8080");
		const unsub = subscribe(ws, () => {});

		// Before any message: pending
		expect(ws.status.get()).toBe("pending");

		await vi.waitFor(() => expect(ws.connectionState.get()).toBe("open"));

		// Send a message → status becomes active
		lastCreatedWs!.simulateMessage("hello");
		expect(ws.status.get()).toBe("active");

		unsub.unsubscribe();
		ws.close();
	});

	it("custom parse function", async () => {
		const ws = fromWebSocket("ws://localhost:8080", {
			parse: (data) => JSON.parse(data),
		});

		const values: any[] = [];
		const unsub = subscribe(ws, (v) => values.push(v));

		await vi.waitFor(() => expect(ws.connectionState.get()).toBe("open"));

		lastCreatedWs!.simulateMessage('{"key":"value"}');

		expect(values).toEqual([{ key: "value" }]);

		unsub.unsubscribe();
		ws.close();
	});

	it("send() forwards data to WebSocket", async () => {
		const ws = fromWebSocket("ws://localhost:8080");
		const unsub = subscribe(ws, () => {});

		await vi.waitFor(() => expect(ws.connectionState.get()).toBe("open"));

		ws.send("outgoing");
		expect(lastCreatedWs!.sent).toEqual(["outgoing"]);

		unsub.unsubscribe();
		ws.close();
	});

	it("close() disconnects the WebSocket", async () => {
		const ws = fromWebSocket("ws://localhost:8080");
		const unsub = subscribe(ws, () => {});

		await vi.waitFor(() => expect(ws.connectionState.get()).toBe("open"));

		ws.close(1000, "done");

		await vi.waitFor(() => expect(ws.connectionState.get()).toBe("closed"));

		unsub.unsubscribe();
	});

	it("get() returns undefined before any message", () => {
		const ws = fromWebSocket("ws://localhost:8080");
		expect(ws.get()).toBeUndefined();
		ws.close();
	});

	it("queues send() calls before connection opens", async () => {
		const ws = fromWebSocket("ws://localhost:8080");
		const unsub = subscribe(ws, () => {});

		// Send before open
		ws.send("queued-1");
		ws.send("queued-2");

		// Wait for connection to open — queue should flush
		await vi.waitFor(() => expect(ws.connectionState.get()).toBe("open"));

		expect(lastCreatedWs!.sent).toEqual(["queued-1", "queued-2"]);

		unsub.unsubscribe();
		ws.close();
	});

	it("parse error with default 'warn' skips message and continues", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const ws = fromWebSocket("ws://localhost:8080", {
			parse: (data) => JSON.parse(data),
		});

		const values: any[] = [];
		const unsub = subscribe(ws, (v) => values.push(v));

		await vi.waitFor(() => expect(ws.connectionState.get()).toBe("open"));

		// Send invalid JSON — should warn and skip
		lastCreatedWs!.simulateMessage("not-json{{{");
		// Send valid JSON — should still work
		lastCreatedWs!.simulateMessage('{"ok":true}');

		expect(values).toEqual([{ ok: true }]);
		expect(warnSpy).toHaveBeenCalledOnce();

		warnSpy.mockRestore();
		unsub.unsubscribe();
		ws.close();
	});

	it("parse error with 'error' mode terminates stream", async () => {
		const ws = fromWebSocket("ws://localhost:8080", {
			parse: (data) => JSON.parse(data),
			onParseError: "error",
		});

		const unsub = subscribe(ws, () => {});

		await vi.waitFor(() => expect(ws.connectionState.get()).toBe("open"));

		lastCreatedWs!.simulateMessage("bad-json");

		// withStatus should capture the error
		expect(ws.status.get()).toBe("errored");
		expect(ws.error.get()).toBeInstanceOf(SyntaxError);

		unsub.unsubscribe();
		ws.close();
	});

	it("parse error with 'skip' mode silently continues", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const ws = fromWebSocket("ws://localhost:8080", {
			parse: (data) => JSON.parse(data),
			onParseError: "skip",
		});

		const values: any[] = [];
		const unsub = subscribe(ws, (v) => values.push(v));

		await vi.waitFor(() => expect(ws.connectionState.get()).toBe("open"));

		lastCreatedWs!.simulateMessage("bad");
		lastCreatedWs!.simulateMessage('{"ok":1}');

		expect(values).toEqual([{ ok: 1 }]);
		expect(warnSpy).not.toHaveBeenCalled();

		warnSpy.mockRestore();
		unsub.unsubscribe();
		ws.close();
	});

	it("handles WebSocket constructor throwing", () => {
		// Replace mock with one that throws
		(globalThis as any).WebSocket = class {
			constructor() {
				throw new Error("Invalid URL");
			}
		};

		const ws = fromWebSocket("invalid://url");
		const unsub = subscribe(ws, () => {});

		expect(ws.connectionState.get()).toBe("closed");
		expect(ws.status.get()).toBe("errored");
		expect(ws.error.get()).toBeInstanceOf(Error);

		unsub.unsubscribe();
	});
});

// ==========================================================================
// toWebSocket
// ==========================================================================
describe("toWebSocket", () => {
	it("sends store values to a raw WebSocket", async () => {
		const mockWs = new MockWebSocket("ws://test");
		mockWs.readyState = MockWebSocket.OPEN;

		const source = state("initial");
		const unsub = toWebSocket(mockWs as any, source);

		source.set("hello");
		expect(mockWs.sent).toEqual(["hello"]);

		source.set("world");
		expect(mockWs.sent).toEqual(["hello", "world"]);

		unsub.unsubscribe();
	});

	it("serializes objects as JSON", async () => {
		const mockWs = new MockWebSocket("ws://test");
		mockWs.readyState = MockWebSocket.OPEN;

		const source = state<any>({});
		const unsub = toWebSocket(mockWs as any, source);

		source.set({ key: "value" });
		expect(mockWs.sent).toEqual(['{"key":"value"}']);

		unsub.unsubscribe();
	});

	it("custom serializer", async () => {
		const mockWs = new MockWebSocket("ws://test");
		mockWs.readyState = MockWebSocket.OPEN;

		const source = state(0);
		const unsub = toWebSocket(mockWs as any, source, {
			serialize: (v) => `num:${v}`,
		});

		source.set(42);
		expect(mockWs.sent).toEqual(["num:42"]);

		unsub.unsubscribe();
	});

	it("sends to WebSocketStore", async () => {
		const ws = fromWebSocket("ws://localhost:8080");
		const subUnsub = subscribe(ws, () => {});

		await vi.waitFor(() => expect(ws.connectionState.get()).toBe("open"));

		const source = state("test");
		const unsub = toWebSocket(ws, source);

		source.set("outbound");
		expect(lastCreatedWs!.sent).toEqual(["outbound"]);

		unsub.unsubscribe();
		subUnsub.unsubscribe();
		ws.close();
	});

	it("throws on invalid target", () => {
		const source = state(0);
		expect(() => toWebSocket({} as any, source)).toThrow(/invalid WebSocket target/);
	});
});
