// ---------------------------------------------------------------------------
// conversationThread — per-agent conversation isolation with shared context
// ---------------------------------------------------------------------------
// Manages multiple named conversation threads (each wrapping a chatStream),
// with optional shared context visible to all threads. Designed for
// multi-agent systems where each agent needs its own message history but
// shares workspace-level context.
//
// Built on: chatStream (per-thread), state (shared context + thread map)
//
// Usage:
//   const threads = conversationThread({
//     factory: (signal, messages) => llmStream(signal, messages),
//   });
//
//   const planner = threads.create("planner", { systemPrompt: "You plan tasks." });
//   const coder = threads.create("coder", { systemPrompt: "You write code." });
//
//   planner.send("Plan the feature");
//   threads.inject("coder", planner.messages.get()); // cross-thread context
// ---------------------------------------------------------------------------

import { state } from "../../core/state";
import type { Store } from "../../core/types";
import type {
	ChatMessage,
	ChatStreamFactory,
	ChatStreamOptions,
	ChatStreamResult,
} from "../chatStream";
import { chatStream } from "../chatStream";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationThreadOptions {
	/** Factory for creating LLM streams. Each thread uses this to generate responses. */
	factory: ChatStreamFactory;
	/** Default options applied to all threads (can be overridden per-thread). */
	defaults?: Pick<ChatStreamOptions, "rateLimiter" | "onComplete" | "onError">;
	/** Debug name prefix for stores. */
	name?: string;
}

export interface ThreadOptions {
	/** System prompt for this thread. */
	systemPrompt?: string;
	/** Rate limiter override for this thread. */
	rateLimiter?: ChatStreamOptions["rateLimiter"];
	/** Called when a stream in this thread completes. */
	onComplete?: ChatStreamOptions["onComplete"];
	/** Called when a stream in this thread errors. */
	onError?: ChatStreamOptions["onError"];
}

/** A single named conversation thread (thin wrapper around ChatStreamResult). */
export interface Thread extends ChatStreamResult {
	/** Thread identifier. */
	readonly id: string;
}

export interface ConversationThreadResult {
	/** Create a new named thread. Throws if thread ID already exists. */
	create: (threadId: string, opts?: ThreadOptions) => Thread;
	/** Get an existing thread by ID, or undefined if not found. */
	get: (threadId: string) => Thread | undefined;
	/** Check if a thread exists. */
	has: (threadId: string) => boolean;
	/** List all thread IDs. */
	list: () => string[];
	/** Shared context store. Content is injected into each thread's system prompt. */
	shared: Store<string>;
	/**
	 * Inject messages from one thread into another as context.
	 * Messages are prepended to the target thread's history as system messages.
	 */
	inject: (targetThreadId: string, messages: ChatMessage[]) => void;
	/** Destroy a single thread and remove it from the registry. */
	destroyThread: (threadId: string) => void;
	/** Destroy all threads. */
	destroy: () => void;
	/** Reactive count of active threads. */
	threadCount: Store<number>;
}

/**
 * Creates a multi-thread conversation manager for agent-scoped isolation with shared context.
 *
 * @param opts - Factory for LLM streams and optional defaults.
 *
 * @returns `ConversationThreadResult` — `create`, `get`, `has`, `list`, `shared`, `inject`, `destroy`.
 *
 * @remarks **Per-thread isolation:** Each thread maintains its own `chatStream` instance with
 *   independent message history, streaming state, and error handling.
 * @remarks **Shared context:** The `shared` store holds text visible to all threads. When shared
 *   context is set, it is prepended to each thread's message history as a system message on the
 *   next `send()` call via a wrapping factory.
 * @remarks **Cross-thread injection:** `inject(targetId, messages)` adds messages from another
 *   thread as system-role context in the target, enabling agents to share observations.
 *   Injection is additive — each call appends a new system message rather than replacing
 *   previous injections. Call `setMessages()` on the target thread to reset if needed.
 * @remarks **Lifecycle:** Each thread is a chatStream — call `destroyThread(id)` to clear and
 *   remove a single thread, or `destroy()` to tear down all threads.
 *
 * @example
 * ```ts
 * import { conversationThread } from 'callbag-recharge/ai/conversationThread';
 *
 * const threads = conversationThread({
 *   factory: async function* (signal, messages) {
 *     const res = await fetch('/api/chat', {
 *       method: 'POST',
 *       body: JSON.stringify({ messages }),
 *       signal,
 *     });
 *     const reader = res.body!.getReader();
 *     const decoder = new TextDecoder();
 *     while (true) {
 *       const { done, value } = await reader.read();
 *       if (done) break;
 *       yield decoder.decode(value);
 *     }
 *   },
 * });
 *
 * const planner = threads.create("planner", { systemPrompt: "You are a planner." });
 * const coder = threads.create("coder", { systemPrompt: "You write code." });
 *
 * // Set shared context visible to all threads
 * threads.shared.set("Project uses TypeScript and React.");
 *
 * planner.send("Plan the authentication feature");
 * // Later: share planner's output with coder
 * threads.inject("coder", planner.messages.get());
 * coder.send("Implement the plan above.");
 * ```
 *
 * @category ai
 */
export function conversationThread(opts: ConversationThreadOptions): ConversationThreadResult {
	const baseName = opts.name ?? "conversationThread";
	const threads = new Map<string, Thread>();
	const sharedStore = state<string>("", { name: `${baseName}.shared` });
	const threadCountStore = state<number>(0, { name: `${baseName}.threadCount` });

	function create(threadId: string, threadOpts?: ThreadOptions): Thread {
		if (threads.has(threadId)) {
			throw new Error(`Thread "${threadId}" already exists`);
		}

		// Wrap the factory to inject shared context
		const wrappedFactory: ChatStreamFactory = (signal, messages) => {
			const shared = sharedStore.get();
			if (shared) {
				// Inject shared context as a system message after any existing system prompt
				const systemIdx = messages.findIndex((m) => m.role !== "system");
				const insertAt = systemIdx === -1 ? messages.length : systemIdx;
				const injectedMessages = [...messages];
				injectedMessages.splice(insertAt, 0, {
					role: "system",
					content: `[Shared Context]\n${shared}`,
				});
				return opts.factory(signal, injectedMessages);
			}
			return opts.factory(signal, messages);
		};

		const chat = chatStream(wrappedFactory, {
			name: `${baseName}.${threadId}`,
			systemPrompt: threadOpts?.systemPrompt,
			rateLimiter: threadOpts?.rateLimiter ?? opts.defaults?.rateLimiter,
			onComplete: threadOpts?.onComplete ?? opts.defaults?.onComplete,
			onError: threadOpts?.onError ?? opts.defaults?.onError,
		});

		const thread: Thread = {
			id: threadId,
			send: chat.send,
			stop: chat.stop,
			retry: chat.retry,
			clear: chat.clear,
			messages: chat.messages,
			partial: chat.partial,
			streaming: chat.streaming,
			error: chat.error,
			setMessages: chat.setMessages,
		};

		threads.set(threadId, thread);
		threadCountStore.set(threads.size);
		return thread;
	}

	function get(threadId: string): Thread | undefined {
		return threads.get(threadId);
	}

	function has(threadId: string): boolean {
		return threads.has(threadId);
	}

	function list(): string[] {
		return Array.from(threads.keys());
	}

	function inject(targetThreadId: string, messages: ChatMessage[]): void {
		const target = threads.get(targetThreadId);
		if (!target) {
			throw new Error(`Thread "${targetThreadId}" not found`);
		}

		// Format injected messages as a single system message
		const formatted = messages
			.filter((m) => m.role !== "system")
			.map((m) => `[${m.role}]: ${m.content}`)
			.join("\n");

		if (!formatted) return;

		// Prepend as system context in the target thread's history
		const currentMessages = target.messages.get();
		const systemIdx = currentMessages.findIndex((m) => m.role !== "system");
		const insertAt = systemIdx === -1 ? currentMessages.length : systemIdx;
		const updated = [...currentMessages];
		updated.splice(insertAt, 0, {
			role: "system",
			content: `[Cross-Thread Context]\n${formatted}`,
		});
		target.setMessages(updated);
	}

	function destroyThread(threadId: string): void {
		const thread = threads.get(threadId);
		if (!thread) return;
		thread.clear();
		threads.delete(threadId);
		threadCountStore.set(threads.size);
	}

	function destroy(): void {
		for (const [id] of threads) {
			destroyThread(id);
		}
	}

	return {
		create,
		get,
		has,
		list,
		shared: sharedStore,
		inject,
		destroyThread,
		destroy,
		threadCount: threadCountStore,
	};
}
