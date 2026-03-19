# takeWhile()

Emits values while `predicate` returns true, then completes and disconnects upstream.

## Signature

```ts
function takeWhile<A>(predicate: (value: A) => boolean): StoreOperator<A, A | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `predicate` | `(value: A) =&gt; boolean` | Function tested against each upstream value. Stream completes on first `false`. |

## Returns

`StoreOperator&lt;A, A | undefined&gt;` — Tier 1; forwards STATE while predicate holds.

## Basic Usage

```ts
import { state, pipe } from 'callbag-recharge';
import { takeWhile, subscribe } from 'callbag-recharge/extra';

const s = state(0);
const t = pipe(s, takeWhile(v => v < 5));
subscribe(t, v => console.log(v));
s.set(3); // logs 3
s.set(7); // completes — 7 is not emitted
```

## Options / Behavior Details

- **Tier 1:** Participates in diamond resolution. Forwards type 3 STATE signals while active.
- **Completion:** When predicate returns false, upstream is disconnected and the operator completes. The failing value is **not** emitted.

## Examples

### With fromIter

```ts
import { pipe } from 'callbag-recharge';
import { fromIter, takeWhile } from 'callbag-recharge/extra';

const s = pipe(fromIter([1, 2, 3, 4, 5]), takeWhile(v => v < 4));
// emits 1, 2, 3 then completes
```

## See Also

- [take](/api/take) — take by count
- [takeUntil](/api/takeUntil) — take until signal
