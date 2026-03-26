# resetCursor()

Reset a subscription's cursor to a new position.

Wraps `sub.seek()` for consistency with the admin API surface.

## Signature

```ts
function resetCursor(
	sub: TopicSubscription<any>,
	position: number | "earliest" | "latest",
): void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sub` | `TopicSubscription&lt;any&gt;` | The subscription to reset. |
| `position` | `number | "earliest" | "latest"` | New cursor position: sequence number, "earliest", or "latest". |
