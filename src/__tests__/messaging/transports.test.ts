import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TransportEnvelope } from "../../messaging/transportTypes";
import { wsMessageTransport } from "../../messaging/wsTransport";

class MockWs {
	static OPEN = 1;
	static instances: MockWs[] = [];
	readyState = 0;
	sent: string[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;

	constructor(_url: string, _protocols?: string | string[]) {
		MockWs.instances.push(this);
	}

	send(msg: string): void {
		this.sent.push(msg);
	}

	open(): void {
		this.readyState = MockWs.OPEN;
		this.onopen?.();
	}

	receive(msg: string): void {
		this.onmessage?.({ data: msg });
	}

	close(): void {
		this.readyState = 3;
		this.onclose?.();
	}
}

describe("transport adapters", () => {
	const originalWs = globalThis.WebSocket;

	beforeEach(() => {
		MockWs.instances = [];
		(globalThis as any).WebSocket = MockWs;
	});

	afterEach(() => {
		(globalThis as any).WebSocket = originalWs;
	});

	it("ws transport buffers while disconnected and flushes on open", () => {
		const transport = wsMessageTransport("ws://test", { reconnect: false, maxBufferSize: 2 });
		const ws = MockWs.instances[0];
		expect(ws).toBeDefined();

		transport.send({ type: "subscribe", topic: "a" });
		transport.send({ type: "subscribe", topic: "b" });
		transport.send({ type: "subscribe", topic: "c" });

		ws.open();
		expect(ws.sent).toHaveLength(2);
		expect(JSON.parse(ws.sent[0]) as TransportEnvelope).toMatchObject({
			type: "subscribe",
			topic: "b",
		});
		expect(JSON.parse(ws.sent[1]) as TransportEnvelope).toMatchObject({
			type: "subscribe",
			topic: "c",
		});

		transport.close();
		expect(transport.status.get()).toBe("disconnected");
	});

	it("ws transport dispatches parsed incoming envelopes", () => {
		const transport = wsMessageTransport("ws://test", { reconnect: false });
		const ws = MockWs.instances[0];
		const received: TransportEnvelope[] = [];
		transport.onMessage((e) => received.push(e));

		ws.open();
		ws.receive(JSON.stringify({ type: "ack", topic: "x", seq: 1 }));
		ws.receive("not-json");

		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({ type: "ack", topic: "x", seq: 1 });
		transport.close();
	});
});
