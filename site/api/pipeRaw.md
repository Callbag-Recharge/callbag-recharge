# pipeRaw()

Fuses transform functions into **one** `operator()` node (~2× faster than chained `pipe`).
Return `SKIP` from any step to suppress emission (filter semantics).

## Signature

```ts
function pipeRaw<A, B>(source: Store<A>, f1: (v: A) => B | typeof SKIP): Store<B>
function pipeRaw<A, B, C>(
	source: Store<A>,
	f1: (v: A) => B | typeof SKIP,
	f2: (v: B) => C | typeof SKIP,
): Store<C>
function pipeRaw<A, B, C, D>(
	source: Store<A>,
	f1: (v: A) => B | typeof SKIP,
	f2: (v: B) => C | typeof SKIP,
	f3: (v: C) => D | typeof SKIP,
): Store<D>
function pipeRaw<A, B, C, D, E>(
	source: Store<A>,
	f1: (v: A) => B | typeof SKIP,
	f2: (v: B) => C | typeof SKIP,
	f3: (v: C) => D | typeof SKIP,
	f4: (v: D) => E | typeof SKIP,
): Store<E>
function pipeRaw(source: Store<unknown>, ...fns: Array<(v: any) => any>): Store<unknown>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Store&lt;unknown&gt;` | Input store. |
| `fns` | `Array&lt;(v: any) =&gt; any&gt;` | One or more transforms; use `SKIP` to drop. |

## Returns

`Store` — Tier 1 single-dep pipeline.

## See Also

- [pipe](/api/pipe)
