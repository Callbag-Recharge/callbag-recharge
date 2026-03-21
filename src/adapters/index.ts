// ---------------------------------------------------------------------------
// Adapters module — external system connectors
// ---------------------------------------------------------------------------

export type { FromHTTPOptions, HTTPStore } from "./http";
export { fromHTTP } from "./http";
export type { GenerateOptions, LLMMessage, LLMOptions, LLMStore, LLMTokenUsage } from "./llm";
export { fromLLM } from "./llm";
export type {
	MCPClientLike,
	MCPOptions,
	MCPResource,
	MCPResult,
	MCPToolInfo,
	MCPToolStore,
} from "./mcp";
export { fromMCP } from "./mcp";
export type { SSEOptions, SSEStore } from "./sse";
export { toSSE } from "./sse";
export type { WebhookOptions, WebhookStore } from "./webhook";
export { fromWebhook } from "./webhook";
export type {
	FromWebSocketOptions,
	ToWebSocketOptions,
	WebSocketConnectionState,
	WebSocketStore,
} from "./websocket";
export { fromWebSocket, toWebSocket } from "./websocket";
