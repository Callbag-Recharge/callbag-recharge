// ---------------------------------------------------------------------------
// fromMCP — reactive bridge to Model Context Protocol
// ---------------------------------------------------------------------------
// Wraps an MCP client into reactive stores. Each tool becomes a reactive
// source with status tracking. No hard dependency on @modelcontextprotocol/sdk
// — uses a minimal interface that any MCP client can implement.
//
// Usage:
//   const mcp = fromMCP({ client: myMCPClient });
//   const search = mcp.tool<SearchArgs, SearchResult>('search');
//   search.call({ query: 'weather' });
//   effect([search.store], () => console.log(search.store.get()));
// ---------------------------------------------------------------------------

import { state } from "../core/state";
import type { Store } from "../core/types";

export type MCPToolStatus = "idle" | "calling" | "completed" | "errored";

/**
 * Minimal MCP client interface. Compatible with @modelcontextprotocol/sdk Client.
 * Any object implementing these methods can be used.
 */
export interface MCPClientLike {
	/** Call a tool by name with arguments. */
	callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<{
		content: Array<{ type: string; text?: string; [key: string]: unknown }>;
		isError?: boolean;
	}>;
	/** List available tools. */
	listTools?(): Promise<{
		tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
	}>;
	/** List available resources. */
	listResources?(): Promise<{
		resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
	}>;
}

export interface MCPResource {
	uri: string;
	name?: string;
	description?: string;
	mimeType?: string;
}

export interface MCPToolInfo {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

export interface MCPToolStore<TArgs = Record<string, unknown>, TResult = unknown> {
	/** Latest tool call result. */
	store: Store<TResult | undefined>;
	/** Current tool call status. */
	status: Store<MCPToolStatus>;
	/** Last error, if any. */
	error: Store<unknown | undefined>;
	/** Call the tool with arguments. */
	call: (args: TArgs) => Promise<void>;
	/** Last arguments passed to call(). */
	lastArgs: Store<TArgs | undefined>;
	/** Duration of last call in ms. */
	duration: Store<number | undefined>;
}

export interface MCPOptions {
	/** MCP client instance (or any object implementing MCPClientLike). */
	client: MCPClientLike;
	/** Debug name for stores. */
	name?: string;
	/** How to handle refresh errors: 'warn' logs to console, 'error' throws, or a custom handler. Default: silent. */
	onRefreshError?: "warn" | "error" | ((err: unknown) => void);
}

export interface MCPResult {
	/** Create a reactive tool store for a named tool. */
	tool: <TArgs = Record<string, unknown>, TResult = unknown>(
		toolName: string,
	) => MCPToolStore<TArgs, TResult>;
	/** Available tools (populated after refresh). */
	tools: Store<MCPToolInfo[]>;
	/** Available resources (populated after refresh). */
	resources: Store<MCPResource[]>;
	/** Refresh the tools and resources lists. */
	refresh: () => Promise<void>;
	/** Last refresh error, if any. */
	refreshError: Store<unknown | undefined>;
}

/**
 * Creates a reactive bridge to a Model Context Protocol server.
 *
 * @param opts - MCP client configuration.
 *
 * @returns `MCPResult` — `tool()` factory, `tools` list, `resources` list, `refresh()`.
 *
 * @remarks **No hard deps:** Uses a minimal `MCPClientLike` interface. Compatible with `@modelcontextprotocol/sdk` Client.
 * @remarks **Per-tool stores:** Each `tool()` call returns independent reactive stores for result, status, error.
 * @remarks **Lazy:** Tool/resource lists are not fetched until `refresh()` is called.
 *
 * @example
 * ```ts
 * import { fromMCP } from 'callbag-recharge/adapters/mcp';
 * import { effect } from 'callbag-recharge';
 *
 * const mcp = fromMCP({ client: myMCPClient });
 * await mcp.refresh(); // load available tools
 *
 * const search = mcp.tool<{ query: string }, string[]>('web_search');
 * await search.call({ query: 'TypeScript reactive' });
 *
 * search.status.get(); // 'completed'
 * search.store.get();  // ['result1', 'result2']
 * ```
 *
 * @seeAlso [toolCallState](/api/toolCallState) — generic tool call state machine, [fromLLM](/api/fromLLM) — LLM adapter
 *
 * @category adapters
 */
export function fromMCP(opts: MCPOptions): MCPResult {
	const name = opts.name ?? "mcp";
	const client = opts.client;

	const toolsStore = state<MCPToolInfo[]>([], { name: `${name}.tools` });
	const resourcesStore = state<MCPResource[]>([], { name: `${name}.resources` });
	const refreshErrorStore = state<unknown | undefined>(undefined, {
		name: `${name}.refreshError`,
	});

	function handleRefreshError(err: unknown): void {
		refreshErrorStore.set(err);
		const handler = opts.onRefreshError;
		if (handler === "warn") console.warn(`[${name}] refresh error:`, err);
		else if (handler === "error") throw err;
		else if (typeof handler === "function") handler(err);
	}

	async function refresh(): Promise<void> {
		refreshErrorStore.set(undefined);
		if (client.listTools) {
			try {
				const result = await client.listTools();
				toolsStore.set(result.tools);
			} catch (err) {
				handleRefreshError(err);
			}
		}
		if (client.listResources) {
			try {
				const result = await client.listResources();
				resourcesStore.set(result.resources);
			} catch (err) {
				handleRefreshError(err);
			}
		}
	}

	function tool<TArgs = Record<string, unknown>, TResult = unknown>(
		toolName: string,
	): MCPToolStore<TArgs, TResult> {
		const prefix = `${name}:${toolName}`;
		const resultStore = state<TResult | undefined>(undefined, { name: `${prefix}.result` });
		const statusStore = state<MCPToolStatus>("idle", { name: `${prefix}.status` });
		const errorStore = state<unknown | undefined>(undefined, { name: `${prefix}.error` });
		const lastArgsStore = state<TArgs | undefined>(undefined, { name: `${prefix}.lastArgs` });
		const durationStore = state<number | undefined>(undefined, { name: `${prefix}.duration` });

		let calling = false;

		async function call(args: TArgs): Promise<void> {
			if (calling) return; // concurrency guard
			calling = true;
			lastArgsStore.set(args);
			errorStore.set(undefined);
			statusStore.set("calling");
			const startTime = Date.now();

			try {
				const response = await client.callTool({
					name: toolName,
					arguments: args as Record<string, unknown>,
				});

				const duration = Date.now() - startTime;
				durationStore.set(duration);

				if (response.isError) {
					const errorText = response.content
						.filter((c) => c.type === "text")
						.map((c) => c.text ?? "")
						.join("\n");
					const err = new Error(errorText || "MCP tool returned error");
					errorStore.set(err);
					statusStore.set("errored");
					return;
				}

				// Extract result — if single text content, return text; otherwise return full content
				const textContent = response.content.filter((c) => c.type === "text");
				let result: unknown;
				if (textContent.length === 1) {
					const text = textContent[0].text;
					if (text !== undefined) {
						try {
							result = JSON.parse(text);
						} catch {
							result = text;
						}
					}
				} else if (textContent.length > 1) {
					result = textContent.map((c) => c.text ?? "");
				} else {
					result = response.content;
				}

				resultStore.set(result as TResult);
				statusStore.set("completed");
			} catch (err) {
				const duration = Date.now() - startTime;
				durationStore.set(duration);
				errorStore.set(err);
				statusStore.set("errored");
			} finally {
				calling = false;
			}
		}

		return {
			store: resultStore,
			status: statusStore,
			error: errorStore,
			call,
			lastArgs: lastArgsStore,
			duration: durationStore,
		};
	}

	return {
		tool,
		tools: toolsStore,
		resources: resourcesStore,
		refresh,
		refreshError: refreshErrorStore,
	};
}
