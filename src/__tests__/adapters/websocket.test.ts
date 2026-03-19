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
		const unsub = subscribe(ws.messages, (v) => values.push(v));

		// Wait for connection
		await vi.waitFor(() => expect(ws.status.get()).toBe("open"));

		lastCreatedWs!.simulateMessage("hello");
		lastCreatedWs!.simulateMessage("world");

		expect(values).toEqual(["hello", "world"]);

		unsub();
		ws.close();
	});

	it("tracks connection status", async () => {
		const ws = fromWebSocket("ws://localhost:8080");
		const statuses: string[] = [];
		const unsub = subscribe(ws.messages, () => {});
		const statusUnsub = subscribe(ws.status, (s) => statuses.push(s));

		// Initially connecting, then open
		await vi.waitFor(() => expect(ws.status.get()).toBe("open"));

		ws.close();
		await vi.waitFor(() => expect(ws.status.get()).toBe("closed"));

		expect(statuses).toContain("open");
		expect(statuses).toContain("closed");

		unsub();
		statusUnsub();
	});

	it("custom parse function", async () => {
		const ws = fromWebSocket("ws://localhost:8080", {
			parse: (data) => JSON.parse(data),
		});

		const values: any[] = [];
		const unsub = subscribe(ws.messages, (v) => values.push(v));

		await vi.waitFor(() => expect(ws.status.get()).toBe("open"));

		lastCreatedWs!.simulateMessage('{"key":"value"}');

		expect(values).toEqual([{ key: "value" }]);

		unsub();
		ws.close();
	});

	it("send() forwards data to WebSocket", async () => {
		const ws = fromWebSocket("ws://localhost:8080");
		const unsub = subscribe(ws.messages, () => {});

		await vi.waitFor(() => expect(ws.status.get()).toBe("open"));

		ws.send("outgoing");
		expect(lastCreatedWs!.sent).toEqual(["outgoing"]);

		unsub();
		ws.close();
	});

	it("close() disconnects the WebSocket", async () => {
		const ws = fromWebSocket("ws://localhost:8080");
		const unsub = subscribe(ws.messages, () => {});

		await vi.waitFor(() => expect(ws.status.get()).toBe("open"));

		ws.close(1000, "done");

		await vi.waitFor(() => expect(ws.status.get()).toBe("closed"));

		unsub();
	});

	it("get() returns undefined before any message", () => {
		const ws = fromWebSocket("ws://localhost:8080");
		expect(ws.messages.get()).toBeUndefined();
		ws.close();
	});

	it("queues send() calls before connection opens", async () => {
		const ws = fromWebSocket("ws://localhost:8080");
		const unsub = subscribe(ws.messages, () => {});

		// Send before open
		ws.send("queued-1");
		ws.send("queued-2");

		// Wait for connection to open — queue should flush
		await vi.waitFor(() => expect(ws.status.get()).toBe("open"));

		expect(lastCreatedWs!.sent).toEqual(["queued-1", "queued-2"]);

		unsub();
		ws.close();
	});

	it("parse error with default 'warn' skips message and continues", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const ws = fromWebSocket("ws://localhost:8080", {
			parse: (data) => JSON.parse(data),
		});

		const values: any[] = [];
		let ended = false;
		const unsub = subscribe(ws.messages, (v) => values.push(v), {
			onEnd: () => {
				ended = true;
			},
		});

		await vi.waitFor(() => expect(ws.status.get()).toBe("open"));

		// Send invalid JSON — should warn and skip
		lastCreatedWs!.simulateMessage("not-json{{{");
		// Send valid JSON — should still work
		lastCreatedWs!.simulateMessage('{"ok":true}');

		expect(values).toEqual([{ ok: true }]);
		expect(ended).toBe(false); // stream continues
		expect(warnSpy).toHaveBeenCalledOnce();

		warnSpy.mockRestore();
		unsub();
		ws.close();
	});

	it("parse error with 'error' mode terminates stream", async () => {
		const ws = fromWebSocket("ws://localhost:8080", {
			parse: (data) => JSON.parse(data),
			onParseError: "error",
		});

		let endError: unknown;
		const unsub = subscribe(ws.messages, () => {}, {
			onEnd: (err) => {
				endError = err;
			},
		});

		await vi.waitFor(() => expect(ws.status.get()).toBe("open"));

		lastCreatedWs!.simulateMessage("bad-json");
		expect(endError).toBeInstanceOf(SyntaxError);

		unsub();
		ws.close();
	});

	it("parse error with 'skip' mode silently continues", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const ws = fromWebSocket("ws://localhost:8080", {
			parse: (data) => JSON.parse(data),
			onParseError: "skip",
		});

		const values: any[] = [];
		const unsub = subscribe(ws.messages, (v) => values.push(v));

		await vi.waitFor(() => expect(ws.status.get()).toBe("open"));

		lastCreatedWs!.simulateMessage("bad");
		lastCreatedWs!.simulateMessage('{"ok":1}');

		expect(values).toEqual([{ ok: 1 }]);
		expect(warnSpy).not.toHaveBeenCalled();

		warnSpy.mockRestore();
		unsub();
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
		let endError: unknown;
		const unsub = subscribe(ws.messages, () => {}, {
			onEnd: (err) => {
				endError = err;
			},
		});

		expect(ws.status.get()).toBe("closed");
		expect(endError).toBeInstanceOf(Error);

		unsub();
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

		unsub();
	});

	it("serializes objects as JSON", async () => {
		const mockWs = new MockWebSocket("ws://test");
		mockWs.readyState = MockWebSocket.OPEN;

		const source = state<any>({});
		const unsub = toWebSocket(mockWs as any, source);

		source.set({ key: "value" });
		expect(mockWs.sent).toEqual(['{"key":"value"}']);

		unsub();
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

		unsub();
	});

	it("sends to WebSocketStore", async () => {
		const ws = fromWebSocket("ws://localhost:8080");
		const subUnsub = subscribe(ws.messages, () => {});

		await vi.waitFor(() => expect(ws.status.get()).toBe("open"));

		const source = state("test");
		const unsub = toWebSocket(ws, source);

		source.set("outbound");
		expect(lastCreatedWs!.sent).toEqual(["outbound"]);

		unsub();
		subUnsub();
		ws.close();
	});

	it("throws on invalid target", () => {
		const source = state(0);
		expect(() => toWebSocket({} as any, source)).toThrow(/invalid WebSocket target/);
	});
});
