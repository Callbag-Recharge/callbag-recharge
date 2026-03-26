# topicBridge()

Create a bidirectional bridge between local topics and a remote endpoint.

Messages published to local topics are forwarded to the remote side via the
transport. Messages received from the remote side are published to the
corresponding local topic. Echo-dedup via `originId` prevents infinite loops.

## Signature

```ts
function topicBridge(
	transport: MessageTransport,
	topics: Record<string, BridgedTopic>,
	opts?: TopicBridgeOpts,
): TopicBridgeResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `transport` | `MessageTransport` | The message transport to use for communication. |
| `topics` | `Record&lt;string, BridgedTopic&gt;` | Map of topic name → bridged topic config. |
| `opts` | `TopicBridgeOpts` | Bridge options. |

## Returns

`TopicBridgeResult` — reactive status, backpressure signals, lifecycle control.

## Options / Behavior Details

- **Echo-dedup:** Each bridge instance has a unique `originId`. Outgoing
messages carry this ID. Incoming messages with the same `originId` are dropped.
- **Filtering:** Outgoing messages are filtered per-topic before forwarding.
Incoming messages are always published to the local topic (the remote side filters).
- **Backpressure (SA-2h):** When a remote consumer's backlog exceeds the
threshold, the bridge receives a backpressure envelope. The corresponding
`backpressure` store flips to `true`.
