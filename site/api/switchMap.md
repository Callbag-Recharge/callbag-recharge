# switchMap()

Maps each outer value to an inner `Store`, subscribes to the latest inner, and unsubscribes from the previous.
Reactive only: inner stores are created when the outer emits, not from `fn(outer.get())` at build time.

## Signature

```ts
function switchMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined>
function switchMap<A, B>(
	fn: (value: A) => Store<B>,
	opts: { initial: B },
): StoreOperator<A, B>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `(value: A) =&gt; Store&lt;B&gt;` | Factory for the inner store from each outer value. |
| `opts` | `{ initial?: B }` | Pass `{ initial: B }` to narrow the output type and seed `get()` before the first inner value. |

## Returns

`StoreOperator&lt;A, B | undefined&gt;` (or `B` when `initial` is set).

## Basic Usage

```ts
import { state, pipe, producer } from 'callbag-recharge';
import { switchMap } from 'callbag-recharge/extra';

const outer = state('a');
const out = pipe(
  outer,
  switchMap((x) => producer<string>(({ emit }) => { emit(x + '!'); })),
);
```

## Options / Behavior Details

- **Tier 2:** Each switch starts a new reactive cycle.
- **Streaming:** Until first outer emission, output may be `undefined` unless `initial` is provided.

## See Also

- [concatMap](/api/concatMap) — queue inner subscriptions
- [exhaustMap](/api/exhaustMap) — ignore while active
- [flat](/api/flat) — flatten all inner sources
