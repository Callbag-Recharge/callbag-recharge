# take()

Emits at most `n` DATA values from upstream, then completes and disconnects.

## Signature

```ts
function take<A>(n: number): StoreOperator<A, A | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `n` | `number` | Number of values to forward (`n &lt;= 0` completes immediately with no DATA). |

## Returns

`StoreOperator&lt;A, A | undefined&gt;` — Tier 1; forwards STATE until the take limit is reached.

## Basic Usage

```ts
import { pipe } from 'callbag-recharge';
import { fromIter, take } from 'callbag-recharge/extra';

const s = pipe(fromIter([1, 2, 3]), take(2));
// emits 1, 2 then completes
```

## Options / Behavior Details

- **Completion:** After `n` emissions, upstream is disconnected to stop further work.

## See Also

- [skip](/api/skip)
- [first](/api/first) — take only the first value
