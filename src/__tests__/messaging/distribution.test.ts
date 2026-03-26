import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inspector } from "../../core/inspector";
import { state } from "../../core/state";
import type { Store } from "../../core/types";
import { inspectSubscription, listTopics, resetCursor } from "../../messaging/admin";
import { subscription } from "../../messaging/subscription";
import { topic } from "../../messaging/topic";
import { topicBridge } from "../../messaging/topicBridge";
import type {
	MessageFilter,
	MessageTransport,
	TransportEnvelope,
	TransportStatus,
} from "../../messaging/transportTypes";

// ---------------------------------------------------------------------------
// Mock transport — in-memory loopback for testing
// ---------------------------------------------------------------------------

function createMockTransportPair(): [MessageTransport, MessageTransport] {
	const statusA = state<TransportStatus>("connected");
	const statusB = state<TransportStatus>("connected");
	const handlersA = new Set<(e: TransportEnvelope) => void>();
	const handlersB = new Set<(e: TransportEnvelope) => void>();

	const transportA: MessageTransport = {
		send(envelope) {
			// Deliver to B's handlers
			for (const h of handlersB) h(envelope);
		},
		onMessage(handler) {
			handlersA.add(handler);
			return () => handlersA.delete(handler);
		},
		status: statusA as Store<TransportStatus>,
		close() {
			handlersA.clear();
			statusA.set("disconnected");
		},
	};

	const transportB: MessageTransport = {
		send(envelope) {
			// Deliver to A's handlers
			for (const h of handlersA) h(envelope);
		},
		onMessage(handler) {
			handlersB.add(handler);
			return () => handlersB.delete(handler);
		},
		status: statusB as Store<TransportStatus>,
		close() {
			handlersB.clear();
			statusB.set("disconnected");
		},
	};

	return [transportA, transportB];
}

// ---------------------------------------------------------------------------
// SA-2a: MessageTransport interface + TransportEnvelope types
// ---------------------------------------------------------------------------

describe("SA-2a: MessageTransport types", () => {
	it("mock transport pair delivers messages bidirectionally", () => {
		const [a, b] = createMockTransportPair();
		const receivedByA: TransportEnvelope[] = [];
		const receivedByB: TransportEnvelope[] = [];

		a.onMessage((e) => receivedByA.push(e));
		b.onMessage((e) => receivedByB.push(e));

		a.send({ type: "subscribe", topic: "test" });
		b.send({ type: "ack", topic: "test", seq: 1 });

		expect(receivedByB).toHaveLength(1);
		expect(receivedByB[0].type).toBe("subscribe");
		expect(receivedByA).toHaveLength(1);
		expect(receivedByA[0].type).toBe("ack");

		a.close();
		b.close();
	});

	it("transport status is reactive", () => {
		const [a, b] = createMockTransportPair();
		expect(a.status.get()).toBe("connected");
		a.close();
		expect(a.status.get()).toBe("disconnected");
		b.close();
	});
});

// ---------------------------------------------------------------------------
// SA-2d: topicBridge — bidirectional topic sync with echo-dedup
// ---------------------------------------------------------------------------

describe("SA-2d: topicBridge", () => {
	it("forwards local publishes to remote", () => {
		const [tA, tB] = createMockTransportPair();
		const localTopic = topic<string>("events");
		const remoteTopic = topic<string>("events");

		const bridgeA = topicBridge(tA, { events: { topic: localTopic } });
		const bridgeB = topicBridge(tB, { events: { topic: remoteTopic } });

		localTopic.publish("hello");

		// Remote topic should have received the message
		expect(remoteTopic.tailSeq).toBe(1);
		expect(remoteTopic.get(1)?.value).toBe("hello");

		bridgeA.destroy();
		bridgeB.destroy();
		localTopic.destroy();
		remoteTopic.destroy();
	});

	it("forwards remote publishes to local", () => {
		const [tA, tB] = createMockTransportPair();
		const localTopic = topic<string>("events");
		const remoteTopic = topic<string>("events");

		const bridgeA = topicBridge(tA, { events: { topic: localTopic } });
		const bridgeB = topicBridge(tB, { events: { topic: remoteTopic } });

		remoteTopic.publish("world");

		expect(localTopic.tailSeq).toBe(1);
		expect(localTopic.get(1)?.value).toBe("world");

		bridgeA.destroy();
		bridgeB.destroy();
		localTopic.destroy();
		remoteTopic.destroy();
	});

	it("echo-dedup prevents infinite loop", () => {
		const [tA, tB] = createMockTransportPair();
		const localTopic = topic<string>("events");
		const remoteTopic = topic<string>("events");

		const bridgeA = topicBridge(tA, { events: { topic: localTopic } });
		const bridgeB = topicBridge(tB, { events: { topic: remoteTopic } });

		localTopic.publish("msg");

		// localTopic: 1 original
		// remoteTopic: 1 forwarded from bridgeA
		// The forwarded message should NOT bounce back to localTopic
		expect(localTopic.tailSeq).toBe(1);
		expect(remoteTopic.tailSeq).toBe(1);

		bridgeA.destroy();
		bridgeB.destroy();
		localTopic.destroy();
		remoteTopic.destroy();
	});

	it("unique originId per bridge", () => {
		const [tA, tB] = createMockTransportPair();
		const t1 = topic<string>("a");
		const t2 = topic<string>("a");

		const b1 = topicBridge(tA, { a: { topic: t1 } });
		const b2 = topicBridge(tB, { a: { topic: t2 } });

		expect(b1.originId).not.toBe(b2.originId);

		b1.destroy();
		b2.destroy();
		t1.destroy();
		t2.destroy();
	});

	it("addTopic / removeTopic dynamic management", () => {
		const [tA, tB] = createMockTransportPair();
		const t1 = topic<string>("dynamic");
		const t2 = topic<string>("dynamic");

		const bridgeA = topicBridge(tA, {});
		const bridgeB = topicBridge(tB, {});

		// Initially no topics bridged
		t1.publish("before");
		expect(t2.tailSeq).toBe(0);

		// Add topic dynamically
		bridgeA.addTopic("dynamic", { topic: t1 });
		bridgeB.addTopic("dynamic", { topic: t2 });

		t1.publish("after");
		expect(t2.tailSeq).toBe(1);
		expect(t2.get(1)?.value).toBe("after");

		// Remove topic
		bridgeA.removeTopic("dynamic");
		t1.publish("removed");
		// t2 should NOT receive this
		expect(t2.tailSeq).toBe(1);

		bridgeA.destroy();
		bridgeB.destroy();
		t1.destroy();
		t2.destroy();
	});

	it("destroy cleans up all subscriptions", () => {
		const [tA, tB] = createMockTransportPair();
		const t = topic<string>("cleanup");

		const bridge = topicBridge(tA, { cleanup: { topic: t } });
		bridge.destroy();

		// Should not throw after destroy
		t.publish("after-destroy");
		expect(t.tailSeq).toBe(1);

		t.destroy();
		tB.close();
	});
});

// ---------------------------------------------------------------------------
// SA-2e: Message filtering
// ---------------------------------------------------------------------------

describe("SA-2e: message filtering", () => {
	it("filters by key", () => {
		const [tA, tB] = createMockTransportPair();
		const localTopic = topic<string>("filtered");
		const remoteTopic = topic<string>("filtered");

		const filter: MessageFilter<string> = { keys: ["important"] };

		const bridgeA = topicBridge(tA, { filtered: { topic: localTopic, filter } });
		const bridgeB = topicBridge(tB, { filtered: { topic: remoteTopic } });

		localTopic.publish("yes", { key: "important" });
		localTopic.publish("no", { key: "boring" });
		localTopic.publish("also-no");

		// Only the "important" key message should be forwarded
		expect(remoteTopic.tailSeq).toBe(1);
		expect(remoteTopic.get(1)?.value).toBe("yes");

		bridgeA.destroy();
		bridgeB.destroy();
		localTopic.destroy();
		remoteTopic.destroy();
	});

	it("filters by headers", () => {
		const [tA, tB] = createMockTransportPair();
		const local = topic<string>("hdr");
		const remote = topic<string>("hdr");

		const filter: MessageFilter<string> = {
			headers: { "x-priority": "high" },
		};

		const bA = topicBridge(tA, { hdr: { topic: local, filter } });
		const bB = topicBridge(tB, { hdr: { topic: remote } });

		local.publish("high", { headers: { "x-priority": "high" } });
		local.publish("low", { headers: { "x-priority": "low" } });

		expect(remote.tailSeq).toBe(1);
		expect(remote.get(1)?.value).toBe("high");

		bA.destroy();
		bB.destroy();
		local.destroy();
		remote.destroy();
	});

	it("filters by predicate", () => {
		const [tA, tB] = createMockTransportPair();
		const local = topic<number>("pred");
		const remote = topic<number>("pred");

		const filter: MessageFilter<number> = {
			predicate: (msg) => msg.value > 10,
		};

		const bA = topicBridge(tA, { pred: { topic: local, filter } });
		const bB = topicBridge(tB, { pred: { topic: remote } });

		local.publish(5);
		local.publish(15);
		local.publish(3);
		local.publish(20);

		expect(remote.tailSeq).toBe(2);
		expect(remote.get(1)?.value).toBe(15);
		expect(remote.get(2)?.value).toBe(20);

		bA.destroy();
		bB.destroy();
		local.destroy();
		remote.destroy();
	});
});

// ---------------------------------------------------------------------------
// SA-2f: Consumer lag + TTL
// ---------------------------------------------------------------------------

describe("SA-2f: topic TTL", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("expired messages trimmed on next publish", () => {
		const t = topic<string>("ttl", { ttl: 1000 });
		t.publish("old");
		vi.advanceTimersByTime(1500);
		// Expiry happens on next publish
		t.publish("new");
		expect(t.get(1)).toBeUndefined(); // trimmed
		expect(t.get(2)?.value).toBe("new");
		expect(t.depth.get()).toBe(1);
		t.destroy();
	});

	it("slice() returns only non-expired messages after publish-time expiry", () => {
		const t = topic<string>("ttl-slice", { ttl: 1000 });
		t.publish("old");
		vi.advanceTimersByTime(500);
		t.publish("mid");
		vi.advanceTimersByTime(600); // old=1100ms (expired), mid=600ms (valid)
		// Trigger expiry via publish
		t.publish("new");

		const msgs = t.slice();
		expect(msgs).toHaveLength(2);
		expect(msgs[0].value).toBe("mid");
		expect(msgs[1].value).toBe("new");
		t.destroy();
	});

	it("peek() returns oldest non-expired message after expiry", () => {
		const t = topic<string>("ttl-peek", { ttl: 1000 });
		t.publish("expired");
		vi.advanceTimersByTime(500);
		t.publish("valid");
		vi.advanceTimersByTime(600);
		// Trigger expiry
		t.publish("newest");

		const peeked = t.peek();
		expect(peeked?.value).toBe("valid");
		t.destroy();
	});

	it("expireMessages() returns count of expired messages", () => {
		const t = topic<string>("ttl-expire", { ttl: 1000 });
		t.publish("a");
		t.publish("b");
		vi.advanceTimersByTime(500);
		t.publish("c");
		vi.advanceTimersByTime(600);

		const expired = t.expireMessages();
		expect(expired).toBe(2); // a and b expired
		t.destroy();
	});

	it("expireMessages() clears log when all messages expired", () => {
		const t = topic<string>("ttl-clear", { ttl: 500 });
		t.publish("a");
		t.publish("b");
		vi.advanceTimersByTime(600);

		const expired = t.expireMessages();
		expect(expired).toBe(2);
		expect(t.depth.get()).toBe(0);
		t.destroy();
	});

	it("no TTL means no expiry", () => {
		const t = topic<string>("no-ttl");
		t.publish("forever");
		vi.advanceTimersByTime(999_999);
		expect(t.get(1)?.value).toBe("forever");
		t.destroy();
	});
});

describe("SA-2f: subscription consumer lag", () => {
	it("lag is 0 when caught up", () => {
		const t = topic<string>("lag-test");
		const sub = subscription(t, { initialPosition: "earliest" });
		Inspector.activate(sub.lag);

		expect(sub.lag.get()).toBe(0);

		sub.destroy();
		t.destroy();
	});

	it("lag reflects time since oldest unread message", () => {
		vi.useFakeTimers();
		const t = topic<string>("lag-time");
		t.publish("msg1");
		vi.advanceTimersByTime(500);

		const sub = subscription(t, { initialPosition: "earliest" });
		Inspector.activate(sub.lag);

		// Force lag re-derivation by reading it
		const lag = sub.lag.get();
		expect(lag).toBeGreaterThanOrEqual(500);

		sub.destroy();
		t.destroy();
		vi.useRealTimers();
	});

	it("lag drops to 0 after consuming all messages", () => {
		vi.useFakeTimers();
		const t = topic<string>("lag-consume");
		t.publish("msg1");
		vi.advanceTimersByTime(100);

		const sub = subscription(t, { initialPosition: "earliest" });
		Inspector.activate(sub.lag);

		const msgs = sub.pull();
		for (const m of msgs) sub.ack(m.seq);

		expect(sub.lag.get()).toBe(0);

		sub.destroy();
		t.destroy();
		vi.useRealTimers();
	});
});

// ---------------------------------------------------------------------------
// SA-2g: Admin API
// ---------------------------------------------------------------------------

describe("SA-2g: admin API", () => {
	it("listTopics returns info for all topics", () => {
		const t1 = topic<string>("admin-a");
		const t2 = topic<number>("admin-b");
		t1.publish("hello");
		t2.publish(42);
		t2.publish(43);

		const info = listTopics({ a: t1, b: t2 });
		expect(info).toHaveLength(2);

		const infoA = info.find((i) => i.name === "admin-a")!;
		expect(infoA.depth).toBe(1);
		expect(infoA.headSeq).toBe(1);
		expect(infoA.tailSeq).toBe(1);
		expect(infoA.paused).toBe(false);
		expect(infoA.publishCount).toBe(1);

		const infoB = info.find((i) => i.name === "admin-b")!;
		expect(infoB.depth).toBe(2);
		expect(infoB.publishCount).toBe(2);

		t1.destroy();
		t2.destroy();
	});

	it("listTopics accepts array", () => {
		const t = topic<string>("arr");
		t.publish("x");
		const info = listTopics([t]);
		expect(info).toHaveLength(1);
		expect(info[0].name).toBe("arr");
		t.destroy();
	});

	it("inspectSubscription returns subscription state", () => {
		const t = topic<string>("inspect");
		t.publish("a");
		t.publish("b");

		const sub = subscription(t, { initialPosition: "earliest" });
		Inspector.activate(sub.lag);

		const info = inspectSubscription(sub);
		expect(info.name).toBe(sub.name);
		expect(info.mode).toBe("exclusive");
		expect(info.backlog).toBe(2);
		expect(info.pending).toBe(0);
		expect(info.paused).toBe(false);

		sub.destroy();
		t.destroy();
	});

	it("resetCursor seeks subscription to new position", () => {
		const t = topic<string>("reset");
		t.publish("a");
		t.publish("b");
		t.publish("c");

		const sub = subscription(t, { initialPosition: "latest" });
		expect(sub.position.get()).toBe(4); // past tail

		resetCursor(sub, "earliest");
		expect(sub.position.get()).toBe(1);

		resetCursor(sub, 2);
		expect(sub.position.get()).toBe(2);

		sub.destroy();
		t.destroy();
	});
});

// ---------------------------------------------------------------------------
// SA-2h: Backpressure signaling
// ---------------------------------------------------------------------------

describe("SA-2h: backpressure signaling", () => {
	it("backpressure store updates on envelope", () => {
		const [tA, tB] = createMockTransportPair();
		const t = topic<string>("bp");

		const bridge = topicBridge(tA, { bp: { topic: t } });

		// Simulate remote sending backpressure signal
		tB.send({
			type: "backpressure",
			topic: "bp",
			lagging: true,
		});

		const bpStore = bridge.backpressure.get("bp");
		expect(bpStore).toBeDefined();
		expect(bpStore!.get()).toBe(true);

		// Recovery
		tB.send({
			type: "backpressure",
			topic: "bp",
			lagging: false,
		});
		expect(bpStore!.get()).toBe(false);

		bridge.destroy();
		t.destroy();
		tB.close();
	});
});
