// ---------------------------------------------------------------------------
// conversationSummary — rolling conversation summarizer
// ---------------------------------------------------------------------------
// Monitors a chatStream conversation and auto-summarizes when token count
// exceeds a threshold. Uses an LLM store to compress history into a rolling
// summary. Returns a Store<string> for use with ragPipeline / systemPromptBuilder.
//
// Built on: state, subscribe (§1.19 — single-dep sinks)
// ---------------------------------------------------------------------------

import { teardown } from "../../core/protocol";
import { state } from "../../core/state";
import { subscribe } from "../../core/subscribe";
import type { Store } from "../../core/types";
import type { ChatMessage, ChatStreamResult } from "../chatStream";
import type { LLMMessage, LLMStore } from "../fromLLM";

/** Rough token estimate: ~1.3 tokens per whitespace-delimited word. */
function estimateTokens(messages: ChatMessage[]): number {
	let total = 0;
	for (const m of messages) {
		total += Math.ceil(m.content.split(/\s+/).filter(Boolean).length * 1.3);
	}
	return total;
}

export interface ConversationSummaryOptions {
	/** Chat stream to monitor for token overflow. */
	chat: ChatStreamResult;
	/** LLM store used to generate summaries. May be shared with ragPipeline (guard prevents conflicts). */
	llm: LLMStore;
	/** Token count threshold to trigger summarization. Default: 2000 */
	maxTokens?: number;
	/** Instruction prepended to the summarization request. Uses a sensible default if omitted. */
	summaryPrompt?: string;
	/** Debug name for the summary store. */
	name?: string;
}

export interface ConversationSummaryStore extends Store<string> {
	/** Tear down subscriptions and summary store. Does not destroy the passed chat or llm. */
	destroy(): void;
}

const DEFAULT_SUMMARY_PROMPT =
	"Summarize the following conversation concisely, preserving key facts, decisions, and context. Output only the summary, no preamble.";

/**
 * Auto-summarizes a conversation when token count exceeds a threshold.
 *
 * @param opts - Chat stream, LLM store, and token threshold.
 *
 * @returns `ConversationSummaryStore` — `Store<string>` with the rolling summary, plus `destroy()`.
 *
 * @remarks **Trigger window:** Only fires after an assistant response (last message is `"assistant"`),
 *   when the LLM is idle (`status !== "active"`).
 * @remarks **Rolling:** Each summarization replaces the previous summary. Chain with `systemPromptBuilder`
 *   or pass as `summary` to `ragPipeline` to inject into the system prompt.
 * @remarks **Shared LLM:** Safe to share `llm` with `ragPipeline`. The `status !== "active"` guard
 *   prevents summarization from interrupting an in-progress generation.
 *
 * @example
 * ```ts
 * import { state } from 'callbag-recharge';
 * import { chatStream, conversationSummary, fromLLM, ragPipeline } from 'callbag-recharge/ai';
 *
 * const llm = fromLLM({ provider: 'ollama', model: 'llama4' });
 * const chat = chatStream(async function* (messages, signal) { ... });
 * const summary = conversationSummary({ chat, llm, maxTokens: 2000 });
 *
 * const query = state('');
 * const rag = ragPipeline({ query, docSearch, llm, summary });
 * // summary.get() → rolling summary injected as SUMMARY section in rag.context
 * ```
 *
 * @category ai
 */
export function conversationSummary(opts: ConversationSummaryOptions): ConversationSummaryStore {
	const maxTokens = opts.maxTokens ?? 2000;
	const summaryPrompt = opts.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT;
	const summaryStore = state<string>("", { name: opts.name ?? "conversationSummary" });

	let summarizing = false;

	// Capture summary text when LLM completes a summarization generation.
	// subscribe (§1.19): single dep, no cleanup return.
	const statusSub = subscribe(opts.llm.status, (status) => {
		if (!summarizing) return;
		if (status === "completed") {
			summarizing = false;
			const text = opts.llm.get();
			if (text) summaryStore.set(text);
		} else if (status === "errored") {
			summarizing = false; // reset on error, keep previous summary
		} else if (status === "pending") {
			// Another caller aborted the in-flight summary generation (e.g. ragPipeline
			// fired a new query). Reset the flag so the next assistant message can
			// trigger a fresh summarization attempt.
			summarizing = false;
		}
	});

	// Monitor messages for token threshold crossing.
	// subscribe (§1.19): single dep, no cleanup return.
	const messagesSub = subscribe(opts.chat.messages, (messages) => {
		if (summarizing) return;
		// Only check after an assistant response (not after user input)
		if (messages.length === 0 || messages[messages.length - 1].role !== "assistant") return;
		// Guard: don't interrupt an in-progress generation
		if (opts.llm.status.get() === "active") return;
		if (estimateTokens(messages) <= maxTokens) return;

		summarizing = true;
		const transcript = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
		const llmMessages: LLMMessage[] = [
			{ role: "user", content: `${summaryPrompt}\n\n${transcript}` },
		];
		try {
			opts.llm.generate(llmMessages);
		} catch {
			// generate() threw synchronously (e.g. malformed messages) — status
			// will never transition, so reset the flag to allow future attempts.
			summarizing = false;
		}
	});

	function destroy(): void {
		messagesSub.unsubscribe();
		statusSub.unsubscribe();
		teardown(summaryStore);
	}

	return {
		get: () => summaryStore.get(),
		source: (type: number, payload?: any) => summaryStore.source(type, payload),
		destroy,
	};
}
