# useSubscribe() (Svelte)

Bridge any callbag-recharge `Store<T>` to the Svelte store contract.

The returned object implements `subscribe(run)` and works with Svelte `$store` syntax.

## Signature

```ts
function useSubscribe<T>(store: Store<T>): SvelteReadable<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `store` | `Store&lt;T&gt;` | Any store, including companion stores such as `status` or `error`. |

## Returns

`SvelteReadable&lt;T&gt;` - a Svelte-compatible readable store.

## Basic Usage

```svelte
<script lang="ts">
  import { useSubscribe } from "callbag-recharge/compat/svelte";
  import { counter } from "./stores";

  const count = useSubscribe(counter);
</script>

<p>{$count}</p>
```

## See Also

- Solid helper: `/api/useSubscribeSolid`
- `useSubscribeRecord()` (Svelte): `/api/useSubscribeRecordSvelte`
