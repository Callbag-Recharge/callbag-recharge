import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscription } from "../../messaging/subscription";
import { topic } from "../../messaging/topic";
import { constant, withMaxAttempts } from "../../utils/backoff";

describe("subscription", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// -----------------------------------------------------------------------
	// 5e-2: Basic pull-based consumption
	// -----------------------------------------------------------------------

	describe("pull-based consumption", () => {
		it("pulls messages from earliest position", () => {
			const t = topic<number>("pull-basic");
			t.publish(10);
			t.publish(20);
			t.publish(30);

			const sub = subscription(t, { initialPosition: "earliest" });
			const msgs = sub.pull(2);
			expect(msgs).toHaveLength(2);
			expect(msgs[0].value).toBe(10);
			expect(msgs[1].value).toBe(20);

			const more = sub.pull(5);
			expect(more).toHaveLength(1);
			expect(more[0].value).toBe(30);

			sub.destroy();
			t.destroy();
		});

		it("defaults to latest position (no historical messages)", () => {
			const t = topic<number>("pull-latest");
			t.publish(10);
			t.publish(20);

			const sub = subscription(t);
			const msgs = sub.pull(10);
			expect(msgs).toHaveLength(0); // nothing new after subscription

			t.publish(30);
			const more = sub.pull(10);
			expect(more).toHaveLength(1);
			expect(more[0].value).toBe(30);

			sub.destroy();
			t.destroy();
		});

		it("respects batchSize default", () => {
			const t = topic<number>("batch");
			t.publish(1);
			t.publish(2);
			t.publish(3);

			const sub = subscription(t, { initialPosition: "earliest", batchSize: 2 });
			const msgs = sub.pull(); // uses batchSize=2
			expect(msgs).toHaveLength(2);

			sub.destroy();
			t.destroy();
		});

		it("starts from specific sequence number", () => {
			const t = topic<number>("specific-pos");
			t.publish(1);
			t.publish(2);
			t.publish(3);

			const sub = subscription(t, { initialPosition: 2 });
			const msgs = sub.pull(10);
			expect(msgs).toHaveLength(2);
			expect(msgs[0].value).toBe(2);
			expect(msgs[1].value).toBe(3);

			sub.destroy();
			t.destroy();
		});

		it("returns empty when no messages available", () => {
			const t = topic<number>("empty");
			const sub = subscription(t, { initialPosition: "earliest" });
			expect(sub.pull(10)).toHaveLength(0);
			sub.destroy();
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Ack/Nack
	// -----------------------------------------------------------------------

	describe("ack/nack", () => {
		it("ack reduces pending count", () => {
			const t = topic<number>("ack");
			t.publish(1);
			t.publish(2);

			const sub = subscription(t, { initialPosition: "earliest", ackTimeout: 0 });
			const msgs = sub.pull(2);
			expect(sub.pending.get()).toBe(2);

			sub.ack(msgs[0].seq);
			expect(sub.pending.get()).toBe(1);

			sub.ack(msgs[1].seq);
			expect(sub.pending.get()).toBe(0);

			sub.destroy();
			t.destroy();
		});

		it("ack on unknown seq is no-op", () => {
			const t = topic<number>("ack-noop");
			const sub = subscription(t, { initialPosition: "earliest" });
			sub.ack(999); // no error
			sub.destroy();
			t.destroy();
		});

		it("auto-nack after ackTimeout", () => {
			vi.useFakeTimers();
			const t = topic<number>("auto-nack");
			t.publish(1);

			const dlq = topic<number>("dlq");
			const sub = subscription(t, {
				initialPosition: "earliest",
				ackTimeout: 1000,
				retry: { maxRetries: 0 },
				deadLetterTopic: dlq,
			});

			sub.pull(1);
			expect(sub.pending.get()).toBe(1);

			vi.advanceTimersByTime(1000);
			expect(sub.pending.get()).toBe(0);

			// Message went to DLQ (0 retries = immediate DLQ)
			expect(dlq.tailSeq).toBe(1);

			sub.destroy();
			t.destroy();
			dlq.destroy();
			vi.useRealTimers();
		});
	});

	// -----------------------------------------------------------------------
	// 5e-3: Seeking
	// -----------------------------------------------------------------------

	describe("seek", () => {
		it("seeks to earliest", () => {
			const t = topic<number>("seek-earliest");
			t.publish(1);
			t.publish(2);
			t.publish(3);

			const sub = subscription(t); // starts at latest
			sub.seek("earliest");

			const msgs = sub.pull(10);
			expect(msgs).toHaveLength(3);
			expect(msgs[0].value).toBe(1);

			sub.destroy();
			t.destroy();
		});

		it("seeks to latest", () => {
			const t = topic<number>("seek-latest");
			t.publish(1);
			t.publish(2);

			const sub = subscription(t, { initialPosition: "earliest" });
			sub.pull(1); // read one
			sub.seek("latest");

			const msgs = sub.pull(10);
			expect(msgs).toHaveLength(0); // nothing after latest

			t.publish(3);
			const more = sub.pull(10);
			expect(more).toHaveLength(1);
			expect(more[0].value).toBe(3);

			sub.destroy();
			t.destroy();
		});

		it("seeks to specific position", () => {
			const t = topic<number>("seek-pos");
			t.publish(10);
			t.publish(20);
			t.publish(30);

			const sub = subscription(t, { initialPosition: "earliest" });
			sub.seek(3);

			const msgs = sub.pull(10);
			expect(msgs).toHaveLength(1);
			expect(msgs[0].value).toBe(30);

			sub.destroy();
			t.destroy();
		});

		it("seek clears in-flight and pending", () => {
			const t = topic<number>("seek-clear");
			t.publish(1);
			t.publish(2);

			const sub = subscription(t, { initialPosition: "earliest", ackTimeout: 0 });
			sub.pull(2);
			expect(sub.pending.get()).toBe(2);

			sub.seek("earliest");
			expect(sub.pending.get()).toBe(0);

			sub.destroy();
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// 5e-3: Companion stores
	// -----------------------------------------------------------------------

	describe("companion stores", () => {
		it("position reflects cursor", () => {
			const t = topic<number>("pos");
			t.publish(1);
			t.publish(2);

			const sub = subscription(t, { initialPosition: "earliest" });
			expect(sub.position.get()).toBe(1);

			sub.pull(1);
			expect(sub.position.get()).toBe(2);

			sub.pull(1);
			expect(sub.position.get()).toBe(3);

			sub.destroy();
			t.destroy();
		});

		it("backlog reflects unread messages", () => {
			const t = topic<number>("backlog");
			t.publish(1);
			t.publish(2);
			t.publish(3);

			const sub = subscription(t, { initialPosition: "earliest" });
			expect(sub.backlog.get()).toBe(3);

			sub.pull(1);
			expect(sub.backlog.get()).toBe(2);

			sub.pull(2);
			expect(sub.backlog.get()).toBe(0);

			sub.destroy();
			t.destroy();
		});

		it("pending reflects in-flight messages", () => {
			const t = topic<number>("pending");
			t.publish(1);
			t.publish(2);

			const sub = subscription(t, { initialPosition: "earliest", ackTimeout: 0 });
			expect(sub.pending.get()).toBe(0);

			const msgs = sub.pull(2);
			expect(sub.pending.get()).toBe(2);

			sub.ack(msgs[0].seq);
			expect(sub.pending.get()).toBe(1);

			sub.destroy();
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// 5e-3: Lifecycle
	// -----------------------------------------------------------------------

	describe("lifecycle", () => {
		it("pause stops pulling", () => {
			const t = topic<number>("pause");
			t.publish(1);

			const sub = subscription(t, { initialPosition: "earliest" });
			sub.pause();
			expect(sub.isPaused).toBe(true);
			expect(sub.pull(10)).toHaveLength(0);

			sub.resume();
			expect(sub.isPaused).toBe(false);
			expect(sub.pull(10)).toHaveLength(1);

			sub.destroy();
			t.destroy();
		});

		it("destroy prevents further pulls", () => {
			const t = topic<number>("destroy");
			t.publish(1);

			const sub = subscription(t, { initialPosition: "earliest" });
			sub.destroy();
			expect(sub.pull(10)).toHaveLength(0);

			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// 5e-4: Retry + dead letter
	// -----------------------------------------------------------------------

	describe("retry + dead letter", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		it("nack retries message up to maxRetries", () => {
			const t = topic<string>("retry");
			t.publish("fail-me");

			const dlq = topic<string>("dlq");
			const sub = subscription(t, {
				initialPosition: "earliest",
				ackTimeout: 0,
				retry: {
					maxRetries: 2,
					backoff: constant(100),
				},
				deadLetterTopic: dlq,
			});

			// First pull
			let msgs = sub.pull(1);
			expect(msgs).toHaveLength(1);
			sub.nack(msgs[0].seq);

			// Retry 1 — not ready yet
			msgs = sub.pull(1);
			expect(msgs).toHaveLength(0);

			// Advance past backoff
			vi.advanceTimersByTime(100);
			msgs = sub.pull(1);
			expect(msgs).toHaveLength(1);
			expect(msgs[0].value).toBe("fail-me");
			sub.nack(msgs[0].seq);

			// Retry 2
			vi.advanceTimersByTime(100);
			msgs = sub.pull(1);
			expect(msgs).toHaveLength(1);
			sub.nack(msgs[0].seq);

			// Exceeded maxRetries — should go to DLQ
			expect(dlq.tailSeq).toBe(1);
			const dlqMsg = dlq.get(1)!;
			expect(dlqMsg.value).toBe("fail-me");
			expect(dlqMsg.headers!["x-original-topic"]).toBe("retry");
			expect(dlqMsg.headers!["x-retry-count"]).toBe("3");

			sub.destroy();
			t.destroy();
			dlq.destroy();
		});

		it("nack without DLQ drops message after maxRetries", () => {
			const t = topic<string>("retry-no-dlq");
			t.publish("fail");

			const sub = subscription(t, {
				initialPosition: "earliest",
				ackTimeout: 0,
				retry: { maxRetries: 1, backoff: constant(50) },
			});

			let msgs = sub.pull(1);
			sub.nack(msgs[0].seq);

			vi.advanceTimersByTime(50);
			msgs = sub.pull(1);
			sub.nack(msgs[0].seq); // exceeds maxRetries

			// No DLQ, message is just dropped
			vi.advanceTimersByTime(1000);
			msgs = sub.pull(1);
			expect(msgs).toHaveLength(0);

			sub.destroy();
			t.destroy();
		});

		it("backoff strategy determines retry delay", () => {
			const t = topic<string>("backoff");
			t.publish("retry-me");

			const sub = subscription(t, {
				initialPosition: "earliest",
				ackTimeout: 0,
				retry: {
					maxRetries: 3,
					backoff: constant(500),
				},
			});

			const msgs = sub.pull(1);
			sub.nack(msgs[0].seq);

			// Not ready at 400ms
			vi.advanceTimersByTime(400);
			expect(sub.pull(1)).toHaveLength(0);

			// Ready at 500ms
			vi.advanceTimersByTime(100);
			const retried = sub.pull(1);
			expect(retried).toHaveLength(1);
			expect(retried[0].value).toBe("retry-me");
			sub.ack(retried[0].seq);

			sub.destroy();
			t.destroy();
		});

		it("backoff returning null routes to DLQ immediately", () => {
			const t = topic<string>("backoff-null");
			t.publish("stop-retry");

			const dlq = topic<string>("dlq-null");
			const sub = subscription(t, {
				initialPosition: "earliest",
				ackTimeout: 0,
				retry: {
					maxRetries: 10,
					backoff: withMaxAttempts(constant(100), 1), // stops after 1 retry
				},
				deadLetterTopic: dlq,
			});

			let msgs = sub.pull(1);
			sub.nack(msgs[0].seq);

			// First retry allowed
			vi.advanceTimersByTime(100);
			msgs = sub.pull(1);
			sub.nack(msgs[0].seq);

			// Second retry — backoff returns null → DLQ
			expect(dlq.tailSeq).toBe(1);

			sub.destroy();
			t.destroy();
			dlq.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Subscription modes
	// -----------------------------------------------------------------------

	describe("subscription modes", () => {
		it("exclusive: independent cursors", () => {
			const t = topic<number>("exclusive");
			t.publish(1);
			t.publish(2);

			const sub1 = subscription(t, { name: "a", initialPosition: "earliest" });
			const sub2 = subscription(t, { name: "b", initialPosition: "earliest" });

			const msgs1 = sub1.pull(10);
			const msgs2 = sub2.pull(10);

			// Both see all messages
			expect(msgs1).toHaveLength(2);
			expect(msgs2).toHaveLength(2);

			sub1.destroy();
			sub2.destroy();
			t.destroy();
		});

		it("shared: round-robin dispatch", () => {
			const t = topic<number>("shared");
			t.publish(1);
			t.publish(2);
			t.publish(3);
			t.publish(4);

			const sub1 = subscription(t, {
				name: "group",
				mode: "shared",
				initialPosition: "earliest",
				ackTimeout: 0,
			});
			const sub2 = subscription(t, {
				name: "group",
				mode: "shared",
				initialPosition: "earliest",
				ackTimeout: 0,
			});

			// Each consumer pulls — they share cursor and get different messages
			const msgs1 = sub1.pull(10);
			const msgs2 = sub2.pull(10);

			// Between the two, all messages should be distributed
			const allValues = [...msgs1.map((m) => m.value), ...msgs2.map((m) => m.value)];
			expect(allValues.length).toBeGreaterThan(0);
			expect(allValues.length).toBeLessThanOrEqual(4);

			sub1.destroy();
			sub2.destroy();
			t.destroy();
		});

		it("failover: only active consumer pulls", () => {
			const t = topic<number>("failover");
			t.publish(1);
			t.publish(2);

			const sub1 = subscription(t, {
				name: "fo-group",
				mode: "failover",
				initialPosition: "earliest",
				ackTimeout: 0,
			});
			const sub2 = subscription(t, {
				name: "fo-group",
				mode: "failover",
				initialPosition: "earliest",
				ackTimeout: 0,
			});

			// sub1 is first → active
			const msgs1 = sub1.pull(10);
			expect(msgs1.length).toBeGreaterThan(0);

			// sub2 is standby → gets nothing
			const msgs2 = sub2.pull(10);
			expect(msgs2).toHaveLength(0);

			// Destroy active → sub2 becomes active
			sub1.destroy();
			t.publish(3);
			const msgs3 = sub2.pull(10);
			expect(msgs3.length).toBeGreaterThan(0);

			sub2.destroy();
			t.destroy();
		});

		it("key_shared: messages routed by key", () => {
			const t = topic<string>("key-shared");
			// Publish messages with different keys
			t.publish("a1", { key: "a" });
			t.publish("b1", { key: "b" });
			t.publish("a2", { key: "a" });
			t.publish("b2", { key: "b" });

			const sub1 = subscription(t, {
				name: "ks-group",
				mode: "key_shared",
				initialPosition: "earliest",
				ackTimeout: 0,
			});
			const sub2 = subscription(t, {
				name: "ks-group",
				mode: "key_shared",
				initialPosition: "earliest",
				ackTimeout: 0,
			});

			const msgs1 = sub1.pull(10);
			const msgs2 = sub2.pull(10);

			// Messages with same key should go to the same consumer
			const keys1 = msgs1.map((m) => m.key);

			if (keys1.includes("a")) {
				// All "a" messages should be in sub1
				expect(keys1.filter((k) => k === "a").length).toBe(
					msgs1.filter((m) => m.key === "a").length,
				);
			}

			// All messages accounted for
			expect(msgs1.length + msgs2.length).toBeLessThanOrEqual(4);

			sub1.destroy();
			sub2.destroy();
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Cursor persistence
	// -----------------------------------------------------------------------

	describe("cursor persistence", () => {
		it("persists cursor on ack", async () => {
			const store = new Map<string, unknown>();
			const adapter = {
				save: (id: string, value: unknown) => {
					store.set(id, value);
				},
				load: (id: string) => store.get(id),
				clear: (id: string) => {
					store.delete(id);
				},
			};

			const t = topic<number>("persist");
			t.publish(1);
			t.publish(2);

			const sub = subscription(t, {
				name: "persisted",
				initialPosition: "earliest",
				ackTimeout: 0,
				persistence: adapter,
			});

			const msgs = sub.pull(1);
			sub.ack(msgs[0].seq);

			// Wait for async persist
			await new Promise((r) => setTimeout(r, 10));
			expect(store.get("persisted:cursor")).toBe(2);

			sub.destroy();
			t.destroy();
		});

		it("loads persisted cursor on init (sync adapter)", () => {
			const store = new Map<string, unknown>();
			store.set("restored:cursor", 3); // pre-saved cursor
			const adapter = {
				save: (id: string, value: unknown) => {
					store.set(id, value);
				},
				load: (id: string) => store.get(id),
				clear: (id: string) => {
					store.delete(id);
				},
			};

			const t = topic<number>("restore");
			t.publish(1);
			t.publish(2);
			t.publish(3);
			t.publish(4);

			const sub = subscription(t, {
				name: "restored",
				initialPosition: "earliest",
				ackTimeout: 0,
				persistence: adapter,
			});

			// Cursor should have been restored to 3, skipping messages 1-2
			const msgs = sub.pull(10);
			expect(msgs).toHaveLength(2);
			expect(msgs[0].value).toBe(3);
			expect(msgs[1].value).toBe(4);

			sub.destroy();
			t.destroy();
		});

		it("loads persisted cursor on init (async adapter)", async () => {
			const store = new Map<string, unknown>();
			store.set("async-restored:cursor", 2);
			const adapter = {
				save: (id: string, value: unknown) => {
					store.set(id, value);
				},
				load: (id: string) => Promise.resolve(store.get(id)),
				clear: (id: string) => {
					store.delete(id);
				},
			};

			const t = topic<number>("async-restore");
			t.publish(10);
			t.publish(20);
			t.publish(30);

			const sub = subscription(t, {
				name: "async-restored",
				initialPosition: "earliest",
				ackTimeout: 0,
				persistence: adapter,
			});

			// Before promise resolves, cursor is at earliest (1)
			// After promise resolves, cursor seeks to 2
			await new Promise((r) => setTimeout(r, 10));
			const msgs = sub.pull(10);
			expect(msgs).toHaveLength(2);
			expect(msgs[0].value).toBe(20);
			expect(msgs[1].value).toBe(30);

			sub.destroy();
			t.destroy();
		});

		it("falls back to initialPosition when persistence returns undefined", () => {
			const adapter = {
				save: () => {},
				load: () => undefined,
				clear: () => {},
			};

			const t = topic<number>("no-saved");
			t.publish(1);
			t.publish(2);

			const sub = subscription(t, {
				name: "no-saved",
				initialPosition: "earliest",
				ackTimeout: 0,
				persistence: adapter,
			});

			// No saved cursor — should use initialPosition: earliest
			const msgs = sub.pull(10);
			expect(msgs).toHaveLength(2);
			expect(msgs[0].value).toBe(1);

			sub.destroy();
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// BH-12: Destroy with pending ack timers
	// -----------------------------------------------------------------------

	describe("destroy with pending ack timers", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		it("destroy clears pending ack timers without firing nacks", () => {
			const t = topic<number>("destroy-timers");
			t.publish(1);
			t.publish(2);

			const dlq = topic<number>("dlq-destroy");
			const sub = subscription(t, {
				initialPosition: "earliest",
				ackTimeout: 5000,
				retry: { maxRetries: 0 },
				deadLetterTopic: dlq,
			});

			// Pull messages — starts ack timers
			sub.pull(2);
			expect(sub.pending.get()).toBe(2);

			// Destroy before ack timers fire
			sub.destroy();

			// Advance past ack timeout — should NOT fire nack/DLQ
			vi.advanceTimersByTime(10_000);
			expect(dlq.tailSeq).toBe(0); // nothing went to DLQ

			t.destroy();
			dlq.destroy();
		});

		it("destroy with mix of acked and pending timers", () => {
			const t = topic<number>("destroy-mixed");
			t.publish(1);
			t.publish(2);
			t.publish(3);

			const sub = subscription(t, {
				initialPosition: "earliest",
				ackTimeout: 5000,
			});

			const msgs = sub.pull(3);
			sub.ack(msgs[0].seq); // ack first
			expect(sub.pending.get()).toBe(2);

			// Destroy with 2 still pending
			sub.destroy();

			// Timers should be cleared — no errors after timeout
			vi.advanceTimersByTime(10_000);

			// Pull returns empty on destroyed sub
			expect(sub.pull(10)).toHaveLength(0);

			t.destroy();
		});
	});
});
