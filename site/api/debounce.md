# debounce()

Delays each upstream change by `ms`; resets the timer if another value arrives sooner (leading-edge cancel).

## Signature

```ts
function debounce<A>(ms: number): StoreOperator<A, A | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ms` | `number` | Debounce interval in milliseconds. |

## Returns

`StoreOperator&lt;A, A | undefined&gt;` — `undefined` until the first debounced emission; flushes pending on upstream complete.

## Basic Usage

```ts
import { state, pipe } from 'callbag-recharge';
import { debounce } from 'callbag-recharge/extra';

const q = state('');
const d = pipe(q, debounce(100));
q.set('hi');
// after 100ms idle, d emits 'hi'
```

## Options / Behavior Details

- **Tier 2:** Cycle boundary; each debounced `emit` is its own DIRTY+DATA cycle.
- **Errors:** Cancels the timer and forwards upstream errors.

## See Also

- [throttle](/api/throttle) — rate-limit emissions
- [audit](/api/audit) — sample after silence
