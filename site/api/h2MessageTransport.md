# h2MessageTransport()

Create an HTTP/2 bidirectional stream transport for topic bridges (Node only).

## Signature

```ts
function h2MessageTransport(authority: string, opts?: H2TransportOpts): MessageTransport
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `authority` | `string` | HTTP/2 authority URL (e.g. `https://localhost:8443`). |
| `opts` | `H2TransportOpts` | Transport options. |

## Returns

`MessageTransport` — send/receive envelopes over HTTP/2 bidirectional stream.

## Options / Behavior Details

- **Node only.** Uses `node:http2` module. Not available in browsers.
- **Newline-delimited JSON:** Each envelope is sent as a single JSON line
terminated by `\n`. Incoming data is buffered and split on newlines.
- **Auto-reconnect:** Reconnects with exponential backoff on connection loss.
