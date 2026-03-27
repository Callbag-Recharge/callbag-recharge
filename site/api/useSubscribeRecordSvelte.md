# useSubscribeRecord() (Svelte)

Subscribe to a dynamic set of keyed store records as a Svelte readable store.

When `keys` changes, old per-key subscriptions are torn down and rebuilt.

## Signature

```ts
function useSubscribeRecord<K extends string, R extends Record<string, any>>(
  keys: Store<K[]>,
  factory: StoreFactory<K, R>,
): SvelteReadable<Record<K, R>>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `keys` | `Store&lt;K[]&gt;` | Store of current keys (for example node IDs). |
| `factory` | `StoreFactory&lt;K, R&gt;` | Returns a `{ [field]: Store&lt;V&gt; }` object for each key. |

## Returns

`SvelteReadable&lt;Record&lt;K, R&gt;&gt;` - Svelte-readable keyed snapshot.

## Basic Usage

```svelte
<script lang="ts">
  const nodeData = useSubscribeRecord(nodeIds, (id) => ({
    status: statusById[id],
    breaker: breakerById[id],
  }));
</script>
```

## See Also

- Generic overview: `/api/useSubscribeRecord`
- `useSubscribe()` (Svelte): `/api/useSubscribeSvelte`
