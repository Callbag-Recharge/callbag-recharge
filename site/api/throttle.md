# throttle()

Emits the first value in a window, then drops further values until `ms` has passed (leading throttle).

## Signature

```ts
function throttle<A>(ms: number): StoreOperator<A, A | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ms` | `number` | Minimum milliseconds between forwarded values. |

## Returns

`StoreOperator&lt;A, A | undefined&gt;` — Tier 2; `undefined` until first emission.

## Options / Behavior Details

- **Completion/errors:** Forwards upstream end and error; clears timers on teardown.

## See Also

- [debounce](/api/debounce)
- [audit](/api/audit)
