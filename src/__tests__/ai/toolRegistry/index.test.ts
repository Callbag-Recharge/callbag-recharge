import { describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../../../ai/toolRegistry";
import { toolRegistry } from "../../../ai/toolRegistry";
import { rawSubscribe } from "../../../raw/subscribe";

describe("toolRegistry", () => {
	// --- Basic creation ---

	it("creates with tools and starts with empty stores", () => {
		const reg = toolRegistry({
			tools: {
				search: {
					description: "Search",
					handler: (_signal, args: any) => ({ results: [args.query] }),
				},
			},
		});

		expect(reg.active.get()).toBe(0);
		expect(reg.history.get()).toEqual([]);
		expect(reg.lastResults.get()).toEqual([]);
		expect(reg.has("search")).toBe(true);
		expect(reg.has("nonexistent")).toBe(false);

		reg.destroy();
	});

	// --- definitions() ---

	it("returns OpenAI-compatible tool definitions", () => {
		const reg = toolRegistry({
			tools: {
				search: {
					description: "Search the web",
					parameters: {
						type: "object",
						properties: { query: { type: "string" } },
						required: ["query"],
					},
					handler: () => [],
				},
				calc: {
					description: "Calculate math",
					handler: () => 0,
				},
			},
		});

		const defs = reg.definitions();
		expect(defs).toHaveLength(2);
		expect(defs[0]).toEqual({
			type: "function",
			function: {
				name: "search",
				description: "Search the web",
				parameters: {
					type: "object",
					properties: { query: { type: "string" } },
					required: ["query"],
				},
			},
		});
		expect(defs[1]).toEqual({
			type: "function",
			function: {
				name: "calc",
				description: "Calculate math",
			},
		});

		reg.destroy();
	});

	// --- dispatch() inline ---

	it("dispatches inline tool call and updates stores", async () => {
		const handler = vi.fn((_signal: AbortSignal, args: any) => `result:${args.q}`);

		const reg = toolRegistry({
			tools: {
				search: { description: "Search", handler },
			},
		});

		reg.dispatch("search", { q: "hello" }, "call-1");

		// rawFromAny wraps sync return — wait a tick for callbag processing
		await vi.waitFor(() => {
			expect(reg.history.get()).toHaveLength(1);
		});

		const entry = reg.history.get()[0];
		expect(entry.tool).toBe("search");
		expect(entry.id).toBe("call-1");
		expect(entry.result).toBe("result:hello");
		expect(entry.status).toBe("completed");
		expect(entry.duration).toBeGreaterThanOrEqual(0);
		expect(handler).toHaveBeenCalledOnce();

		reg.destroy();
	});

	it("dispatches async tool call", async () => {
		const reg = toolRegistry({
			tools: {
				slow: {
					description: "Slow tool",
					handler: async (_signal: AbortSignal, args: any) => {
						return `done:${args.x}`;
					},
				},
			},
		});

		reg.dispatch("slow", { x: 42 });

		await vi.waitFor(() => {
			expect(reg.history.get()).toHaveLength(1);
		});

		expect(reg.history.get()[0].result).toBe("done:42");
		expect(reg.history.get()[0].status).toBe("completed");

		reg.destroy();
	});

	it("handles unknown tool gracefully", async () => {
		const reg = toolRegistry({ tools: {} });

		reg.dispatch("nonexistent", {});

		await vi.waitFor(() => {
			expect(reg.history.get()).toHaveLength(1);
		});

		const entry = reg.history.get()[0];
		expect(entry.status).toBe("errored");
		expect(entry.error).toBeInstanceOf(Error);
		expect((entry.error as Error).message).toContain("Unknown tool");

		reg.destroy();
	});

	it("handles handler error", async () => {
		const reg = toolRegistry({
			tools: {
				fail: {
					description: "Fails",
					handler: () => {
						throw new Error("boom");
					},
				},
			},
		});

		reg.dispatch("fail", {});

		await vi.waitFor(() => {
			expect(reg.history.get()).toHaveLength(1);
		});

		expect(reg.history.get()[0].status).toBe("errored");
		expect((reg.history.get()[0].error as Error).message).toBe("boom");

		reg.destroy();
	});

	// --- Schema validation ---

	it("validates args with schema", async () => {
		const reg = toolRegistry({
			tools: {
				typed: {
					description: "Typed tool",
					schema: {
						parse(value: unknown) {
							const v = value as any;
							if (typeof v?.name !== "string") throw new Error("name required");
							return v as { name: string };
						},
					},
					handler: (_signal, args) => `hello ${args.name}`,
				},
			},
		});

		// Valid args
		reg.dispatch("typed", { name: "world" });
		await vi.waitFor(() => {
			expect(reg.history.get()).toHaveLength(1);
		});
		expect(reg.history.get()[0].result).toBe("hello world");

		// Invalid args
		reg.dispatch("typed", { bad: true });
		await vi.waitFor(() => {
			expect(reg.history.get()).toHaveLength(2);
		});
		expect(reg.history.get()[1].status).toBe("errored");

		reg.destroy();
	});

	// --- execute() — batch parallel execution ---

	it("execute returns callbag source emitting results array", async () => {
		const reg = toolRegistry({
			tools: {
				add: {
					description: "Add",
					handler: (_signal: AbortSignal, args: any) => args.a + args.b,
				},
				mul: {
					description: "Multiply",
					handler: (_signal: AbortSignal, args: any) => args.a * args.b,
				},
			},
		});

		const results = await new Promise<ToolResult[]>((resolve) => {
			const source = reg.execute([
				{ id: "c1", tool: "add", args: { a: 1, b: 2 } },
				{ id: "c2", tool: "mul", args: { a: 3, b: 4 } },
			]);
			rawSubscribe(source, (value: unknown) => {
				resolve(value as ToolResult[]);
			});
		});

		expect(results).toHaveLength(2);

		const addResult = results.find((r) => r.tool === "add");
		const mulResult = results.find((r) => r.tool === "mul");
		expect(addResult?.result).toBe(3);
		expect(addResult?.id).toBe("c1");
		expect(mulResult?.result).toBe(12);
		expect(mulResult?.id).toBe("c2");

		// lastResults updated
		expect(reg.lastResults.get()).toHaveLength(2);

		reg.destroy();
	});

	it("execute with empty calls emits immediately", async () => {
		const reg = toolRegistry({ tools: {} });

		const result = await new Promise<unknown>((resolve) => {
			const source = reg.execute([]);
			rawSubscribe(source, (value: unknown) => resolve(value));
		});

		expect(result).toEqual([]);

		reg.destroy();
	});

	it("execute passes ctx through when provided", async () => {
		const reg = toolRegistry({
			tools: {
				noop: { description: "No-op", handler: () => "ok" },
			},
		});

		const ctx = { query: "test", messages: [] };
		const result = await new Promise<unknown>((resolve) => {
			const source = reg.execute([{ tool: "noop", args: {} }], ctx);
			rawSubscribe(source, (value: unknown) => resolve(value));
		});

		// When ctx is provided, execute emits ctx (not results array)
		expect(result).toBe(ctx);

		reg.destroy();
	});

	it("execute handles mixed success and failure", async () => {
		const reg = toolRegistry({
			tools: {
				ok: { description: "OK", handler: () => "success" },
				bad: {
					description: "Bad",
					handler: () => {
						throw new Error("fail");
					},
				},
			},
		});

		const results = await new Promise<ToolResult[]>((resolve) => {
			const source = reg.execute([
				{ tool: "ok", args: {} },
				{ tool: "bad", args: {} },
			]);
			rawSubscribe(source, (value: unknown) => resolve(value as ToolResult[]));
		});

		expect(results).toHaveLength(2);
		const ok = results.find((r) => r.tool === "ok");
		const bad = results.find((r) => r.tool === "bad");
		expect(ok?.status).toBe("completed");
		expect(bad?.status).toBe("errored");

		reg.destroy();
	});

	// --- Queue mode ---

	it("routes tool call through jobQueue when queue option set", async () => {
		const handler = vi.fn(async (_signal: AbortSignal, args: any) => `queued:${args.x}`);

		const reg = toolRegistry({
			tools: {
				durable: {
					description: "Durable tool",
					handler,
					queue: { concurrency: 1 },
				},
			},
		});

		const results = await new Promise<ToolResult[]>((resolve) => {
			const source = reg.execute([{ tool: "durable", args: { x: 99 } }]);
			rawSubscribe(source, (value: unknown) => resolve(value as ToolResult[]));
		});

		expect(results).toHaveLength(1);
		expect(results[0].result).toBe("queued:99");
		expect(results[0].status).toBe("completed");
		expect(handler).toHaveBeenCalledOnce();

		reg.destroy();
	});

	// --- active store ---

	it("tracks active count during execution", async () => {
		let resolveHandler!: (v: string) => void;
		const reg = toolRegistry({
			tools: {
				slow: {
					description: "Slow",
					handler: (_signal: AbortSignal) =>
						new Promise<string>((r) => {
							resolveHandler = r;
						}),
				},
			},
		});

		const resultPromise = new Promise<ToolResult[]>((resolve) => {
			const source = reg.execute([{ tool: "slow", args: {} }]);
			rawSubscribe(source, (value: unknown) => resolve(value as ToolResult[]));
		});

		// Active should be 1 while handler is pending
		await vi.waitFor(() => {
			expect(reg.active.get()).toBe(1);
		});

		resolveHandler("done");

		await resultPromise;
		expect(reg.active.get()).toBe(0);

		reg.destroy();
	});

	// --- History bounded ---

	it("bounds history to maxHistory", async () => {
		const reg = toolRegistry({
			tools: {
				ping: { description: "Ping", handler: () => "pong" },
			},
			maxHistory: 3,
		});

		for (let i = 0; i < 5; i++) {
			reg.dispatch("ping", {}, `call-${i}`);
		}

		await vi.waitFor(() => {
			expect(reg.history.get()).toHaveLength(3);
		});

		// Should keep the last 3
		const ids = reg.history.get().map((h) => h.id);
		expect(ids).toEqual(["call-2", "call-3", "call-4"]);

		reg.destroy();
	});

	// --- destroy ---

	it("dispatch is no-op after destroy", () => {
		const handler = vi.fn(() => "result");
		const reg = toolRegistry({
			tools: { t: { description: "T", handler } },
		});

		reg.destroy();
		reg.dispatch("t", {});

		expect(handler).not.toHaveBeenCalled();
	});
});
