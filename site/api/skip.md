# skip()

Ignores the first `n` upstream DATA emissions, then mirrors the rest.

## Signature

```ts
function skip<A>(n: number): StoreOperator<A, A | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `n` | `number` | Count of initial values to drop. |

## Returns

`StoreOperator&lt;A, A | undefined&gt;` — `undefined` until the first value after the skip window.

## Basic Usage

```ts
import { pipe } from 'callbag-recharge';
import { fromIter, skip } from 'callbag-recharge/extra';

const s = pipe(fromIter([1, 2, 3]), skip(1));
// forwards 2, 3
```

## Options / Behavior Details

- **Tier 1:** During skip, DIRTY/RESOLVED handling keeps the graph consistent after the window.

## See Also

- [take](/api/take)
