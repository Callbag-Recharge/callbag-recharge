# wsMessageTransport()

Create a WebSocket-based message transport for topic bridges.

## Signature

```ts
function wsMessageTransport(url: string, opts?: WsTransportOpts): MessageTransport
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | WebSocket URL (ws:// or wss://). |
| `opts` | `WsTransportOpts` | Transport options. |

## Returns

`MessageTransport` — send/receive envelopes over WebSocket with auto-reconnect.

## Options / Behavior Details

- **Auto-reconnect:** When the connection drops, the transport automatically
reconnects with exponential backoff (up to `maxReconnectDelay`). Set `reconnect: false`
to disable.
- **Browser + Node:** Uses native `WebSocket` from `globalThis`. Node 21+ has
native WebSocket support. For older Node, assign the `ws` package to `globalThis.WebSocket`.
