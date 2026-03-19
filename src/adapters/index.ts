// ---------------------------------------------------------------------------
// Adapters module — external system connectors
// ---------------------------------------------------------------------------

export type { FromHTTPOptions, HTTPStatus, HTTPStore } from "./http";
export { fromHTTP } from "./http";
export type { SSEOptions, SSEStore } from "./sse";
export { toSSE } from "./sse";
export type { WebhookOptions, WebhookStore } from "./webhook";
export { fromWebhook } from "./webhook";
export type {
	FromWebSocketOptions,
	ToWebSocketOptions,
	WebSocketStatus,
	WebSocketStore,
} from "./websocket";
export { fromWebSocket, toWebSocket } from "./websocket";
