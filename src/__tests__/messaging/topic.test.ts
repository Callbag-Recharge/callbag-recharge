import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inspector } from "../../core/inspector";
import { topic } from "../../messaging/topic";
import { namespace } from "../../utils/namespace";

describe("topic", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// -----------------------------------------------------------------------
	// 5e-1: Basic topic
	// -----------------------------------------------------------------------

	describe("basic publish/read", () => {
		it("publishes a message and assigns a sequence number", () => {
			const t = topic<string>("test");
			const seq = t.publish("hello");
			expect(seq).toBe(1);
			expect(t.tailSeq).toBe(1);
			expect(t.headSeq).toBe(1);
			t.destroy();
		});

		it("publishes multiple messages with increasing seq", () => {
			const t = topic<number>("multi");
			const s1 = t.publish(10);
			const s2 = t.publish(20);
			const s3 = t.publish(30);
			expect(s1).toBe(1);
			expect(s2).toBe(2);
			expect(s3).toBe(3);
			expect(t.tailSeq).toBe(3);
			t.destroy();
		});

		it("reads a message by sequence number", () => {
			const t = topic<string>("read");
			t.publish("a");
			t.publish("b");
			const msg = t.get(2);
			expect(msg).toBeDefined();
			expect(msg!.seq).toBe(2);
			expect(msg!.value).toBe("b");
			expect(msg!.timestamp).toBeGreaterThan(0);
			t.destroy();
		});

		it("returns undefined for non-existent seq", () => {
			const t = topic<string>("miss");
			t.publish("a");
			expect(t.get(99)).toBeUndefined();
			t.destroy();
		});

		it("slices a range of messages", () => {
			const t = topic<number>("slice");
			t.publish(1);
			t.publish(2);
			t.publish(3);
			t.publish(4);
			const msgs = t.slice(2, 3);
			expect(msgs).toHaveLength(2);
			expect(msgs[0].value).toBe(2);
			expect(msgs[1].value).toBe(3);
			t.destroy();
		});

		it("slices all messages when no args", () => {
			const t = topic<number>("slice-all");
			t.publish(1);
			t.publish(2);
			const msgs = t.slice();
			expect(msgs).toHaveLength(2);
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Message envelope
	// -----------------------------------------------------------------------

	describe("message envelope", () => {
		it("includes key, priority, and headers", () => {
			const t = topic<string>("envelope");
			t.publish("msg", {
				key: "partition-1",
				priority: 5,
				headers: { "x-trace": "abc" },
			});
			const msg = t.get(1)!;
			expect(msg.key).toBe("partition-1");
			expect(msg.priority).toBe(5);
			expect(msg.headers).toEqual({ "x-trace": "abc" });
			t.destroy();
		});

		it("timestamp is set automatically", () => {
			const now = Date.now();
			const t = topic<string>("ts");
			t.publish("x");
			const msg = t.get(1)!;
			expect(msg.timestamp).toBeGreaterThanOrEqual(now);
			expect(msg.timestamp).toBeLessThanOrEqual(now + 100);
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Bounded buffer (maxSize)
	// -----------------------------------------------------------------------

	describe("bounded buffer", () => {
		it("trims oldest messages when maxSize exceeded", () => {
			const t = topic<number>("bounded", { maxSize: 3 });
			t.publish(1);
			t.publish(2);
			t.publish(3);
			t.publish(4); // evicts 1
			expect(t.get(1)).toBeUndefined();
			expect(t.get(2)!.value).toBe(2);
			expect(t.get(4)!.value).toBe(4);
			expect(t.headSeq).toBe(2);
			expect(t.tailSeq).toBe(4);
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Schema validation
	// -----------------------------------------------------------------------

	describe("schema validation", () => {
		it("validates messages at publish time", () => {
			const schema = {
				parse(v: unknown): { id: string } {
					if (typeof v !== "object" || v === null || !("id" in v)) {
						throw new Error("Invalid message");
					}
					return v as { id: string };
				},
			};
			const t = topic<{ id: string }>("schema", { schema });
			const seq = t.publish({ id: "valid" });
			expect(seq).toBe(1);
			expect(() => t.publish({} as any)).toThrow("Invalid message");
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Dedup
	// -----------------------------------------------------------------------

	describe("dedup", () => {
		it("drops duplicate dedupKeys within window", () => {
			const t = topic<string>("dedup", { dedup: { windowMs: 60_000 } });
			const s1 = t.publish("a", { dedupKey: "key-1" });
			const s2 = t.publish("b", { dedupKey: "key-1" }); // duplicate
			const s3 = t.publish("c", { dedupKey: "key-2" }); // different key
			expect(s1).toBe(1);
			expect(s2).toBe(-1); // dropped
			expect(s3).toBe(2);
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Delayed messages
	// -----------------------------------------------------------------------

	describe("delayed messages", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		it("publishes message after delay", () => {
			const t = topic<string>("delay");
			const seq = t.publish("delayed", { delay: 1000 });
			expect(seq).toBe(-1); // no immediate seq
			expect(t.tailSeq).toBe(0);

			vi.advanceTimersByTime(1000);
			expect(t.tailSeq).toBe(1);
			expect(t.get(1)!.value).toBe("delayed");
			t.destroy();
		});

		it("cancels delayed messages on destroy", () => {
			const t = topic<string>("delay-cancel");
			t.publish("will-be-cancelled", { delay: 5000 });
			t.destroy();
			vi.advanceTimersByTime(5000);
			// No error, message was not published
		});
	});

	// -----------------------------------------------------------------------
	// Namespace
	// -----------------------------------------------------------------------

	describe("namespace", () => {
		it("prefixes topic name with namespace", () => {
			const ns = namespace("tenant-a");
			const t = topic<string>("orders", { namespace: ns });
			expect(t.name).toBe("tenant-a/orders");
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Compaction
	// -----------------------------------------------------------------------

	describe("compaction", () => {
		it("retains only latest entry per key on auto-compact", () => {
			const t = topic<{ id: string; v: number }>("compact", {
				compaction: {
					keyFn: (msg) => msg.id,
					threshold: 5,
				},
			});
			t.publish({ id: "a", v: 1 });
			t.publish({ id: "b", v: 2 });
			t.publish({ id: "a", v: 3 });
			t.publish({ id: "c", v: 4 });
			t.publish({ id: "a", v: 5 }); // triggers compaction at threshold=5

			// After compaction: a(v=5), b(v=2), c(v=4)
			const msgs = t.slice();
			expect(msgs).toHaveLength(3);
			const values = msgs.map((m) => m.value);
			expect(values).toContainEqual({ id: "a", v: 5 });
			expect(values).toContainEqual({ id: "b", v: 2 });
			expect(values).toContainEqual({ id: "c", v: 4 });
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Companion stores (5e-3)
	// -----------------------------------------------------------------------

	describe("companion stores", () => {
		it("depth reflects message count", () => {
			const t = topic<number>("depth");
			expect(t.depth.get()).toBe(0);
			t.publish(1);
			expect(t.depth.get()).toBe(1);
			t.publish(2);
			expect(t.depth.get()).toBe(2);
			t.destroy();
		});

		it("latest reflects most recent message", () => {
			const t = topic<string>("latest");
			expect(t.latest.get()).toBeUndefined();
			t.publish("first");
			expect(t.latest.get()!.value).toBe("first");
			t.publish("second");
			expect(t.latest.get()!.value).toBe("second");
			t.destroy();
		});

		it("publishCount tracks total publishes", () => {
			const t = topic<number>("pubcount");
			const dispose = Inspector.activate(t.publishCount);
			t.publish(1);
			t.publish(2);
			expect(t.publishCount.get()).toBe(2);
			dispose();
			t.destroy();
		});

		it("depth is reactive", () => {
			const t = topic<number>("depth-reactive");
			const obs = Inspector.observe(t.depth);
			t.publish(1);
			t.publish(2);
			expect(obs.values).toContain(1);
			expect(obs.values).toContain(2);
			obs.dispose();
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Lifecycle (5e-3)
	// -----------------------------------------------------------------------

	describe("lifecycle", () => {
		it("peek returns oldest message without consuming", () => {
			const t = topic<number>("peek");
			t.publish(10);
			t.publish(20);
			const peeked = t.peek();
			expect(peeked!.value).toBe(10);
			expect(peeked!.seq).toBe(1);
			// Still there
			expect(t.get(1)!.value).toBe(10);
			t.destroy();
		});

		it("peek returns undefined on empty topic", () => {
			const t = topic<number>("peek-empty");
			expect(t.peek()).toBeUndefined();
			t.destroy();
		});

		it("pause drops messages", () => {
			const t = topic<string>("pause");
			t.publish("before");
			t.pause();
			expect(t.paused).toBe(true);
			const seq = t.publish("during-pause");
			expect(seq).toBe(-1);
			t.resume();
			expect(t.paused).toBe(false);
			t.publish("after");
			expect(t.slice()).toHaveLength(2);
			t.destroy();
		});

		it("destroy prevents further publishes", () => {
			const t = topic<string>("destroy");
			t.publish("before");
			t.destroy();
			const seq = t.publish("after");
			expect(seq).toBe(-1);
		});
	});

	// -----------------------------------------------------------------------
	// NodeV0 interface
	// -----------------------------------------------------------------------

	describe("NodeV0", () => {
		it("has id and version", () => {
			const t = topic<string>("node");
			expect(t.id).toContain("topic-node");
			expect(t.version).toBe(0);
			t.publish("bump");
			expect(t.version).toBe(1);
			t.destroy();
		});
	});
});
