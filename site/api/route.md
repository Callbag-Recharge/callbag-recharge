# route()

Splits a source into `[matching, notMatching]` stores based on a predicate.
Both outputs are Tier 1 stores that participate in diamond resolution.

## Signature

```ts
function route<T>(
	source: Store<T>,
	pred: (value: T) => boolean,
	opts?: { name?: string },
): [Store<T | undefined>, Store<T | undefined>]
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Store&lt;T&gt;` | The upstream store to route. |
| `pred` | `(value: T) =&gt; boolean` | Predicate function. `true` → first output, `false` → second output. |
| `opts` | `{ name?: string }` | Optional configuration. |

## Returns

`[Store&lt;T | undefined&gt;, Store&lt;T | undefined&gt;]` — `[matching, notMatching]` stores. Each returns `undefined` from `get()` when the predicate doesn't match.

## Basic Usage

```ts
import { state } from 'callbag-recharge';
import { route } from 'callbag-recharge/orchestrate';
import { subscribe } from 'callbag-recharge';

const n = state(0);
const [evens, odds] = route(n, v => v % 2 === 0);
subscribe(evens, v => console.log("even:", v));
subscribe(odds, v => console.log("odd:", v));
n.set(2); // logs "even: 2"
n.set(3); // logs "odd: 3"
```

## Options / Behavior Details

- **Tier 1:** Both outputs forward type 3 STATE signals and send RESOLVED when suppressing a value.
- **Diamond-safe:** When used in a diamond topology, downstream nodes compute exactly once per upstream change.
- **Predicate errors:** If the predicate throws, the error is forwarded downstream via the callbag END protocol.

## See Also

- [filter](/api/filter) — single-output filtering
- [partition](/api/partition) — similar but as pipe operator
