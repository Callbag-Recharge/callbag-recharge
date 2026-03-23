# withBreaker()

Blocks values when the circuit breaker is open. Passes values when closed, trials on half-open (Tier 2).

## Signature

```ts
function withBreaker<A>(
	breaker: BreakerLike,
	opts?: WithBreakerOptions,
): (input: Store<A>) => WithBreakerStore<A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `breaker` | `BreakerLike` | A circuit breaker instance (e.g. `circuitBreaker()` from utils). |
| `opts` | `WithBreakerOptions` | Optional behavior configuration. |

## Returns

Pipe-compatible operator. The returned `WithBreakerStore&lt;A&gt;` has a `breakerState` companion store.

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

- [timeout](./timeout) — timeout guard
- [retry](./retry) — retry on failure
