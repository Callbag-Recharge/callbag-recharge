# merge()

Merges multiple stores of the same type; the output holds the latest value from whichever source emitted last.

## Signature

```ts
function merge<T>(...sources: Store<T>[]): Store<T | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `Store&lt;T&gt;[]` | Two or more `Store&lt;T&gt;` inputs. |

## Returns

`Store&lt;T | undefined&gt;` — multi-dep Tier 1 node with bitmask dirty tracking.

## Basic Usage

```ts
import { state } from 'callbag-recharge';
import { merge } from 'callbag-recharge/extra';

const a = state(1);
const b = state(2);
const m = merge(a, b);
a.set(10);
m.get(); // 10
```

## Options / Behavior Details

- **Concurrent dirty:** Multiple deps dirty in one batch can yield multiple DATA without extra DIRTY; downstream handles per library rules.
- **Completion:** Completes when all sources have completed without error.

## See Also

- [combine](/api/combine)
- [race](/api/race) — first source to emit wins
