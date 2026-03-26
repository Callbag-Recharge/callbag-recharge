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
// Supports structured output: tool_calls from SSE chunks are parsed and
// accumulated into a reactive `toolCalls` store. Pass `tools` in
// GenerateOptions to enable function calling.
//
// Usage:
//   const llm = fromLLM({ provider: 'ollama', model: 'llama4' });
//   llm.generate([{ role: 'user', content: 'Hello' }]);
//   effect([llm], () => console.log(llm.get()));
//
//   // With tool calling:
//   llm.generate(messages, { tools: registry.definitions() });
//   effect([llm.toolCalls], () => {
//     const calls = llm.toolCalls.get();
//     if (calls.length > 0) registry.execute(toToolCallRequests(calls));
//   });
// ---------------------------------------------------------------------------

import { batch } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";
import { rawFromAny } from "../raw/fromAny";
import { rawFromAsyncIter } from "../raw/fromAsyncIter";
import { rawSubscribe } from "../raw/subscribe";
import type { WithStatusStatus } from "../utils/withStatus";

// ---------------------------------------------------------------------------
// Message types — support both text and tool call messages
// ---------------------------------------------------------------------------

/** Role for LLM messages. */
export type LLMRole = "user" | "assistant" | "system" | "tool";

/** A tool call emitted by the LLM (from assistant message). */
export interface LLMToolCall {
	/** Tool call ID assigned by the LLM (for matching tool results). */
	id: string;
	/** Tool/function name. */
	name: string;
	/** Raw JSON string of arguments. Call JSON.parse() to get structured args. */
	arguments: string;
}

/** An LLM message. Supports text content and/or tool calls. */
export interface LLMMessage {
	role: LLMRole;
	/** Text content. May be empty/null for pure tool-call messages. */
	content: string | null;
	/** Tool calls requested by the assistant (only on role="assistant"). */
	tool_calls?: LLMToolCall[];
	/** Tool call ID this message responds to (only on role="tool"). */
	tool_call_id?: string;
}

/** Token usage metadata from the LLM response. */
export interface LLMTokenUsage {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
}

/** Tool definition in OpenAI function-calling format. */
export interface LLMToolDefinition {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters?: Record<string, unknown>;
	};
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
	/** Tool definitions for function calling. Pass `registry.definitions()` from toolRegistry. */
	tools?: LLMToolDefinition[];
}

export interface LLMStore extends Store<string> {
	/** Token usage from the last generation (reactive, populated on completion). */
	tokens: Store<LLMTokenUsage>;
	/** Lifecycle status: pending → active → completed/errored. */
	status: Store<WithStatusStatus>;
	/** Last error, if any (reactive). */
	error: Store<unknown | undefined>;
	/** Tool calls parsed from the last generation (reactive). Empty array when no tool calls. */
	toolCalls: Store<LLMToolCall[]>;
	/** Start a generation. Aborts any in-progress generation. */
	generate: (messages: LLMMessage[], opts?: GenerateOptions) => void;
	/** Abort the current generation. */
	abort: () => void;
}

/**
 * Convert `LLMToolCall[]` from fromLLM into `ToolCallRequest[]` for toolRegistry.
 * Convenience bridge between the two primitives.
 *
 * Safe to call on partial tool calls mid-stream: malformed JSON arguments
 * are passed through as the raw string rather than throwing.
 */
export function toToolCallRequests(
	calls: LLMToolCall[],
): Array<{ id: string; tool: string; args: unknown }> {
	return calls.map((tc) => {
		let args: unknown;
		try {
			args = JSON.parse(tc.arguments);
		} catch {
			args = tc.arguments;
		}
		return { id: tc.id, tool: tc.name, args };
	});
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
		messages: messages.map((m) => serializeMessage(provider, m)),
		stream: true,
	};
	if (genOpts?.temperature !== undefined) body.temperature = genOpts.temperature;
	if (genOpts?.maxTokens !== undefined) {
		// OpenAI uses max_tokens, Ollama uses num_predict
		if (provider === "ollama") body.options = { num_predict: genOpts.maxTokens };
		else body.max_tokens = genOpts.maxTokens;
	}
	if (genOpts?.stop) body.stop = genOpts.stop;

	// Tool definitions (OpenAI-compatible format used by all providers)
	if (genOpts?.tools && genOpts.tools.length > 0) {
		body.tools = genOpts.tools;
	}

	return body;
}

/** Serialize an LLMMessage for the API request body. */
function serializeMessage(provider: string, msg: LLMMessage): Record<string, unknown> {
	const out: Record<string, unknown> = {
		role: msg.role,
		// Preserve null content for tool-call-only assistant messages (OpenAI expects null, not "")
		content: msg.content,
	};

	// Include tool_calls on assistant messages
	if (msg.tool_calls && msg.tool_calls.length > 0) {
		if (provider === "ollama") {
			out.tool_calls = msg.tool_calls.map((tc) => {
				let args: unknown;
				try {
					args = JSON.parse(tc.arguments);
				} catch {
					args = {};
				}
				return { function: { name: tc.name, arguments: args } };
			});
		} else {
			out.tool_calls = msg.tool_calls.map((tc) => ({
				id: tc.id,
				type: "function",
				function: { name: tc.name, arguments: tc.arguments },
			}));
		}
	}

	// Include tool_call_id on tool messages
	if (msg.tool_call_id) {
		out.tool_call_id = msg.tool_call_id;
	}

	return out;
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
 * @returns `LLMStore` — `Store<string>` with `status`, `error`, `tokens`, `toolCalls` companion stores, plus `generate()` and `abort()`.
 *
 * @remarks **Provider-agnostic:** Works with OpenAI, Ollama, Anthropic (via proxy), Vercel AI SDK, or any OpenAI-compatible endpoint.
 * @remarks **No hard deps:** Uses fetch + SSE line parsing. No SDK imports required.
 * @remarks **Auto-cancel:** Calling `generate()` while streaming aborts the previous generation.
 * @remarks **Tool calling:** Pass `tools` in `GenerateOptions` to enable function calling. Parsed tool calls accumulate in the `toolCalls` store. Use `toToolCallRequests()` to convert to `ToolCallRequest[]` for `toolRegistry.execute()`.
 * @remarks **Token tracking:** `tokens` store populated on stream completion (when usage data is available).
 * @remarks **Status:** Uses WithStatusStatus enum (pending → active → completed/errored) for consistent lifecycle tracking.
 * @remarks **Persistent source:** This is a long-lived store backed by `state()`. It does not send callbag END — lifecycle is managed imperatively via `generate()`/`abort()`, not via stream completion. Do not wrap with `withStatus()` or `retry()` — use the built-in `.status` and `.error` companions instead.
 *
 * @example
 * ```ts
 * import { fromLLM, toToolCallRequests } from 'callbag-recharge/ai';
 * import { effect } from 'callbag-recharge';
 *
 * const llm = fromLLM({ provider: 'openai', apiKey: 'sk-...', model: 'gpt-4o' });
 *
 * // Text generation
 * llm.generate([{ role: 'user', content: 'What is TypeScript?' }]);
 *
 * // Tool calling
 * llm.generate(messages, { tools: registry.definitions() });
 * effect([llm.toolCalls], () => {
 *   const calls = llm.toolCalls.get();
 *   if (calls.length > 0) {
 *     registry.execute(toToolCallRequests(calls));
 *   }
 * });
 * ```
 *
 * @category ai
 */
export function fromLLM(opts: LLMOptions): LLMStore {
	const name = opts.name ?? "llm";
	const provider = opts.provider;
	const baseURL = opts.baseURL ?? defaultBaseURL(provider);
	const model = opts.model ?? "";
	const fetchFn = opts.fetch ?? globalThis.fetch;

	const storeState = state<string>("", { name: `${name}.store` });
	const tokensState = state<LLMTokenUsage>({}, { name: `${name}.tokens` });
	const statusState = state<WithStatusStatus>("pending", { name: `${name}.status` });
	const errorState = state<unknown | undefined>(undefined, { name: `${name}.error` });
	const toolCallsState = state<LLMToolCall[]>([], { name: `${name}.toolCalls` });

	let abortController: AbortController | null = null;
	let generationId = 0;
	let toolCallIdCounter = 0; // monotonic counter for synthetic Ollama tool call IDs

	function abort(): void {
		if (abortController) {
			abortController.abort();
			abortController = null;
		}
		if (statusState.get() === "active") {
			batch(() => {
				storeState.set("");
				toolCallsState.set([]);
				statusState.set("pending");
			});
		}
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
			toolCallsState.set([]);
			statusState.set("active");
		});

		const myGenId = ++generationId;

		try {
			const url = buildURL(provider, baseURL);
			const body = buildBody(provider, model, messages, genOpts);
			const headers = buildHeaders(provider, opts.apiKey);

			streamResponse(url, headers, body, signal, myGenId);
		} catch (err) {
			batch(() => {
				errorState.set(err);
				statusState.set("errored");
			});
			if (generationId === myGenId) abortController = null;
			(signal as any)._cleanup?.();
		}
	}

	function streamResponse(
		url: string,
		headers: Record<string, string>,
		body: Record<string, unknown>,
		signal: AbortSignal,
		genId: number,
	): void {
		// Helper: only null out abortController if this generation is still current
		const clearController = () => {
			if (generationId === genId) abortController = null;
		};
		rawSubscribe(
			rawFromAny(
				fetchFn(url, {
					method: "POST",
					headers,
					body: JSON.stringify(body),
					signal,
				}),
			),
			(response: Response) => {
				if (!response.ok) {
					// Read error text then report
					rawSubscribe(rawFromAny(response.text().catch(() => "")), (text: string) => {
						if (signal.aborted) return;
						batch(() => {
							errorState.set(new Error(`LLM API error ${response.status}: ${text}`));
							statusState.set("errored");
						});
						clearController();
						(signal as any)._cleanup?.();
					});
					return;
				}

				const reader = response.body?.getReader();
				if (!reader) {
					if (signal.aborted) {
						(signal as any)._cleanup?.();
						return;
					}
					batch(() => {
						errorState.set(new Error("No response body"));
						statusState.set("errored");
					});
					clearController();
					(signal as any)._cleanup?.();
					return;
				}

				// Stream chunks via async iterator adapter
				const decoder = new TextDecoder();
				let accumulated = "";
				let buffer = "";
				// Accumulator for incremental tool call deltas (keyed by index)
				const toolCallAccum: Map<number, { id: string; name: string; arguments: string }> =
					new Map();

				const readerIterable: AsyncIterable<Uint8Array> = {
					[Symbol.asyncIterator]() {
						return {
							next() {
								return reader.read() as Promise<IteratorResult<Uint8Array>>;
							},
							return() {
								reader.cancel();
								return Promise.resolve({ done: true, value: undefined });
							},
						};
					},
				};

				rawSubscribe(
					rawFromAsyncIter(readerIterable),
					(value: Uint8Array) => {
						if (signal.aborted) return;

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

								// Extract text content
								const content = extractContent(provider, parsed);
								if (content) {
									accumulated += content;
									storeState.set(accumulated);
								}

								// Extract tool call deltas — only update store when accumulator changed
								if (
									extractToolCallDeltas(
										provider,
										parsed,
										toolCallAccum,
										() => `call_${toolCallIdCounter++}`,
									)
								) {
									const calls: LLMToolCall[] = [];
									for (const [, tc] of toolCallAccum) {
										calls.push({
											id: tc.id,
											name: tc.name,
											arguments: tc.arguments,
										});
									}
									toolCallsState.set(calls);
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
					},
					{
						onEnd: (err?: unknown) => {
							// Flush remaining buffer before finalizing
							const remainder = decoder.decode();
							if (remainder) buffer += remainder;

							// Process any remaining buffered SSE line (#10: flush buffer on end)
							if (buffer.trim()) {
								const trimmed = buffer.trim();
								if (trimmed.startsWith("data: ")) {
									const data = trimmed.slice(6);
									if (data !== "[DONE]") {
										try {
											const parsed = JSON.parse(data);
											const content = extractContent(provider, parsed);
											if (content) {
												accumulated += content;
												storeState.set(accumulated);
											}
											if (
												extractToolCallDeltas(
													provider,
													parsed,
													toolCallAccum,
													() => `call_${toolCallIdCounter++}`,
												)
											) {
												const calls: LLMToolCall[] = [];
												for (const [, tc] of toolCallAccum) {
													calls.push({ id: tc.id, name: tc.name, arguments: tc.arguments });
												}
												toolCallsState.set(calls);
											}
											const usage = extractUsage(provider, parsed);
											if (usage) tokensState.set(usage);
										} catch {
											// skip
										}
									}
								}
							}

							if (signal.aborted) {
								(signal as any)._cleanup?.();
								return;
							}
							if (err !== undefined) {
								batch(() => {
									errorState.set(err);
									statusState.set("errored");
								});
							} else {
								statusState.set("completed");
							}
							clearController();
							(signal as any)._cleanup?.();
						},
					},
				);
			},
			{
				onEnd: (err?: unknown) => {
					if (err !== undefined) {
						if (signal.aborted) {
							(signal as any)._cleanup?.();
							return;
						}
						batch(() => {
							errorState.set(err);
							statusState.set("errored");
						});
						clearController();
					}
					// Always clean up signal listeners regardless of error/abort state
					(signal as any)._cleanup?.();
				},
			},
		);
	}

	return {
		get: () => storeState.get(),
		source: (type: number, payload?: any) => storeState.source(type, payload),
		tokens: tokensState,
		status: statusState,
		error: errorState,
		toolCalls: toolCallsState,
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

/**
 * Extract tool call deltas from a parsed SSE chunk and accumulate into the map.
 *
 * OpenAI streams tool calls incrementally:
 *   choices[0].delta.tool_calls: [{ index, id?, function: { name?, arguments? } }]
 * Each chunk may contain partial data — id and name appear in the first chunk,
 * arguments are streamed across multiple chunks.
 *
 * Ollama sends tool calls complete (non-streaming) in the final message:
 *   message.tool_calls: [{ function: { name, arguments } }]
 */
/** Returns true if the accumulator was modified (caller should update the store). */
function extractToolCallDeltas(
	provider: string,
	parsed: any,
	accum: Map<number, { id: string; name: string; arguments: string }>,
	nextId?: () => string,
): boolean {
	if (provider === "ollama") {
		// Ollama sends complete tool calls in one chunk
		const toolCalls = parsed?.message?.tool_calls;
		if (!Array.isArray(toolCalls)) return false;
		let changed = false;
		for (let i = 0; i < toolCalls.length; i++) {
			const tc = toolCalls[i];
			const fn = tc?.function;
			if (!fn) continue;
			accum.set(i, {
				id: nextId ? nextId() : `call_${i}`,
				name: fn.name ?? "",
				arguments:
					typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
			});
			changed = true;
		}
		return changed;
	}

	// OpenAI / custom format — incremental deltas
	const deltas = parsed?.choices?.[0]?.delta?.tool_calls;
	if (!Array.isArray(deltas)) return false;

	let changed = false;
	for (const delta of deltas) {
		const idx = delta.index ?? 0;
		let entry = accum.get(idx);
		if (!entry) {
			entry = { id: "", name: "", arguments: "" };
			accum.set(idx, entry);
		}
		if (delta.id) {
			entry.id = delta.id;
			changed = true;
		}
		if (delta.function?.name) {
			entry.name = delta.function.name;
			changed = true;
		}
		if (delta.function?.arguments) {
			entry.arguments += delta.function.arguments;
			changed = true;
		}
	}
	return changed;
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
	const sig = controller.signal;

	// Handle already-aborted signals
	if (a.aborted || b.aborted) {
		controller.abort();
		(sig as any)._cleanup = () => {};
		return sig;
	}

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
	// Expose cleanup on signal for callers that complete without abort
	(sig as any)._cleanup = cleanup;
	return sig;
}
