# rawSubscribe()

Subscribes to a raw callbag source. Calls `cb` on each DATA (type 1)
emission. Returns an object with `unsubscribe()` to disconnect.

## Signature

```ts
function rawSubscribe<T = any>(
	source: CallbagSource,
	cb: (value: T) => void,
	opts?: { onEnd?: (error?: unknown) => void },
): { unsubscribe(): void }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `CallbagSource` | A raw callbag source function. |
| `cb` | `(value: T) =&gt; void` | Called with each emitted value. |
| `opts` | `{ onEnd?: (error?: unknown) =&gt; void }` | Optional `onEnd` when the stream completes or errors. |

## Returns

`{ unsubscribe() }` to disconnect from the source.
