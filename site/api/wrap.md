# wrap()

Adapts raw callbag sources or callbag operators into first-class stores.

## Signature

```ts
function wrap<T>(rawSource: Callbag): Store<T>
function wrap<A, B>(input: Store<A>, rawOp: (source: Callbag) => Callbag): Store<B>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sourceOrInput` | `Callbag | Store&lt;any&gt;` | Raw callbag source **or** input store when using two-arg form. |
| `rawOp` | `(source: Callbag) =&gt; Callbag` | When set, `(source) =&gt; transformedSource` — STATE from input bypasses the raw op (Tier 1). |

## Returns

`Store&lt;T&gt;` or `Store&lt;B&gt;` — Tier 2 for bare sources (each DATA is a cycle).

## Options / Behavior Details

- **Sync map only** for operator form; filtering needs explicit `operator()` wiring.
