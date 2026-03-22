# subscription()

Create a cursor-based consumer on a topic.

## Signature

```ts
function subscription<T>(
	topicRef: Topic<T>,
	opts?: SubscriptionOptions<T>,
): TopicSubscription<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `topicRef` | `Topic&lt;T&gt;` | The topic to consume from. |
| `opts` | `SubscriptionOptions&lt;T&gt;` | Subscription configuration. |

## Returns

`TopicSubscription&lt;T&gt;` — pull-based consumption with ack/nack, seeking, and lifecycle.

## Options / Behavior Details

- **Pull-based backpressure:** Consumer controls read pace via `pull(count)`. Messages
returned are in-flight until acked. Unacked messages auto-nack after `ackTimeout`.
- **Subscription modes:**
- `exclusive` (default): Independent cursor. Each subscription reads all messages.
- `shared`: Same-name subscriptions share a cursor. Messages dispatched round-robin.
- `failover`: Same-name subscriptions share a cursor. Only one active consumer; others standby.
- `key_shared`: Same-name subscriptions share a cursor. Messages routed by partition key hash.
- **Retry + DLQ (5e-4):** Nacked messages retry with configurable backoff. After
`maxRetries`, message routes to `deadLetterTopic` with original headers preserved.
- **Cursor persistence:** Pass a `CheckpointAdapter` to persist cursor position.
