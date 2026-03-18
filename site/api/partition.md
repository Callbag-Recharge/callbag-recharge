# partition()

Fan-out to `[pass, fail]` stores by predicate; single shared upstream subscription.

## Signature

```ts
function partition<A>(
	predicate: (value: A) => boolean,
): (input: Store<A>) => [Store<A | undefined>, Store<A | undefined>]
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `predicate` | `(value: A) =&gt; boolean` | If true, value goes to first store; else second. Non-matching branch gets RESOLVED when matching gets DATA. |

## Returns

Curried `(input) =&gt; [Store, Store]`.
