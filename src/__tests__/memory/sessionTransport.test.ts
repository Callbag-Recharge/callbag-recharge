import { afterEach, describe, expect, it, vi } from "vitest";
import { collection } from "../../memory/collection";
import { httpTransport } from "../../memory/httpTransport";
import { sessionSync } from "../../memory/sessionSync";
import type { SessionEvent, SessionTransport } from "../../memory/types";
import { wsTransport } from "../../memory/wsTransport";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mock transport that records all events sent. */
function mockTransport<T = unknown>(): SessionTransport<T> & {
	events: SessionEvent<T>[];
	closed: boolean;
} {
	const mock = {
		events: [] as SessionEvent<T>[],
		closed: false,
		send(event: SessionEvent<T>) {
			mock.events.push(structuredClone(event));
		},
		close() {
			mock.closed = true;
		},
	};
	return mock;
}

// ---------------------------------------------------------------------------
// sessionSync
// ---------------------------------------------------------------------------
describe("sessionSync — collection-to-transport wiring", () => {
	it("sends initial snapshot on connect", () => {
		const col = collection<string>();
		col.add("hello", { id: "n1", tags: ["greet"] });
		col.add("world", { id: "n2" });

		const transport = mockTransport<string>();
		const { dispose } = sessionSync(col, transport);

		expect(transport.events.length).toBe(1);
		expect(transport.events[0].type).toBe("snapshot");

		const snap = transport.events[0] as Extract<SessionEvent<string>, { type: "snapshot" }>;
		expect(snap.nodes.length).toBe(2);

		const n1 = snap.nodes.find((n) => n.id === "n1")!;
		expect(n1.content).toBe("hello");
		expect(n1.meta.tags).toEqual(["greet"]);

		dispose();
		col.destroy();
	});

	it("skips initial snapshot when initialSnapshot: false", () => {
		const col = collection<string>();
		col.add("existing", { id: "n1" });

		const transport = mockTransport<string>();
		const { dispose } = sessionSync(col, transport, { initialSnapshot: false });

		// No snapshot event — first emission produces no diff (no previous state)
		expect(transport.events.length).toBe(0);

		dispose();
		col.destroy();
	});

	it("detects added nodes", () => {
		const col = collection<string>();

		const transport = mockTransport<string>();
		const { dispose } = sessionSync(col, transport);

		// Initial snapshot (empty)
		expect(transport.events.length).toBe(1);
		expect(transport.events[0].type).toBe("snapshot");

		col.add("new node", { id: "a1" });

		const addEvent = transport.events.find((e) => e.type === "add");
		expect(addEvent).toBeDefined();
		const add = addEvent as Extract<SessionEvent<string>, { type: "add" }>;
		expect(add.nodes.length).toBe(1);
		expect(add.nodes[0].id).toBe("a1");
		expect(add.nodes[0].content).toBe("new node");

		dispose();
		col.destroy();
	});

	it("detects removed nodes", () => {
		const col = collection<string>();
		col.add("temp", { id: "r1" });

		const transport = mockTransport<string>();
		const { dispose } = sessionSync(col, transport);

		col.remove("r1");

		const removeEvent = transport.events.find((e) => e.type === "remove");
		expect(removeEvent).toBeDefined();
		const rm = removeEvent as Extract<SessionEvent<string>, { type: "remove" }>;
		expect(rm.nodeIds).toEqual(["r1"]);

		dispose();
		col.destroy();
	});

	it("detects updated nodes (content change via node.update)", () => {
		const col = collection<string>();
		const node = col.add("original", { id: "u1" })!;

		const transport = mockTransport<string>();
		const { dispose } = sessionSync(col, transport);

		// node.update bumps updatedAt and triggers per-node meta subscription
		node.update("modified");

		const updateEvent = transport.events.find((e) => e.type === "update");
		expect(updateEvent).toBeDefined();
		const upd = updateEvent as Extract<SessionEvent<string>, { type: "update" }>;
		expect(upd.nodes.length).toBe(1);
		expect(upd.nodes[0].id).toBe("u1");
		expect(upd.nodes[0].content).toBe("modified");

		dispose();
		col.destroy();
	});

	it("dispose() unsubscribes but does not close transport", () => {
		const col = collection<string>();
		const transport = mockTransport<string>();
		const { dispose } = sessionSync(col, transport);

		dispose();
		// Transport is NOT closed — caller manages lifecycle
		expect(transport.closed).toBe(false);

		// Further changes should not produce events
		const countBefore = transport.events.length;
		col.add("ignored", { id: "x1" });
		expect(transport.events.length).toBe(countBefore);

		transport.close();
		col.destroy();
	});

	it("dispose() is idempotent", () => {
		const col = collection<string>();
		const transport = mockTransport<string>();
		const { dispose } = sessionSync(col, transport);

		dispose();
		dispose(); // second call is a no-op
		expect(transport.events.length).toBe(1); // only snapshot

		col.destroy();
	});

	it("handles add + remove in sequence", () => {
		const col = collection<string>();
		const transport = mockTransport<string>();
		const { dispose } = sessionSync(col, transport);

		col.add("a", { id: "seq1" });
		col.add("b", { id: "seq2" });
		col.remove("seq1");

		const addEvents = transport.events.filter((e) => e.type === "add");
		const removeEvents = transport.events.filter((e) => e.type === "remove");
		expect(addEvents.length).toBe(2);
		expect(removeEvents.length).toBe(1);

		dispose();
		col.destroy();
	});

	it("serializes meta correctly (Set<string> tags → string[])", () => {
		const col = collection<string>();
		col.add("tagged", { id: "t1", tags: ["a", "b", "c"], importance: 0.9 });

		const transport = mockTransport<string>();
		const { dispose } = sessionSync(col, transport);

		const snap = transport.events[0] as Extract<SessionEvent<string>, { type: "snapshot" }>;
		const node = snap.nodes[0];
		expect(Array.isArray(node.meta.tags)).toBe(true);
		expect(node.meta.tags).toEqual(expect.arrayContaining(["a", "b", "c"]));
		expect(node.meta.importance).toBe(0.9);
		expect(typeof node.meta.createdAt).toBe("number");

		dispose();
		col.destroy();
	});
});

// ---------------------------------------------------------------------------
// wsTransport
// ---------------------------------------------------------------------------
describe("wsTransport — WebSocket SessionTransport", () => {
	function mockWebSocket() {
		const sent: string[] = [];
		return {
			send(data: string) {
				sent.push(data);
			},
			close: vi.fn(),
			_sent: sent,
		} as unknown as WebSocket & { _sent: string[]; close: ReturnType<typeof vi.fn> };
	}

	it("sends serialized event via ws.send()", () => {
		const ws = mockWebSocket();
		const transport = wsTransport(ws);

		const event: SessionEvent = { type: "snapshot", nodes: [] };
		transport.send(event);

		expect(ws._sent.length).toBe(1);
		expect(JSON.parse(ws._sent[0])).toEqual(event);
	});

	it("uses custom serializer", () => {
		const ws = mockWebSocket();
		const transport = wsTransport(ws, {
			serialize: () => "custom",
		});

		transport.send({ type: "snapshot", nodes: [] });
		expect(ws._sent[0]).toBe("custom");
	});

	it("silently drops on send error", () => {
		const ws = {
			send() {
				throw new Error("not open");
			},
			close: vi.fn(),
		} as unknown as WebSocket;

		const transport = wsTransport(ws);
		// Should not throw
		expect(() => transport.send({ type: "snapshot", nodes: [] })).not.toThrow();
	});

	it("close() calls ws.close()", () => {
		const ws = mockWebSocket();
		const transport = wsTransport(ws);

		transport.close();
		expect(ws.close).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// httpTransport
// ---------------------------------------------------------------------------
describe("httpTransport — HTTP SessionTransport", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("sends event immediately when batchMs = 0 (default)", () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());

		const transport = httpTransport("https://example.com/sessions");
		transport.send({ type: "snapshot", nodes: [] });

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe("https://example.com/sessions");
		expect(init!.method).toBe("POST");
		expect(JSON.parse(init!.body as string)).toEqual([{ type: "snapshot", nodes: [] }]);

		transport.close();
	});

	it("sends custom headers", () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());

		const transport = httpTransport("https://example.com/sessions", {
			headers: { Authorization: "Bearer tok" },
		});
		transport.send({ type: "snapshot", nodes: [] });

		const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer tok");
		expect(headers["Content-Type"]).toBe("application/json");

		transport.close();
	});

	it("batches events when batchMs > 0", () => {
		vi.useFakeTimers();
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());

		const transport = httpTransport("https://example.com/sessions", { batchMs: 100 });

		transport.send({ type: "add", nodes: [{ id: "a", content: 1, meta: {} as any }] });
		transport.send({ type: "remove", nodeIds: ["b"] });

		// Not yet flushed
		expect(fetchSpy).not.toHaveBeenCalled();

		vi.advanceTimersByTime(100);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
		expect(body.length).toBe(2);
		expect(body[0].type).toBe("add");
		expect(body[1].type).toBe("remove");

		transport.close();
	});

	it("flushes remaining events on close()", () => {
		vi.useFakeTimers();
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());

		const transport = httpTransport("https://example.com/sessions", { batchMs: 1000 });
		transport.send({ type: "snapshot", nodes: [] });

		// Close before timer fires
		transport.close();

		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("ignores sends after close()", () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());

		const transport = httpTransport("https://example.com/sessions");
		transport.close();
		transport.send({ type: "snapshot", nodes: [] });

		// close() flushes empty batch (no-op), then send is ignored
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
