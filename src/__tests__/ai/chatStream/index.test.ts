import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../../ai/chatStream";
import { chatStream } from "../../../ai/chatStream";

// Helper: mock chat factory that yields chunks
function mockChatFactory(
	chunks: string[],
	delay = 0,
): (signal: AbortSignal, messages: ChatMessage[]) => AsyncIterable<string> {
	return async function* (signal, _messages) {
		for (const chunk of chunks) {
			if (signal.aborted) return;
			if (delay > 0) await new Promise((r) => setTimeout(r, delay));
			if (signal.aborted) return;
			yield chunk;
		}
	};
}

// ---------------------------------------------------------------------------
// chatStream
// ---------------------------------------------------------------------------
describe("chatStream", () => {
	it("sends a message and receives streaming response", async () => {
		const chat = chatStream(mockChatFactory(["Hello", " world", "!"]));

		chat.send("Hi");

		// User message added immediately
		expect(chat.messages.get()).toEqual([{ role: "user", content: "Hi" }]);
		expect(chat.streaming.get()).toBe(true);

		await new Promise((r) => setTimeout(r, 50));

		// Response completed
		expect(chat.streaming.get()).toBe(false);
		expect(chat.messages.get()).toEqual([
			{ role: "user", content: "Hi" },
			{ role: "assistant", content: "Hello world!" },
		]);
	});

	it("tracks partial response while streaming", async () => {
		const chat = chatStream(mockChatFactory(["a", "b", "c"], 20));

		chat.send("test");
		await new Promise((r) => setTimeout(r, 30));

		// Should have accumulated some partial content
		const partial = chat.partial.get();
		expect(partial.length).toBeGreaterThan(0);

		// Wait for completion
		await new Promise((r) => setTimeout(r, 100));
		expect(chat.partial.get()).toBe(""); // cleared after completion
	});

	it("stop cancels generation and saves partial response", async () => {
		const chat = chatStream(mockChatFactory(["Hello", " World"], 50));

		chat.send("test");
		await new Promise((r) => setTimeout(r, 60));

		chat.partial.get(); // verify partial exists before stop
		chat.stop();

		expect(chat.streaming.get()).toBe(false);
		// Partial content should be saved as a message
		const msgs = chat.messages.get();
		expect(msgs.length).toBe(2); // user + partial assistant
		expect(msgs[1].role).toBe("assistant");
	});

	it("auto-cancels previous stream on new send", async () => {
		const aborted = vi.fn();
		const chat = chatStream(async function* (signal, _messages) {
			signal.addEventListener("abort", aborted);
			yield "first";
			await new Promise((r) => setTimeout(r, 500));
			yield "response";
		});

		chat.send("msg1");
		await new Promise((r) => setTimeout(r, 20));
		chat.send("msg2");

		expect(aborted).toHaveBeenCalled();
	});

	it("retry resends last user message", async () => {
		let callCount = 0;
		const chat = chatStream(async function* (_signal, _messages) {
			callCount++;
			if (callCount === 1) throw new Error("fail");
			yield "success";
		});

		chat.send("hello");
		await new Promise((r) => setTimeout(r, 50));

		expect(chat.error.get()).toBeInstanceOf(Error);
		expect(callCount).toBe(1);

		chat.retry();
		await new Promise((r) => setTimeout(r, 50));

		expect(callCount).toBe(2);
		const msgs = chat.messages.get();
		const assistantMsgs = msgs.filter((m) => m.role === "assistant" && m.content === "success");
		expect(assistantMsgs.length).toBe(1);
	});

	it("clear removes all messages", async () => {
		const chat = chatStream(mockChatFactory(["response"]));

		chat.send("hello");
		await new Promise((r) => setTimeout(r, 50));

		expect(chat.messages.get().length).toBeGreaterThan(0);
		chat.clear();
		expect(chat.messages.get()).toEqual([]);
	});

	it("includes system prompt in requests", async () => {
		let receivedMessages: ChatMessage[] = [];
		const chat = chatStream(
			async function* (_signal, messages) {
				receivedMessages = messages;
				yield "ok";
			},
			{ systemPrompt: "You are helpful." },
		);

		chat.send("hello");
		await new Promise((r) => setTimeout(r, 50));

		expect(receivedMessages[0]).toEqual({
			role: "system",
			content: "You are helpful.",
		});
		// System prompt is also visible in the messages store
		expect(chat.messages.get()[0]).toEqual({
			role: "system",
			content: "You are helpful.",
		});
	});

	it("calls onComplete callback", async () => {
		const onComplete = vi.fn();
		const chat = chatStream(mockChatFactory(["done"]), { onComplete });

		chat.send("test");
		await new Promise((r) => setTimeout(r, 50));

		expect(onComplete).toHaveBeenCalledWith("done");
	});

	it("calls onError callback", async () => {
		const onError = vi.fn();
		const chat = chatStream(
			async function* () {
				yield "partial";
				throw new Error("api error");
			},
			{ onError },
		);

		chat.send("test");
		await new Promise((r) => setTimeout(r, 50));

		expect(onError).toHaveBeenCalledWith(expect.any(Error));
		expect(chat.error.get()).toBeInstanceOf(Error);
	});

	it("setMessages restores conversation state", () => {
		const chat = chatStream(mockChatFactory(["ok"]));

		const msgs: ChatMessage[] = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		];
		chat.setMessages(msgs);
		expect(chat.messages.get()).toEqual(msgs);
	});
});
