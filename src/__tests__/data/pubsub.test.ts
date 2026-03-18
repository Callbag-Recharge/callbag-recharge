import { describe, expect, it } from "vitest";
import { effect } from "../../core/effect";
import { pubsub } from "../../data/pubsub";

describe("pubsub", () => {
	it("publish and subscribe", () => {
		const bus = pubsub<string>();
		const store = bus.subscribe("chat");
		expect(store.get()).toBeUndefined();

		bus.publish("chat", "hello");
		expect(store.get()).toBe("hello");

		bus.publish("chat", "world");
		expect(store.get()).toBe("world");
		bus.destroy();
	});

	it("multiple topics are independent", () => {
		const bus = pubsub<number>();
		const a = bus.subscribe("a");
		const b = bus.subscribe("b");

		bus.publish("a", 1);
		bus.publish("b", 2);

		expect(a.get()).toBe(1);
		expect(b.get()).toBe(2);
		bus.destroy();
	});

	it("subscribe returns same store for same topic", () => {
		const bus = pubsub<string>();
		const s1 = bus.subscribe("x");
		const s2 = bus.subscribe("x");
		expect(s1).toBe(s2);
		bus.destroy();
	});

	it("topics() lists created topics", () => {
		const bus = pubsub();
		bus.subscribe("a");
		bus.publish("b", 1);
		expect(bus.topics().sort()).toEqual(["a", "b"]);
		bus.destroy();
	});

	it("reactive — effect fires on publish", () => {
		const bus = pubsub<string>();
		const store = bus.subscribe("events");
		const log: (string | undefined)[] = [];
		const dispose = effect([store], () => {
			log.push(store.get());
			return undefined;
		});

		bus.publish("events", "one");
		bus.publish("events", "two");

		expect(log).toEqual([undefined, "one", "two"]);
		dispose();
		bus.destroy();
	});

	it("always emits — same message triggers again", () => {
		const bus = pubsub<string>();
		const store = bus.subscribe("ch");
		const log: (string | undefined)[] = [];
		const dispose = effect([store], () => {
			log.push(store.get());
			return undefined;
		});

		bus.publish("ch", "dup");
		bus.publish("ch", "dup");

		expect(log).toEqual([undefined, "dup", "dup"]);
		dispose();
		bus.destroy();
	});

	it("destroy prevents further publishes and subscribe throws", () => {
		const bus = pubsub<string>();
		bus.subscribe("x");
		bus.publish("x", "before");
		bus.destroy();
		bus.publish("x", "after"); // no-op
		expect(() => bus.subscribe("y")).toThrow("PubSub is destroyed");
	});

	// --- NodeV0 ---

	it("auto-generates id", () => {
		const bus = pubsub();
		expect(bus.id).toMatch(/^pubsub-/);
		bus.destroy();
	});

	it("accepts custom id", () => {
		const bus = pubsub({ id: "my-bus" });
		expect(bus.id).toBe("my-bus");
		bus.destroy();
	});

	it("version increments on new topic creation", () => {
		const bus = pubsub<string>();
		expect(bus.version).toBe(0);

		bus.subscribe("a");
		expect(bus.version).toBe(1);

		bus.subscribe("a"); // same topic
		expect(bus.version).toBe(1);

		bus.publish("b", "x"); // new topic via publish
		expect(bus.version).toBe(2);

		bus.destroy();
	});

	it("snapshot() returns serializable representation", () => {
		const bus = pubsub<string>({ id: "snap-bus" });
		bus.publish("chat", "hello");
		bus.publish("alerts", "warn");

		const snap = bus.snapshot();
		expect(snap.type).toBe("pubsub");
		expect(snap.id).toBe("snap-bus");
		expect(snap.channels.chat).toBe("hello");
		expect(snap.channels.alerts).toBe("warn");

		const json = JSON.stringify(snap);
		const parsed = JSON.parse(json);
		expect(parsed.channels.chat).toBe("hello");

		bus.destroy();
	});

	// --- from() ---

	it("from() restores from snapshot", () => {
		const bus1 = pubsub<string>({ id: "bus-1" });
		bus1.publish("chat", "hello");
		bus1.publish("alerts", "warn");
		const snap = bus1.snapshot();
		bus1.destroy();

		const bus2 = pubsub.from(snap);
		expect(bus2.id).toBe("bus-1");
		expect(bus2.subscribe("chat").get()).toBe("hello");
		expect(bus2.subscribe("alerts").get()).toBe("warn");
		bus2.destroy();
	});

	it("subscribe returns read-only store (no .set method exposed via type)", () => {
		const bus = pubsub<string>();
		const store = bus.subscribe("x");
		// Store type does not expose .set — it's a read-only derived
		expect(typeof store.get).toBe("function");
		expect(typeof store.source).toBe("function");
		bus.destroy();
	});
});
