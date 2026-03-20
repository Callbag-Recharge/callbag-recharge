# withBreaker()

Blocks values when the circuit breaker is open. Passes values when closed, trials on half-open (Tier 2).

## Signature

```ts
function withBreaker<A>(
	breaker: BreakerLike,
	opts?: WithBreakerOptions,
): StoreOperator<A, A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `breaker` | `BreakerLike` | A circuit breaker instance (e.g. `circuitBreaker()` from utils). |
| `opts` | `WithBreakerOptions` | Optional behavior configuration. |

## Returns

`StoreOperator&lt;A, A&gt;` — pipe-compatible operator. The returned store has a `breakerState` property.

## Basic Usage

```ts
import { state, pipe } from 'callbag-recharge';
import { withBreaker } from 'callbag-recharge/orchestrate';
import { circuitBreaker } from 'callbag-recharge/utils';

const breaker = circuitBreaker({ failureThreshold: 3 });
const input = state(0);
const guarded = pipe(input, withBreaker(breaker));
```

## Options / Behavior Details

- **Tier 2:** Cycle boundary — each forwarded value starts a new DIRTY+value cycle.
- **Pluggable:** Accepts any object with `canExecute()`, `recordSuccess()`, `recordFailure()`.
- **Success/failure:** Each forwarded value records success. Upstream errors record failure.

## See Also

- [withTimeout](./withTimeout) — timeout guard
- [withRetry](./withRetry) — retry on failure
