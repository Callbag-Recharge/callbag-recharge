# scan()

Accumulates upstream values with a reducer and seed, emitting the accumulator after each step.
Returns a `StoreOperator` for use with `pipe()`.

## Signature

```ts
function scan<A, B>(
	reducer: (acc: B, value: A) => B,
	seed: B,
	opts?: StoreOptions,
): StoreOperator<A, B>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `reducer` | `(acc: B, value: A) =&gt; B` | `(acc, value) =&gt; nextAcc` applied on each upstream DATA. |
| `seed` | `B` | Initial accumulator; reset when the operator reconnects. |
| `opts` | `StoreOptions` | Optional `equals` to skip emissions when the accumulator is unchanged. |

### StoreOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `equals` | `(a: B, b: B) =&gt; boolean` | `undefined` | Sends RESOLVED instead of duplicate DATA. |
| `name` | `string` | `undefined` | Debug name for Inspector. |

## Returns

`StoreOperator&lt;A, B&gt;` — stateful; `get()` fold-reads the current input when disconnected.

## Basic Usage

```ts
import { state, pipe } from 'callbag-recharge';
import { scan } from 'callbag-recharge/extra';

const n = state(1);
const sum = pipe(n, scan((acc, x) => acc + x, 0));
n.set(2);
sum.get(); // 3
```

## Options / Behavior Details

- **Tier 1:** Forwards STATE; participates in dirty/diamond semantics.

## See Also

- [pipe](/api/pipe)
- [reduce](/api/reduce) — final accumulated value
