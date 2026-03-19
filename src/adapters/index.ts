// ---------------------------------------------------------------------------
// Adapters module — external system connectors
// ---------------------------------------------------------------------------

export type { WebhookOptions, WebhookStore } from "./webhook";
export { fromWebhook } from "./webhook";

export type {
	FromWebSocketOptions,
	ToWebSocketOptions,
	WebSocketStatus,
	WebSocketStore,
} from "./websocket";
export { fromWebSocket, toWebSocket } from "./websocket";
