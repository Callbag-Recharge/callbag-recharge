import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamResult } from "../../../ai/chatStream";
import { conversationSummary } from "../../../ai/conversationSummary";
import type { LLMStore } from "../../../ai/fromLLM";
import { state } from "../../../core/state";
import type { WithStatusStatus } from "../../../utils/withStatus";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockChat(): ChatStreamResult {
	return {
		messages: state([]),
		partial: state(""),
		streaming: state(false),
		error: state<unknown | undefined>(undefined),
		send: vi.fn(),
		stop: vi.fn(),
		retry: vi.fn(),
		clear: vi.fn(),
		setMessages: vi.fn(),
	};
}

function makeMockLLM(): LLMStore {
	const status = state<WithStatusStatus>("pending");
	const error = state<unknown | undefined>(undefined);
	const tokens = state<Record<string, unknown>>({});
	let _value = "";
	return {
		get: vi.fn(() => _value),
		source: vi.fn(),
		status,
		error,
		tokens,
		generate: vi.fn(),
		abort: vi.fn(),
		// Test helper: set the internal value for get()
		_setValue: (v: string) => {
			_value = v;
		},
	} as any;
}

// Helper: build a transcript that exceeds the token threshold
function longMessages(count = 10, wordsEach = 200) {
	const word = "lorem";
	const content = Array(wordsEach).fill(word).join(" ");
	const messages = [];
	for (let i = 0; i < count; i++) {
		messages.push({ role: i % 2 === 0 ? "user" : "assistant", content });
	}
	// Ensure last is assistant
	if (messages[messages.length - 1].role !== "assistant") {
		messages.push({ role: "assistant", content });
	}
	return messages as Array<{ role: "user" | "assistant" | "system"; content: string }>;
}

// ---------------------------------------------------------------------------
// conversationSummary tests
// ---------------------------------------------------------------------------

describe("conversationSummary", () => {
	let summary: ReturnType<typeof conversationSummary> | null = null;

	afterEach(() => {
		summary?.destroy();
		summary = null;
	});

	it("initial summary is empty string", () => {
		const chat = makeMockChat();
		const llm = makeMockLLM();

		summary = conversationSummary({ chat, llm });

		expect(summary.get()).toBe("");
	});

	it("no summarization below threshold", () => {
		const chat = makeMockChat();
		const llm = makeMockLLM();

		summary = conversationSummary({ chat, llm, maxTokens: 2000 });

		// Short messages — should not trigger
		(chat.messages as ReturnType<typeof state>).set([
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there!" },
		]);

		expect(llm.generate).not.toHaveBeenCalled();
	});

	it("no summarization while LLM is active", () => {
		const chat = makeMockChat();
		const llm = makeMockLLM();

		summary = conversationSummary({ chat, llm, maxTokens: 10 });

		// Set LLM to active
		(llm.status as ReturnType<typeof state>).set("active");

		// Long messages that would normally trigger
		(chat.messages as ReturnType<typeof state>).set(longMessages());

		expect(llm.generate).not.toHaveBeenCalled();
	});

	it("no summarization after user message (only after assistant message)", () => {
		const chat = makeMockChat();
		const llm = makeMockLLM();

		summary = conversationSummary({ chat, llm, maxTokens: 10 });

		const msgs = longMessages();
		// End with a user message
		const userEndingMsgs = [
			...msgs,
			{
				role: "user" as const,
				content: "Follow-up question with many words here to exceed threshold",
			},
		];
		(chat.messages as ReturnType<typeof state>).set(userEndingMsgs);

		expect(llm.generate).not.toHaveBeenCalled();
	});

	it("triggers llm.generate() when threshold exceeded after assistant message", () => {
		const chat = makeMockChat();
		const llm = makeMockLLM();

		summary = conversationSummary({ chat, llm, maxTokens: 10 });

		(chat.messages as ReturnType<typeof state>).set(longMessages());

		expect(llm.generate).toHaveBeenCalledOnce();
		const messages = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(messages[0].role).toBe("user");
		expect(messages[0].content).toContain("Summarize");
	});

	it("captures llm output as summary when status becomes completed", () => {
		const chat = makeMockChat();
		const llm = makeMockLLM();

		summary = conversationSummary({ chat, llm, maxTokens: 10 });

		// Trigger summarization
		(chat.messages as ReturnType<typeof state>).set(longMessages());

		expect(llm.generate).toHaveBeenCalledOnce();

		// Simulate LLM completing with summary text
		(llm as any)._setValue("This is the rolling summary.");
		(llm.status as ReturnType<typeof state>).set("completed");

		expect(summary.get()).toBe("This is the rolling summary.");
	});

	it("resets summarizing flag on error status", () => {
		const chat = makeMockChat();
		const llm = makeMockLLM();

		summary = conversationSummary({ chat, llm, maxTokens: 10 });

		// Trigger summarization
		(chat.messages as ReturnType<typeof state>).set(longMessages());
		expect(llm.generate).toHaveBeenCalledOnce();

		// Simulate error
		(llm.status as ReturnType<typeof state>).set("errored");

		// Summary should remain empty (error keeps previous summary)
		expect(summary.get()).toBe("");

		// Should be able to trigger again after error reset
		(llm.generate as ReturnType<typeof vi.fn>).mockClear();
		const newMsgs = longMessages(12, 200);
		(chat.messages as ReturnType<typeof state>).set(newMsgs);

		expect(llm.generate).toHaveBeenCalledOnce();
	});

	it("does not re-trigger while summarizing", () => {
		const chat = makeMockChat();
		const llm = makeMockLLM();

		summary = conversationSummary({ chat, llm, maxTokens: 10 });

		// Trigger summarization
		(chat.messages as ReturnType<typeof state>).set(longMessages());
		expect(llm.generate).toHaveBeenCalledOnce();

		// Update messages again while still summarizing (status still pending/active)
		(chat.messages as ReturnType<typeof state>).set(longMessages(15, 200));

		// Should not have triggered a second time
		expect(llm.generate).toHaveBeenCalledOnce();
	});

	it("destroy() cleans up subscriptions", () => {
		const chat = makeMockChat();
		const llm = makeMockLLM();

		summary = conversationSummary({ chat, llm, maxTokens: 10 });
		expect(() => summary!.destroy()).not.toThrow();

		// After destroy, messages changes should not trigger generate
		(llm.generate as ReturnType<typeof vi.fn>).mockClear();
		(chat.messages as ReturnType<typeof state>).set(longMessages());
		expect(llm.generate).not.toHaveBeenCalled();

		summary = null; // prevent afterEach double-destroy
	});
});
