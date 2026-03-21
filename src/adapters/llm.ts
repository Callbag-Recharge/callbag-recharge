// ---------------------------------------------------------------------------
// fromLLM — unified reactive source for LLM inference
// ---------------------------------------------------------------------------
// Provider-agnostic adapter for LLM streaming. Wraps any OpenAI-compatible
// endpoint (OpenAI, Ollama, Anthropic via proxy, WebLLM, Vercel AI SDK)
// into reactive stores. Token stream as callbag source.
//
// No hard dependencies — uses fetch + SSE parsing. Provider-specific logic
// is minimal (URL patterns, auth headers, response format).
//
// Usage:
//   const llm = fromLLM({ provider: 'ollama', model: 'llama4' });
//   llm.generate([{ role: 'user', content: 'Hello' }]);
//   effect([llm.store], () => console.log(llm.store.get()));
// ---------------------------------------------------------------------------

import { batch } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";

export interface LLMMessage {
	role: "user" | "assistant" | "system";
	content: string;
}

export interface LLMTokenUsage {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
}

export interface LLMOptions {
	/** Provider type. Determines URL patterns and response format. */
	provider: "openai" | "ollama" | "custom";
	/** Base URL for the API. Defaults by provider: openai='https://api.openai.com/v1', ollama='http://localhost:11434'. */
	baseURL?: string;
	/** API key (sent as Bearer token). Not needed for Ollama. */
	apiKey?: string;
	/** Model name. */
	model?: string;
	/** Debug name for stores. */
	name?: string;
	/** Custom fetch implementation (for testing or edge runtimes). */
	fetch?: typeof globalThis.fetch;
}

export interface GenerateOptions {
	/** Temperature (0-2). */
	temperature?: number;
	/** Max tokens to generate. */
	maxTokens?: number;
	/** Stop sequences. */
	stop?: string[];
	/** AbortSignal for cancellation. */
	signal?: AbortSignal;
}

export interface LLMStore {
	/** Accumulated response text (reactive). */
	store: Store<string>;
	/** Token usage from the last generation (reactive, populated on completion). */
	tokens: Store<LLMTokenUsage>;
	/** Whether a generation is currently streaming (reactive). */
	streaming: Store<boolean>;
	/** Last error, if any (reactive). */
	error: Store<unknown | undefined>;
	/** Start a generation. Aborts any in-progress generation. */
	generate: (messages: LLMMessage[], opts?: GenerateOptions) => void;
	/** Abort the current generation. */
	abort: () => void;
}

function defaultBaseURL(provider: string): string {
	switch (provider) {
		case "openai":
			return "https://api.openai.com/v1";
		case "ollama":
			return "http://localhost:11434";
		default:
			return "";
	}
}

function buildURL(provider: string, baseURL: string): string {
	switch (provider) {
		case "openai":
		case "custom":
			return `${baseURL}/chat/completions`;
		case "ollama":
			return `${baseURL}/api/chat`;
		default:
			return `${baseURL}/chat/completions`;
	}
}

function buildBody(
	provider: string,
	model: string,
	messages: LLMMessage[],
	genOpts?: GenerateOptions,
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model,
		messages,
		stream: true,
	};
	if (genOpts?.temperature !== undefined) body.temperature = genOpts.temperature;
	if (genOpts?.maxTokens !== undefined) {
		// OpenAI uses max_tokens, Ollama uses num_predict
		if (provider === "ollama") body.options = { num_predict: genOpts.maxTokens };
		else body.max_tokens = genOpts.maxTokens;
	}
	if (genOpts?.stop) body.stop = genOpts.stop;
	return body;
}

function buildHeaders(_provider: string, apiKey?: string): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	return headers;
}

/**
 * Creates a unified reactive source for LLM inference via any OpenAI-compatible endpoint.
 *
 * @param opts - Provider configuration (provider, baseURL, apiKey, model).
 *
 * @returns `LLMStore` — reactive stores for response text, token usage, streaming status, error, plus `generate()` and `abort()`.
 *
 * @remarks **Provider-agnostic:** Works with OpenAI, Ollama, Anthropic (via proxy), Vercel AI SDK, or any OpenAI-compatible endpoint.
 * @remarks **No hard deps:** Uses fetch + SSE line parsing. No SDK imports required.
 * @remarks **Auto-cancel:** Calling `generate()` while streaming aborts the previous generation.
 * @remarks **Token tracking:** `tokens` store populated on stream completion (when usage data is available).
 *
 * @example
 * ```ts
 * import { fromLLM } from 'callbag-recharge/adapters/llm';
 * import { effect } from 'callbag-recharge';
 *
 * const llm = fromLLM({ provider: 'ollama', model: 'llama4' });
 *
 * effect([llm.store], () => {
 *   console.log(llm.store.get()); // accumulating response...
 * });
 *
 * llm.generate([{ role: 'user', content: 'What is TypeScript?' }]);
 * // llm.streaming.get() → true
 * // llm.store.get() → "TypeScript is..."
 * ```
 *
 * @seeAlso [chatStream](/api/chatStream) — full chat pattern, [tokenTracker](/api/tokenTracker) — token tracking
 *
 * @category adapters
 */
export function fromLLM(opts: LLMOptions): LLMStore {
	const name = opts.name ?? "llm";
	const provider = opts.provider;
	const baseURL = opts.baseURL ?? defaultBaseURL(provider);
	const model = opts.model ?? "";
	const fetchFn = opts.fetch ?? globalThis.fetch;

	const storeState = state<string>("", { name: `${name}.store` });
	const tokensState = state<LLMTokenUsage>({}, { name: `${name}.tokens` });
	const streamingState = state<boolean>(false, { name: `${name}.streaming` });
	const errorState = state<unknown | undefined>(undefined, { name: `${name}.error` });

	let abortController: AbortController | null = null;

	function abort(): void {
		if (abortController) {
			abortController.abort();
			abortController = null;
		}
		streamingState.set(false);
	}

	function generate(messages: LLMMessage[], genOpts?: GenerateOptions): void {
		// Abort any in-progress generation
		abort();

		abortController = new AbortController();
		const signal = genOpts?.signal
			? combineSignals(abortController.signal, genOpts.signal)
			: abortController.signal;

		batch(() => {
			storeState.set("");
			tokensState.set({});
			errorState.set(undefined);
			streamingState.set(true);
		});

		const url = buildURL(provider, baseURL);
		const body = buildBody(provider, model, messages, genOpts);
		const headers = buildHeaders(provider, opts.apiKey);

		streamResponse(url, headers, body, signal).catch(() => {});
	}

	async function streamResponse(
		url: string,
		headers: Record<string, string>,
		body: Record<string, unknown>,
		signal: AbortSignal,
	): Promise<void> {
		try {
			const response = await fetchFn(url, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal,
			});

			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new Error(`LLM API error ${response.status}: ${text}`);
			}

			const reader = response.body?.getReader();
			if (!reader) throw new Error("No response body");

			const decoder = new TextDecoder();
			let accumulated = "";
			let buffer = "";

			while (true) {
				if (signal.aborted) return;
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Parse SSE lines
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (signal.aborted) return;

					const trimmed = line.trim();
					if (!trimmed || trimmed.startsWith(":")) continue;
					if (!trimmed.startsWith("data: ")) continue;

					const data = trimmed.slice(6);
					if (data === "[DONE]") continue;

					try {
						const parsed = JSON.parse(data);
						const content = extractContent(provider, parsed);
						if (content) {
							accumulated += content;
							storeState.set(accumulated);
						}

						// Extract token usage (usually in the final chunk)
						const usage = extractUsage(provider, parsed);
						if (usage) {
							tokensState.set(usage);
						}
					} catch {
						// Skip unparseable SSE data lines
					}
				}
			}

			// Flush any remaining bytes from the streaming decoder
			decoder.decode();

			if (signal.aborted) return;
			streamingState.set(false);
			abortController = null;
		} catch (err) {
			if (signal.aborted) return;
			batch(() => {
				errorState.set(err);
				streamingState.set(false);
			});
			abortController = null;
		}
	}

	return {
		store: storeState,
		tokens: tokensState,
		streaming: streamingState,
		error: errorState,
		generate,
		abort,
	};
}

function extractContent(provider: string, parsed: any): string | undefined {
	if (provider === "ollama") {
		return parsed?.message?.content;
	}
	// OpenAI / custom format
	return parsed?.choices?.[0]?.delta?.content;
}

function extractUsage(provider: string, parsed: any): LLMTokenUsage | undefined {
	const usage = provider === "ollama" ? parsed : parsed?.usage;
	if (!usage) return undefined;

	if (provider === "ollama") {
		if (parsed.eval_count !== undefined || parsed.prompt_eval_count !== undefined) {
			return {
				promptTokens: parsed.prompt_eval_count,
				completionTokens: parsed.eval_count,
				totalTokens: (parsed.prompt_eval_count ?? 0) + (parsed.eval_count ?? 0),
			};
		}
		return undefined;
	}

	if (usage.prompt_tokens !== undefined || usage.completion_tokens !== undefined) {
		return {
			promptTokens: usage.prompt_tokens,
			completionTokens: usage.completion_tokens,
			totalTokens: usage.total_tokens,
		};
	}
	return undefined;
}

function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
	const controller = new AbortController();
	const cleanup = () => {
		a.removeEventListener("abort", onAbort);
		b.removeEventListener("abort", onAbort);
	};
	const onAbort = () => {
		controller.abort();
		cleanup();
	};
	a.addEventListener("abort", onAbort, { once: true });
	b.addEventListener("abort", onAbort, { once: true });
	// Expose cleanup for callers that complete without abort
	(controller as any)._cleanup = cleanup;
	return controller.signal;
}
