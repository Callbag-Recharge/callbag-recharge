# withLatestFrom()

On primary source emission, combines with **latest** values from other deps via the trailing combiner (multi-dep Tier 1 hybrid).

## Signature

```ts
function withLatestFrom<A, Others extends Store<unknown>[], R>(
	...args: [
		...Others,
		(...values: [A, ...{ [K in keyof Others]: Others[K] extends Store<infer T> ? T : never }]) => R,
	]
): StoreOperator<A, R>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `args` | `[
		...Others,
		(...values: [A, ...{ [K in keyof Others]: Others[K] extends Store&lt;infer T&gt; ? T : never }]) =&gt; R,
	]` | `...otherStores, (primary, ...others) =&gt; result` — primary is dep 0. |

## Returns

`StoreOperator` — only primary DATA triggers output; other deps alone yield RESOLVED.
