import { describe, expect, it, vi } from "vitest";
import type { LLMToolCall } from "../../ai/fromLLM";
import { fromLLM, toToolCallRequests } from "../../ai/fromLLM";
import { subscribe } from "../../core/subscribe";

/** Create a mock SSE response from data lines */
function mockSSEResponse(lines: string[], status = 200): Response {
	const encoder = new TextEncoder();
	const chunks = lines.map((line) => `data: ${line}\n\n`);
	chunks.push("data: [DONE]\n\n");

	let index = 0;
	const stream = new ReadableStream({
		pull(controller) {
			if (index < chunks.length) {
				controller.enqueue(encoder.encode(chunks[index]));
				index++;
			} else {
				controller.close();
			}
		},
	});

	return new Response(stream, {
		status,
		headers: { "Content-Type": "text/event-stream" },
	});
}

/** Create an OpenAI-format SSE chunk */
function openaiChunk(content: string, usage?: Record<string, number>): string {
	const chunk: any = {
		choices: [{ delta: { content }, index: 0, finish_reason: null }],
	};
	if (usage) chunk.usage = usage;
	return JSON.stringify(chunk);
}

/** Create an Ollama-format SSE chunk */
function ollamaChunk(content: string, done = false, evalCount?: number): string {
	const chunk: any = { message: { content }, done };
	if (evalCount !== undefined) {
		chunk.eval_count = evalCount;
		chunk.prompt_eval_count = 10;
	}
	return JSON.stringify(chunk);
}

/** Create an OpenAI-format tool call delta chunk */
function openaiToolCallDelta(
	index: number,
	opts: { id?: string; name?: string; arguments?: string },
): string {
	const delta: any = { tool_calls: [{ index }] };
	const tc = delta.tool_calls[0];
	if (opts.id) tc.id = opts.id;
	tc.function = {};
	if (opts.name) tc.function.name = opts.name;
	if (opts.arguments !== undefined) tc.function.arguments = opts.arguments;
	return JSON.stringify({
		choices: [{ delta, index: 0, finish_reason: null }],
	});
}

/** Create an Ollama-format tool call chunk (complete, not streamed) */
function ollamaToolCallChunk(
	toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
	done = false,
): string {
	return JSON.stringify({
		message: {
			content: "",
			tool_calls: toolCalls.map((tc) => ({
				function: { name: tc.name, arguments: tc.arguments },
			})),
		},
		done,
	});
}

describe("fromLLM", () => {
	it("streams OpenAI-format response", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				mockSSEResponse([openaiChunk("Hello"), openaiChunk(" world"), openaiChunk("!")]),
			);

		const llm = fromLLM({
			provider: "openai",
			apiKey: "test-key",
			model: "gpt-5.4-mini",
			fetch: mockFetch as any,
		});

		const values: string[] = [];
		const unsub = subscribe(llm, (v) => values.push(v));

		llm.generate([{ role: "user", content: "Hi" }]);

		// Wait for streaming to complete
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		expect(llm.get()).toBe("Hello world!");
		expect(values).toEqual(["Hello", "Hello world", "Hello world!"]);
		expect(llm.error.get()).toBeUndefined();

		// Verify fetch was called correctly
		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, init] = mockFetch.mock.calls[0];
		expect(url).toBe("https://api.openai.com/v1/chat/completions");
		expect(init.headers.Authorization).toBe("Bearer test-key");
		expect(JSON.parse(init.body)).toMatchObject({
			model: "gpt-5.4-mini",
			stream: true,
			messages: [{ role: "user", content: "Hi" }],
		});

		unsub.unsubscribe();
	});

	it("streams Ollama-format response", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				mockSSEResponse([
					ollamaChunk("Type"),
					ollamaChunk("Script"),
					ollamaChunk(" is great", true, 15),
				]),
			);

		const llm = fromLLM({
			provider: "ollama",
			model: "llama4",
			fetch: mockFetch as any,
		});

		llm.generate([{ role: "user", content: "Tell me about TS" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		expect(llm.get()).toBe("TypeScript is great");

		const [url] = mockFetch.mock.calls[0];
		expect(url).toBe("http://localhost:11434/api/chat");
	});

	it("extracts OpenAI token usage", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				mockSSEResponse([
					openaiChunk("Hi", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
				]),
			);

		const llm = fromLLM({ provider: "openai", model: "gpt-5.4-mini", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "test" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		expect(llm.tokens.get()).toEqual({
			promptTokens: 10,
			completionTokens: 5,
			totalTokens: 15,
		});
	});

	it("extracts Ollama token usage", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockSSEResponse([ollamaChunk("done", true, 20)]));

		const llm = fromLLM({ provider: "ollama", model: "llama4", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "test" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		expect(llm.tokens.get()).toEqual({
			promptTokens: 10,
			completionTokens: 20,
			totalTokens: 30,
		});
	});

	it("handles API error response", async () => {
		const mockFetch = vi.fn().mockResolvedValue(new Response("Rate limited", { status: 429 }));

		const llm = fromLLM({ provider: "openai", model: "gpt-5.4-mini", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "test" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("errored"), { timeout: 1000 });

		expect(llm.error.get()).toBeInstanceOf(Error);
		expect((llm.error.get() as Error).message).toContain("429");
	});

	it("handles fetch error", async () => {
		const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));

		const llm = fromLLM({ provider: "openai", model: "gpt-5.4-mini", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "test" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("errored"), { timeout: 1000 });

		expect(llm.error.get()).toBeInstanceOf(Error);
	});

	it("abort cancels streaming", async () => {
		let _controller: ReadableStreamDefaultController;
		const stream = new ReadableStream({
			start(c) {
				_controller = c;
			},
		});
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
			);

		const llm = fromLLM({ provider: "openai", model: "gpt-5.4-mini", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "test" }]);

		// Let fetch resolve
		await new Promise((r) => setTimeout(r, 10));
		expect(llm.status.get()).toBe("active");

		llm.abort();
		expect(llm.status.get()).toBe("pending");
		expect(llm.get()).toBe("");
	});

	it("generate auto-cancels previous generation", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce(mockSSEResponse([openaiChunk("first")]))
			.mockResolvedValueOnce(mockSSEResponse([openaiChunk("second")]));

		const llm = fromLLM({ provider: "openai", model: "gpt-5.4-mini", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "first" }]);
		// Auto-cancels first
		llm.generate([{ role: "user", content: "second" }]);

		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		// Second call should have completed
		expect(llm.get()).toBe("second");
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("passes generate options correctly", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockSSEResponse([openaiChunk("ok")]));

		const llm = fromLLM({ provider: "openai", model: "gpt-5.4-mini", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "test" }], {
			temperature: 0.5,
			maxTokens: 100,
			stop: ["\n"],
		});

		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.temperature).toBe(0.5);
		expect(body.max_tokens).toBe(100);
		expect(body.stop).toEqual(["\n"]);
	});

	it("Ollama uses num_predict for maxTokens", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockSSEResponse([ollamaChunk("ok")]));

		const llm = fromLLM({ provider: "ollama", model: "llama4", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "test" }], { maxTokens: 200 });

		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.options?.num_predict).toBe(200);
		expect(body.max_tokens).toBeUndefined();
	});

	it("clears error on new generate", async () => {
		const mockFetch = vi
			.fn()
			.mockRejectedValueOnce(new Error("fail"))
			.mockResolvedValueOnce(mockSSEResponse([openaiChunk("ok")]));

		const llm = fromLLM({ provider: "openai", model: "gpt-5.4-mini", fetch: mockFetch as any });

		llm.generate([{ role: "user", content: "test" }]);
		await vi.waitFor(() => expect(llm.error.get()).toBeInstanceOf(Error), { timeout: 1000 });

		llm.generate([{ role: "user", content: "test2" }]);
		expect(llm.error.get()).toBeUndefined();
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });
		expect(llm.get()).toBe("ok");
	});

	it("supports custom baseURL", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockSSEResponse([openaiChunk("hi")]));

		const llm = fromLLM({
			provider: "custom",
			baseURL: "https://my-proxy.com/v1",
			model: "my-model",
			fetch: mockFetch as any,
		});

		llm.generate([{ role: "user", content: "test" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		expect(mockFetch.mock.calls[0][0]).toBe("https://my-proxy.com/v1/chat/completions");
	});

	it("status store is reactive", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockSSEResponse([openaiChunk("ok")]));

		const llm = fromLLM({ provider: "openai", model: "gpt-5.4-mini", fetch: mockFetch as any });

		const statuses: string[] = [];
		const unsub = subscribe(llm.status, (v) => statuses.push(v));

		llm.generate([{ role: "user", content: "test" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		expect(statuses).toContain("active");
		expect(statuses[statuses.length - 1]).toBe("completed");
		unsub.unsubscribe();
	});

	it("auto-cancel actually aborts first generation", async () => {
		// First response is delayed — simulates slow stream
		let _firstController: ReadableStreamDefaultController;
		const firstStream = new ReadableStream({
			start(c) {
				_firstController = c;
			},
		});
		const firstResponse = new Response(firstStream, {
			status: 200,
			headers: { "Content-Type": "text/event-stream" },
		});

		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce(firstResponse)
			.mockResolvedValueOnce(mockSSEResponse([openaiChunk("second")]));

		const llm = fromLLM({ provider: "openai", model: "gpt-5.4-mini", fetch: mockFetch as any });

		llm.generate([{ role: "user", content: "first" }]);
		// Let fetch resolve
		await new Promise((r) => setTimeout(r, 10));

		// Second generate aborts first
		llm.generate([{ role: "user", content: "second" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		// Should have second result, not first
		expect(llm.get()).toBe("second");
		// Both fetches were called, proving first was cancelled and second started
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("skips malformed JSON chunks mid-stream", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				mockSSEResponse([openaiChunk("Hello"), "not valid json at all", openaiChunk(" world")]),
			);

		const llm = fromLLM({ provider: "openai", model: "gpt-5.4-mini", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "test" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		expect(llm.get()).toBe("Hello world");
		expect(llm.error.get()).toBeUndefined();
	});

	// -----------------------------------------------------------------------
	// Tool calling: OpenAI format
	// -----------------------------------------------------------------------

	it("parses OpenAI streamed tool calls", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			mockSSEResponse([
				// First chunk: tool call ID + name
				openaiToolCallDelta(0, { id: "call_abc", name: "search", arguments: '{"q' }),
				// Second chunk: more arguments
				openaiToolCallDelta(0, { arguments: 'uery":"wea' }),
				// Third chunk: rest of arguments
				openaiToolCallDelta(0, { arguments: 'ther"}' }),
			]),
		);

		const llm = fromLLM({ provider: "openai", model: "gpt-4o", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "What's the weather?" }], {
			tools: [
				{
					type: "function",
					function: {
						name: "search",
						description: "Search the web",
						parameters: { type: "object", properties: { query: { type: "string" } } },
					},
				},
			],
		});

		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		const calls = llm.toolCalls.get();
		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({
			id: "call_abc",
			name: "search",
			arguments: '{"query":"weather"}',
		});
	});

	it("parses multiple parallel OpenAI tool calls", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			mockSSEResponse([
				// Two tool calls in parallel
				openaiToolCallDelta(0, { id: "call_1", name: "search", arguments: '{"q":"a"}' }),
				openaiToolCallDelta(1, { id: "call_2", name: "calc", arguments: '{"x":42}' }),
			]),
		);

		const llm = fromLLM({ provider: "openai", model: "gpt-4o", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "test" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		const calls = llm.toolCalls.get();
		expect(calls).toHaveLength(2);
		expect(calls[0].name).toBe("search");
		expect(calls[1].name).toBe("calc");
		expect(JSON.parse(calls[1].arguments)).toEqual({ x: 42 });
	});

	it("toolCalls store is reactive during streaming", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				mockSSEResponse([
					openaiToolCallDelta(0, { id: "call_1", name: "search", arguments: '{"q' }),
					openaiToolCallDelta(0, { arguments: '":"test"}' }),
				]),
			);

		const llm = fromLLM({ provider: "openai", model: "gpt-4o", fetch: mockFetch as any });

		const snapshots: LLMToolCall[][] = [];
		const unsub = subscribe(llm.toolCalls, (v) => {
			// Only capture non-empty snapshots (skip initial [] and reset [])
			if (v.length > 0) snapshots.push([...v]);
		});

		llm.generate([{ role: "user", content: "test" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		// Should have received multiple updates as arguments accumulated
		expect(snapshots.length).toBeGreaterThanOrEqual(2);
		// First snapshot has partial arguments
		expect(snapshots[0][0].arguments).toBe('{"q');
		// Last snapshot has full arguments
		expect(snapshots[snapshots.length - 1][0].arguments).toBe('{"q":"test"}');

		unsub.unsubscribe();
	});

	it("handles mixed text content + tool calls", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				mockSSEResponse([
					openaiChunk("Let me search for that."),
					openaiToolCallDelta(0, { id: "call_1", name: "search", arguments: '{"q":"weather"}' }),
				]),
			);

		const llm = fromLLM({ provider: "openai", model: "gpt-4o", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "test" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		expect(llm.get()).toBe("Let me search for that.");
		expect(llm.toolCalls.get()).toHaveLength(1);
		expect(llm.toolCalls.get()[0].name).toBe("search");
	});

	// -----------------------------------------------------------------------
	// Tool calling: Ollama format
	// -----------------------------------------------------------------------

	it("parses Ollama tool calls (complete in one chunk)", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				mockSSEResponse([
					ollamaToolCallChunk([{ name: "search", arguments: { query: "weather" } }], true),
				]),
			);

		const llm = fromLLM({ provider: "ollama", model: "llama4", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "What's the weather?" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		const calls = llm.toolCalls.get();
		expect(calls).toHaveLength(1);
		expect(calls[0].name).toBe("search");
		expect(JSON.parse(calls[0].arguments)).toEqual({ query: "weather" });
		// Ollama assigns synthetic IDs
		expect(calls[0].id).toBe("call_0");
	});

	it("parses multiple Ollama tool calls", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			mockSSEResponse([
				ollamaToolCallChunk(
					[
						{ name: "search", arguments: { q: "a" } },
						{ name: "calc", arguments: { x: 42 } },
					],
					true,
				),
			]),
		);

		const llm = fromLLM({ provider: "ollama", model: "llama4", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "test" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		const calls = llm.toolCalls.get();
		expect(calls).toHaveLength(2);
		expect(calls[0].name).toBe("search");
		expect(calls[1].name).toBe("calc");
	});

	// -----------------------------------------------------------------------
	// Tool calling: request body
	// -----------------------------------------------------------------------

	it("includes tools in OpenAI request body", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockSSEResponse([openaiChunk("ok")]));

		const tools = [
			{
				type: "function" as const,
				function: {
					name: "search",
					description: "Search the web",
					parameters: { type: "object", properties: { query: { type: "string" } } },
				},
			},
		];

		const llm = fromLLM({ provider: "openai", model: "gpt-4o", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "test" }], { tools });
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.tools).toEqual(tools);
	});

	it("includes tools in Ollama request body", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockSSEResponse([ollamaChunk("ok")]));

		const tools = [
			{
				type: "function" as const,
				function: { name: "calc", description: "Calculate", parameters: {} },
			},
		];

		const llm = fromLLM({ provider: "ollama", model: "llama4", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "test" }], { tools });
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.tools).toEqual(tools);
	});

	// -----------------------------------------------------------------------
	// Tool calling: message serialization (tool results in conversation)
	// -----------------------------------------------------------------------

	it("serializes tool call messages in OpenAI format", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockSSEResponse([openaiChunk("ok")]));

		const llm = fromLLM({ provider: "openai", model: "gpt-4o", fetch: mockFetch as any });
		llm.generate([
			{ role: "user", content: "What's the weather?" },
			{
				role: "assistant",
				content: null,
				tool_calls: [{ id: "call_1", name: "search", arguments: '{"q":"weather"}' }],
			},
			{ role: "tool", content: "Sunny, 72°F", tool_call_id: "call_1" },
		]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		// Assistant message with tool_calls
		expect(body.messages[1].tool_calls).toEqual([
			{
				id: "call_1",
				type: "function",
				function: { name: "search", arguments: '{"q":"weather"}' },
			},
		]);
		// Tool result message
		expect(body.messages[2].role).toBe("tool");
		expect(body.messages[2].tool_call_id).toBe("call_1");
		expect(body.messages[2].content).toBe("Sunny, 72°F");
	});

	it("serializes tool call messages in Ollama format", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockSSEResponse([ollamaChunk("ok")]));

		const llm = fromLLM({ provider: "ollama", model: "llama4", fetch: mockFetch as any });
		llm.generate([
			{ role: "user", content: "Calculate 2+2" },
			{
				role: "assistant",
				content: null,
				tool_calls: [{ id: "call_0", name: "calc", arguments: '{"x":2,"y":2}' }],
			},
			{ role: "tool", content: "4", tool_call_id: "call_0" },
		]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		// Ollama format: arguments are parsed objects, no ID on tool_calls
		expect(body.messages[1].tool_calls).toEqual([
			{ function: { name: "calc", arguments: { x: 2, y: 2 } } },
		]);
	});

	// -----------------------------------------------------------------------
	// Tool calling: reset behavior
	// -----------------------------------------------------------------------

	it("clears toolCalls on new generate", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce(
				mockSSEResponse([
					openaiToolCallDelta(0, { id: "call_1", name: "search", arguments: '{"q":"a"}' }),
				]),
			)
			.mockResolvedValueOnce(mockSSEResponse([openaiChunk("plain text")]));

		const llm = fromLLM({ provider: "openai", model: "gpt-4o", fetch: mockFetch as any });

		// First: tool call response
		llm.generate([{ role: "user", content: "test" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });
		expect(llm.toolCalls.get()).toHaveLength(1);

		// Second: plain text response — toolCalls should be cleared
		llm.generate([{ role: "user", content: "test2" }]);
		// toolCalls cleared immediately on new generate
		expect(llm.toolCalls.get()).toEqual([]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });
		expect(llm.toolCalls.get()).toEqual([]);
	});

	it("abort clears toolCalls", async () => {
		let _controller: ReadableStreamDefaultController;
		const stream = new ReadableStream({
			start(c) {
				_controller = c;
			},
		});
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
			);

		const llm = fromLLM({ provider: "openai", model: "gpt-4o", fetch: mockFetch as any });
		llm.generate([{ role: "user", content: "test" }]);
		await new Promise((r) => setTimeout(r, 10));

		llm.abort();
		expect(llm.toolCalls.get()).toEqual([]);
	});

	// -----------------------------------------------------------------------
	// toToolCallRequests bridge
	// -----------------------------------------------------------------------

	it("toToolCallRequests converts LLMToolCall[] to ToolCallRequest[]", () => {
		const calls: LLMToolCall[] = [
			{ id: "call_1", name: "search", arguments: '{"query":"weather"}' },
			{ id: "call_2", name: "calc", arguments: '{"x":42}' },
		];

		const requests = toToolCallRequests(calls);
		expect(requests).toEqual([
			{ id: "call_1", tool: "search", args: { query: "weather" } },
			{ id: "call_2", tool: "calc", args: { x: 42 } },
		]);
	});

	it("toToolCallRequests passes through malformed JSON as raw string", () => {
		const calls: LLMToolCall[] = [{ id: "call_1", name: "search", arguments: '{"q":"incomplete' }];
		const requests = toToolCallRequests(calls);
		expect(requests).toEqual([{ id: "call_1", tool: "search", args: '{"q":"incomplete' }]);
	});

	it("serializes null content for tool-call-only assistant messages", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockSSEResponse([openaiChunk("ok")]));

		const llm = fromLLM({ provider: "openai", model: "gpt-4o", fetch: mockFetch as any });
		llm.generate([
			{
				role: "assistant",
				content: null,
				tool_calls: [{ id: "call_1", name: "search", arguments: '{"q":"a"}' }],
			},
		]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.messages[0].content).toBeNull();
	});

	it("Ollama tool call IDs are unique across generations", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce(
				mockSSEResponse([ollamaToolCallChunk([{ name: "search", arguments: { q: "a" } }], true)]),
			)
			.mockResolvedValueOnce(
				mockSSEResponse([ollamaToolCallChunk([{ name: "calc", arguments: { x: 1 } }], true)]),
			);

		const llm = fromLLM({ provider: "ollama", model: "llama4", fetch: mockFetch as any });

		// First generation
		llm.generate([{ role: "user", content: "test1" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });
		const firstId = llm.toolCalls.get()[0].id;

		// Second generation
		llm.generate([{ role: "user", content: "test2" }]);
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });
		const secondId = llm.toolCalls.get()[0].id;

		// IDs should be different (monotonic counter, not index-based)
		expect(firstId).not.toBe(secondId);
	});
});
