import { describe, expect, it, vi } from "vitest";
import type { MCPClientLike } from "../../adapters/mcp";
import { fromMCP } from "../../adapters/mcp";
import { subscribe } from "../../core/subscribe";

function mockClient(overrides?: Partial<MCPClientLike>): MCPClientLike {
	return {
		callTool: vi.fn().mockResolvedValue({
			content: [{ type: "text", text: '{"result": "ok"}' }],
		}),
		listTools: vi.fn().mockResolvedValue({
			tools: [
				{ name: "search", description: "Search the web" },
				{ name: "calculate", description: "Do math" },
			],
		}),
		listResources: vi.fn().mockResolvedValue({
			resources: [{ uri: "file:///data.json", name: "data", mimeType: "application/json" }],
		}),
		...overrides,
	};
}

describe("fromMCP", () => {
	it("starts with empty tools and resources", () => {
		const mcp = fromMCP({ client: mockClient() });
		expect(mcp.tools.get()).toEqual([]);
		expect(mcp.resources.get()).toEqual([]);
	});

	it("refresh populates tools and resources", async () => {
		const client = mockClient();
		const mcp = fromMCP({ client });

		await mcp.refresh();
		expect(mcp.tools.get()).toHaveLength(2);
		expect(mcp.tools.get()[0].name).toBe("search");
		expect(mcp.resources.get()).toHaveLength(1);
		expect(mcp.resources.get()[0].uri).toBe("file:///data.json");
	});

	it("refresh handles missing listTools/listResources", async () => {
		const client = mockClient();
		delete client.listTools;
		delete client.listResources;

		const mcp = fromMCP({ client });
		await mcp.refresh(); // should not throw
		expect(mcp.tools.get()).toEqual([]);
		expect(mcp.resources.get()).toEqual([]);
	});

	describe("tool()", () => {
		it("starts in idle state", () => {
			const mcp = fromMCP({ client: mockClient() });
			const search = mcp.tool("search");

			expect(search.status.get()).toBe("idle");
			expect(search.store.get()).toBeUndefined();
			expect(search.error.get()).toBeUndefined();
			expect(search.lastArgs.get()).toBeUndefined();
			expect(search.duration.get()).toBeUndefined();
		});

		it("calls tool and gets JSON result", async () => {
			const client = mockClient();
			const mcp = fromMCP({ client });
			const search = mcp.tool<{ query: string }, { result: string }>("search");

			await search.call({ query: "weather" });

			expect(search.status.get()).toBe("completed");
			expect(search.store.get()).toEqual({ result: "ok" });
			expect(search.lastArgs.get()).toEqual({ query: "weather" });
			expect(search.duration.get()).toBeGreaterThanOrEqual(0);
			expect(search.error.get()).toBeUndefined();

			expect(client.callTool).toHaveBeenCalledWith({
				name: "search",
				arguments: { query: "weather" },
			});
		});

		it("handles plain text result", async () => {
			const client = mockClient({
				callTool: vi.fn().mockResolvedValue({
					content: [{ type: "text", text: "Hello world" }],
				}),
			});
			const mcp = fromMCP({ client });
			const tool = mcp.tool("echo");

			await tool.call({});
			expect(tool.store.get()).toBe("Hello world");
		});

		it("handles multiple text content blocks", async () => {
			const client = mockClient({
				callTool: vi.fn().mockResolvedValue({
					content: [
						{ type: "text", text: "line 1" },
						{ type: "text", text: "line 2" },
					],
				}),
			});
			const mcp = fromMCP({ client });
			const tool = mcp.tool("multi");

			await tool.call({});
			expect(tool.store.get()).toEqual(["line 1", "line 2"]);
		});

		it("handles tool error response (isError)", async () => {
			const client = mockClient({
				callTool: vi.fn().mockResolvedValue({
					content: [{ type: "text", text: "Not found" }],
					isError: true,
				}),
			});
			const mcp = fromMCP({ client });
			const tool = mcp.tool("fail");

			await tool.call({});
			expect(tool.status.get()).toBe("errored");
			expect(tool.error.get()).toBeInstanceOf(Error);
			expect((tool.error.get() as Error).message).toBe("Not found");
		});

		it("handles client exception", async () => {
			const client = mockClient({
				callTool: vi.fn().mockRejectedValue(new Error("Network error")),
			});
			const mcp = fromMCP({ client });
			const tool = mcp.tool("broken");

			await tool.call({});
			expect(tool.status.get()).toBe("errored");
			expect(tool.error.get()).toBeInstanceOf(Error);
			expect(tool.duration.get()).toBeGreaterThanOrEqual(0);
		});

		it("clears error on new call", async () => {
			let shouldFail = true;
			const client = mockClient({
				callTool: vi.fn().mockImplementation(async () => {
					if (shouldFail) throw new Error("fail");
					return { content: [{ type: "text", text: "ok" }] };
				}),
			});
			const mcp = fromMCP({ client });
			const tool = mcp.tool("retry");

			await tool.call({});
			expect(tool.status.get()).toBe("errored");

			shouldFail = false;
			await tool.call({});
			expect(tool.status.get()).toBe("completed");
			expect(tool.error.get()).toBeUndefined();
		});

		it("stores are reactive", async () => {
			const client = mockClient();
			const mcp = fromMCP({ client });
			const tool = mcp.tool("search");

			const statuses: string[] = [];
			const unsub = subscribe(tool.status, (s) => statuses.push(s));

			await tool.call({ query: "test" });
			expect(statuses).toContain("calling");
			expect(statuses).toContain("completed");
			unsub();
		});

		it("independent tool instances don't interfere", async () => {
			const client = mockClient();
			const mcp = fromMCP({ client });
			const tool1 = mcp.tool("search");
			const tool2 = mcp.tool("calculate");

			await tool1.call({ query: "hello" });
			expect(tool1.status.get()).toBe("completed");
			expect(tool2.status.get()).toBe("idle");
		});

		it("handles non-text content", async () => {
			const client = mockClient({
				callTool: vi.fn().mockResolvedValue({
					content: [{ type: "image", data: "base64..." }],
				}),
			});
			const mcp = fromMCP({ client });
			const tool = mcp.tool("screenshot");

			await tool.call({});
			expect(tool.status.get()).toBe("completed");
			expect(tool.store.get()).toEqual([{ type: "image", data: "base64..." }]);
		});

		it("rejects concurrent calls on same tool", async () => {
			let resolveCall: () => void;
			const client = mockClient({
				callTool: vi.fn().mockImplementation(
					() =>
						new Promise((resolve) => {
							resolveCall = () => resolve({ content: [{ type: "text", text: '"first"' }] });
						}),
				),
			});
			const mcp = fromMCP({ client });
			const tool = mcp.tool("search");

			const call1 = tool.call({ query: "a" });
			const call2 = tool.call({ query: "b" }); // should be rejected

			resolveCall!();
			await call1;
			await call2;

			// Only first call should have been made
			expect(client.callTool).toHaveBeenCalledTimes(1);
			expect(tool.store.get()).toBe("first");
		});

		it("handles empty content array", async () => {
			const client = mockClient({
				callTool: vi.fn().mockResolvedValue({
					content: [],
				}),
			});
			const mcp = fromMCP({ client });
			const tool = mcp.tool("empty");

			await tool.call({});
			expect(tool.status.get()).toBe("completed");
			expect(tool.store.get()).toEqual([]);
		});
	});

	it("refresh error preserves existing data and exposes error", async () => {
		let shouldFail = false;
		const client = mockClient({
			listTools: vi.fn().mockImplementation(async () => {
				if (shouldFail) throw new Error("refresh failed");
				return { tools: [{ name: "search" }] };
			}),
		});
		const mcp = fromMCP({ client });

		await mcp.refresh();
		expect(mcp.tools.get()).toHaveLength(1);

		shouldFail = true;
		await mcp.refresh();

		// Old data preserved
		expect(mcp.tools.get()).toHaveLength(1);
		// Error exposed
		expect(mcp.refreshError.get()).toBeInstanceOf(Error);
	});

	it("onRefreshError 'warn' logs to console", async () => {
		const client = mockClient({
			listTools: vi.fn().mockRejectedValue(new Error("fail")),
		});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const mcp = fromMCP({ client, onRefreshError: "warn" });

		await mcp.refresh();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
