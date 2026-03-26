import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatStreamFactory } from "../../../ai/chatStream";
import { conversationThread } from "../../../ai/conversationThread";

/** Mock factory that echoes back the last user message */
function echoFactory(delay = 0): ChatStreamFactory {
	return async function* (signal, messages) {
		const lastUser = [...messages].reverse().find((m) => m.role === "user");
		const response = lastUser ? `Echo: ${lastUser.content}` : "No message";
		if (delay > 0) await new Promise((r) => setTimeout(r, delay));
		if (signal.aborted) return;
		yield response;
	};
}

/** Mock factory that captures messages passed to it */
function captureFactory(): {
	factory: ChatStreamFactory;
	captured: ChatMessage[][];
} {
	const captured: ChatMessage[][] = [];
	const factory: ChatStreamFactory = async function* (_signal, messages) {
		captured.push([...messages]);
		yield "ok";
	};
	return { factory, captured };
}

describe("conversationThread", () => {
	it("creates a thread with independent message history", async () => {
		const threads = conversationThread({ factory: echoFactory() });
		const t1 = threads.create("agent-1", { systemPrompt: "You are agent 1." });
		const t2 = threads.create("agent-2", { systemPrompt: "You are agent 2." });

		t1.send("hello from 1");
		t2.send("hello from 2");
		await new Promise((r) => setTimeout(r, 50));

		const m1 = t1.messages.get();
		const m2 = t2.messages.get();

		// Each thread has its own system prompt + user message + assistant response
		expect(m1.find((m) => m.content === "hello from 1")).toBeTruthy();
		expect(m2.find((m) => m.content === "hello from 2")).toBeTruthy();

		// Thread 1 doesn't have thread 2's messages
		expect(m1.find((m) => m.content === "hello from 2")).toBeUndefined();
	});

	it("throws on duplicate thread ID", () => {
		const threads = conversationThread({ factory: echoFactory() });
		threads.create("a");
		expect(() => threads.create("a")).toThrow('Thread "a" already exists');
	});

	it("get returns existing thread or undefined", () => {
		const threads = conversationThread({ factory: echoFactory() });
		threads.create("x");

		expect(threads.get("x")).toBeDefined();
		expect(threads.get("x")!.id).toBe("x");
		expect(threads.get("y")).toBeUndefined();
	});

	it("has checks thread existence", () => {
		const threads = conversationThread({ factory: echoFactory() });
		threads.create("x");

		expect(threads.has("x")).toBe(true);
		expect(threads.has("y")).toBe(false);
	});

	it("list returns all thread IDs", () => {
		const threads = conversationThread({ factory: echoFactory() });
		threads.create("a");
		threads.create("b");
		threads.create("c");

		expect(threads.list()).toEqual(["a", "b", "c"]);
	});

	it("threadCount is reactive", () => {
		const threads = conversationThread({ factory: echoFactory() });
		expect(threads.threadCount.get()).toBe(0);

		threads.create("a");
		expect(threads.threadCount.get()).toBe(1);

		threads.create("b");
		expect(threads.threadCount.get()).toBe(2);

		threads.destroyThread("a");
		expect(threads.threadCount.get()).toBe(1);
	});

	it("shared context is injected into factory messages", async () => {
		const { factory, captured } = captureFactory();
		const threads = conversationThread({ factory });

		threads.shared.set("Project uses TypeScript.");
		const t = threads.create("planner");
		t.send("hello");

		await new Promise((r) => setTimeout(r, 50));

		// Factory should have received shared context as system message
		const msgs = captured[0];
		const sharedMsg = msgs.find((m) => m.content.includes("[Shared Context]"));
		expect(sharedMsg).toBeDefined();
		expect(sharedMsg!.role).toBe("system");
		expect(sharedMsg!.content).toContain("Project uses TypeScript.");
	});

	it("shared context is not injected when empty", async () => {
		const { factory, captured } = captureFactory();
		const threads = conversationThread({ factory });

		// shared is "" by default
		const t = threads.create("agent");
		t.send("hello");
		await new Promise((r) => setTimeout(r, 50));

		const msgs = captured[0];
		const sharedMsg = msgs.find((m) => m.content.includes("[Shared Context]"));
		expect(sharedMsg).toBeUndefined();
	});

	it("shared context is placed after system prompt", async () => {
		const { factory, captured } = captureFactory();
		const threads = conversationThread({ factory });

		threads.shared.set("Context here.");
		const t = threads.create("agent", { systemPrompt: "You are helpful." });
		t.send("hello");
		await new Promise((r) => setTimeout(r, 50));

		const msgs = captured[0];
		// System prompt comes first
		expect(msgs[0].role).toBe("system");
		expect(msgs[0].content).toBe("You are helpful.");
		// Shared context comes second (still system role)
		expect(msgs[1].role).toBe("system");
		expect(msgs[1].content).toContain("[Shared Context]");
		// User message after
		expect(msgs[2].role).toBe("user");
	});

	it("inject adds cross-thread context to target", () => {
		const threads = conversationThread({ factory: echoFactory() });
		const source = threads.create("planner");
		const target = threads.create("coder");

		// Simulate planner having some conversation
		source.setMessages([
			{ role: "user", content: "Plan auth feature" },
			{ role: "assistant", content: "Step 1: Create login form." },
		]);

		threads.inject("coder", source.messages.get());

		const coderMsgs = target.messages.get();
		const injected = coderMsgs.find((m) => m.content.includes("[Cross-Thread Context]"));
		expect(injected).toBeDefined();
		expect(injected!.role).toBe("system");
		expect(injected!.content).toContain("[user]: Plan auth feature");
		expect(injected!.content).toContain("[assistant]: Step 1: Create login form.");
	});

	it("inject throws for non-existent target", () => {
		const threads = conversationThread({ factory: echoFactory() });
		expect(() => threads.inject("missing", [])).toThrow('Thread "missing" not found');
	});

	it("inject skips system messages from source", () => {
		const threads = conversationThread({ factory: echoFactory() });
		threads.create("source");
		const target = threads.create("target");

		threads.inject("target", [
			{ role: "system", content: "System prompt (should be excluded)" },
			{ role: "user", content: "User message" },
		]);

		const msgs = target.messages.get();
		const injected = msgs.find((m) => m.content.includes("[Cross-Thread Context]"));
		expect(injected).toBeDefined();
		expect(injected!.content).not.toContain("System prompt");
		expect(injected!.content).toContain("[user]: User message");
	});

	it("inject is a no-op for empty non-system messages", () => {
		const threads = conversationThread({ factory: echoFactory() });
		const target = threads.create("target");

		const before = target.messages.get().length;
		threads.inject("target", [{ role: "system", content: "only system" }]);
		expect(target.messages.get().length).toBe(before);
	});

	it("destroyThread clears and removes a thread", async () => {
		const threads = conversationThread({ factory: echoFactory() });
		const t = threads.create("agent");
		t.send("hello");
		await new Promise((r) => setTimeout(r, 50));

		threads.destroyThread("agent");

		expect(threads.has("agent")).toBe(false);
		expect(threads.get("agent")).toBeUndefined();
		expect(threads.list()).toEqual([]);
	});

	it("destroy removes all threads", () => {
		const threads = conversationThread({ factory: echoFactory() });
		threads.create("a");
		threads.create("b");
		threads.create("c");

		threads.destroy();

		expect(threads.list()).toEqual([]);
		expect(threads.threadCount.get()).toBe(0);
	});

	it("destroyThread is safe for non-existent thread", () => {
		const threads = conversationThread({ factory: echoFactory() });
		expect(() => threads.destroyThread("missing")).not.toThrow();
	});

	it("thread exposes id property", () => {
		const threads = conversationThread({ factory: echoFactory() });
		const t = threads.create("my-agent");
		expect(t.id).toBe("my-agent");
	});

	it("defaults are applied to all threads", async () => {
		const onComplete = vi.fn();
		const threads = conversationThread({
			factory: echoFactory(),
			defaults: { onComplete },
		});

		const t = threads.create("agent");
		t.send("hello");
		await new Promise((r) => setTimeout(r, 50));

		expect(onComplete).toHaveBeenCalled();
	});

	it("per-thread options override defaults", async () => {
		const defaultOnComplete = vi.fn();
		const threadOnComplete = vi.fn();
		const threads = conversationThread({
			factory: echoFactory(),
			defaults: { onComplete: defaultOnComplete },
		});

		const t = threads.create("agent", { onComplete: threadOnComplete });
		t.send("hello");
		await new Promise((r) => setTimeout(r, 50));

		expect(threadOnComplete).toHaveBeenCalled();
		expect(defaultOnComplete).not.toHaveBeenCalled();
	});

	it("thread streaming and partial work independently", async () => {
		const threads = conversationThread({ factory: echoFactory(20) });
		const t1 = threads.create("a");
		const t2 = threads.create("b");

		t1.send("msg1");
		t2.send("msg2");

		// Both should be streaming
		expect(t1.streaming.get()).toBe(true);
		expect(t2.streaming.get()).toBe(true);

		await new Promise((r) => setTimeout(r, 100));

		expect(t1.streaming.get()).toBe(false);
		expect(t2.streaming.get()).toBe(false);
	});
});
