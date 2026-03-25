// ---------------------------------------------------------------------------
// chatStream — LLM streaming chat with backpressure
// ---------------------------------------------------------------------------
// Composed pattern for AI/LLM streaming conversations:
// - Message history (reactive list)
// - Streaming responses with auto-cancellation
// - Rate limiting for API calls
// - Token accumulation with reactive partial state
// - Stop generation / retry last message
//
// Built on: state, cancellableStream, rateLimiter
// ---------------------------------------------------------------------------

import { state } from "../../core/state";
import type { Store } from "../../core/types";
import { rawFromAsyncIter } from "../../raw/fromAsyncIter";
import { rawSubscribe } from "../../raw/subscribe";
import type { RateLimiter } from "../../utils/rateLimiter";

export interface ChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
}

export type ChatStreamFactory = (
	signal: AbortSignal,
	messages: ChatMessage[],
) => AsyncIterable<string>;

export interface ChatStreamOptions {
	/** Debug name for Inspector. */
	name?: string;
	/** System prompt added as first message on first send. Included in `messages` store. */
	systemPrompt?: string;
	/** Rate limiter for API calls. */
	rateLimiter?: RateLimiter;
	/** Called when a stream completes normally. */
	onComplete?: (fullResponse: string) => void;
	/** Called when a stream errors. */
	onError?: (error: unknown) => void;
}

export interface ChatStreamResult {
	/** Send a user message and start streaming the response. */
	send: (message: string) => void;
	/** Stop the current generation. */
	stop: () => void;
	/** Retry the last user message (re-sends with same messages). */
	retry: () => void;
	/** Clear all messages. */
	clear: () => void;
	/** All messages in the conversation (includes system prompt if set). */
	messages: Store<ChatMessage[]>;
	/** Current streaming partial response (empty string when idle). */
	partial: Store<string>;
	/** Whether a response is currently streaming. */
	streaming: Store<boolean>;
	/** Last error, if any. */
	error: Store<unknown | undefined>;
	/** Manually set messages (for restoring state). */
	setMessages: (messages: ChatMessage[]) => void;
}

/**
 * Creates an LLM streaming chat with auto-cancellation and backpressure.
 *
 * @param factory - Async iterable factory: receives messages + AbortSignal, yields text chunks.
 * @param opts - Optional configuration.
 *
 * @returns `ChatStreamResult` — `send`, `stop`, `retry`, `clear`, `messages`, `partial`, `streaming`, `error`.
 *
 * @remarks **Auto-cancel:** Sending a new message while streaming cancels the current generation.
 * @remarks **Rate limiting:** Pass a `rateLimiter` to throttle API calls (e.g., for LLM RPM limits).
 * @remarks **Message history:** `messages` store includes the system prompt (if set) and reactively updates.
 *
 * @example
 * ```ts
 * import { chatStream } from 'callbag-recharge/ai/chatStream';
 *
 * const chat = chatStream(async function* (signal, messages) {
 *   const res = await fetch('/api/chat', {
 *     method: 'POST',
 *     body: JSON.stringify({ messages }),
 *     signal,
 *   });
 *   const reader = res.body!.getReader();
 *   const decoder = new TextDecoder();
 *   while (true) {
 *     const { done, value } = await reader.read();
 *     if (done) break;
 *     yield decoder.decode(value);
 *   }
 * });
 *
 * chat.send('Hello!');
 * // chat.messages.get() → [{ role: 'system', content: '...' }, { role: 'user', content: 'Hello!' }]
 * // chat.partial.get() → accumulating response text...
 * // chat.streaming.get() → true
 * ```
 *
 * @category ai
 */
export function chatStream(factory: ChatStreamFactory, opts?: ChatStreamOptions): ChatStreamResult {
	const name = opts?.name ?? "chatStream";

	const messagesStore = state<ChatMessage[]>([], { name: `${name}.messages` });
	const partialStore = state<string>("", { name: `${name}.partial` });
	const streamingStore = state<boolean>(false, { name: `${name}.streaming` });
	const errorStore = state<unknown | undefined>(undefined, { name: `${name}.error` });

	let abortController: AbortController | null = null;
	let lastUserMessage: string | null = null;
	let stopped = false; // guard against stop()/streamResponse race
	let systemPromptAdded = false;

	function cancelStream(): void {
		if (abortController) {
			abortController.abort();
			abortController = null;
		}
		streamingStore.set(false);
	}

	function streamResponse(signal: AbortSignal): void {
		// Mark not stopped for this run
		stopped = false;

		streamingStore.set(true);
		partialStore.set("");
		errorStore.set(undefined);

		function doStream(): void {
			// Read messages snapshot for API call
			const msgs = messagesStore.get();
			let accumulated = "";

			let iterable: AsyncIterable<string>;
			try {
				iterable = factory(signal, msgs);
			} catch (err) {
				partialStore.set("");
				streamingStore.set(false);
				errorStore.set(err);
				abortController = null;
				opts?.onError?.(err);
				return;
			}
			rawSubscribe<string>(
				rawFromAsyncIter(iterable),
				(chunk) => {
					if (signal.aborted) return;
					accumulated += chunk;
					partialStore.set(accumulated);
				},
				{
					onEnd: (err) => {
						if (signal.aborted || stopped) return;

						if (err !== undefined) {
							// If we accumulated partial content, still add it as a message
							if (accumulated.length > 0) {
								const partialMsg: ChatMessage = {
									role: "assistant",
									content: accumulated,
								};
								messagesStore.update((prev) => [...prev, partialMsg]);
							}

							partialStore.set("");
							streamingStore.set(false);
							errorStore.set(err);
							abortController = null;
							opts?.onError?.(err);
						} else {
							// Stream completed — add assistant message
							const assistantMsg: ChatMessage = {
								role: "assistant",
								content: accumulated,
							};
							messagesStore.update((prev) => [...prev, assistantMsg]);
							partialStore.set("");
							streamingStore.set(false);
							abortController = null;
							opts?.onComplete?.(accumulated);
						}
					},
				},
			);
		}

		// Rate limiting (after abort controller is set so cancellation works)
		if (opts?.rateLimiter) {
			const allowed = opts.rateLimiter.tryAcquire();
			if (!allowed) {
				rawSubscribe(
					opts.rateLimiter.acquire(signal, 1),
					() => {
						if (signal.aborted) return;
						doStream();
					},
					{
						onEnd: (err) => {
							if (err !== undefined) {
								if (signal.aborted) return;
								partialStore.set("");
								streamingStore.set(false);
								errorStore.set(err);
								abortController = null;
							}
						},
					},
				);
				return;
			}
			if (signal.aborted) return;
		}

		doStream();
	}

	function send(message: string): void {
		lastUserMessage = message;

		// Add system prompt to messages on first send (visible in messages store)
		if (opts?.systemPrompt && !systemPromptAdded) {
			systemPromptAdded = true;
			messagesStore.update((prev) => [
				{ role: "system" as const, content: opts.systemPrompt! },
				...prev,
			]);
		}

		const userMsg: ChatMessage = { role: "user", content: message };
		messagesStore.update((prev) => [...prev, userMsg]);

		// Cancel any existing stream, then set up new abort controller BEFORE any async work
		cancelStream();
		abortController = new AbortController();
		const signal = abortController.signal;

		streamResponse(signal);
	}

	function stop(): void {
		if (!streamingStore.get()) return;
		stopped = true; // prevent streamResponse from adding duplicate messages
		const accumulated = partialStore.get();
		cancelStream();

		// Add partial response as message if any content was accumulated
		if (accumulated.length > 0) {
			const partialMsg: ChatMessage = {
				role: "assistant",
				content: accumulated,
			};
			messagesStore.update((prev) => [...prev, partialMsg]);
		}
		partialStore.set("");
	}

	function retry(): void {
		if (lastUserMessage === null) return;
		// Remove the last assistant message (if any) and last user message
		const msgs = messagesStore.get();
		let trimmed = [...msgs];

		// Remove trailing assistant message
		if (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "assistant") {
			trimmed = trimmed.slice(0, -1);
		}
		// Remove trailing user message
		if (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "user") {
			trimmed = trimmed.slice(0, -1);
		}

		messagesStore.set(trimmed);
		send(lastUserMessage);
	}

	function clear(): void {
		cancelStream();
		messagesStore.set([]);
		partialStore.set("");
		errorStore.set(undefined);
		lastUserMessage = null;
		systemPromptAdded = false;
	}

	function setMessages(messages: ChatMessage[]): void {
		messagesStore.set(messages);
		// If messages include a system prompt, mark it as added
		if (messages.length > 0 && messages[0].role === "system") {
			systemPromptAdded = true;
		}
	}

	return {
		send,
		stop,
		retry,
		clear,
		messages: messagesStore,
		partial: partialStore,
		streaming: streamingStore,
		error: errorStore,
		setMessages,
	};
}
