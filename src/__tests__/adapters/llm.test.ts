import { describe, expect, it, vi } from "vitest";
import { fromLLM } from "../../adapters/llm";
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
		const unsub = subscribe(llm.store, (v) => values.push(v));

		llm.generate([{ role: "user", content: "Hi" }]);

		// Wait for streaming to complete
		await vi.waitFor(() => expect(llm.status.get()).toBe("completed"), { timeout: 1000 });

		expect(llm.store.get()).toBe("Hello world!");
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

		unsub();
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

		expect(llm.store.get()).toBe("TypeScript is great");

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
		expect(llm.store.get()).toBe("second");
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
		expect(llm.store.get()).toBe("ok");
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
		unsub();
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
		expect(llm.store.get()).toBe("second");
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

		expect(llm.store.get()).toBe("Hello world");
		expect(llm.error.get()).toBeUndefined();
	});
});
