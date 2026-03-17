# batch()

Defers value emissions until the outermost batch completes, while DIRTY signals propagate immediately.

## Signature

```ts
function batch<T>(fn: () => T): T
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `() => T` | A function containing store mutations to batch. |

## Returns

`T` — the return value of `fn()`.

## Basic Usage

```ts
import { state, derived, batch } from 'callbag-recharge';

const a = state(1);
const b = state(2);
const sum = derived([a, b], () => a.get() + b.get());

batch(() => {
  a.set(10);
  b.set(20);
});

sum.get(); // 30 — recomputed once, not twice
```

## Options / Behavior Details

- **Nested batches are safe:** Only the outermost batch triggers the drain. Inner batches simply increment/decrement the depth counter.
- **DIRTY propagates immediately:** Downstream nodes are notified of invalidation right away, so they know a new value is coming.
- **DATA is deferred and coalesced:** Only the latest value per store is emitted when the batch completes. Multiple `set()` calls to the same store within a batch result in a single emission.
- **Glitch prevention:** Without batching, updating two stores that feed into the same derived store causes two recomputations. Batching ensures only one recomputation with the final values.
- **Synchronous execution:** `fn()` runs synchronously. The drain (deferred emissions) also runs synchronously after `fn()` returns.

### Related exports

```ts
function isBatching(): boolean
```

Returns `true` if currently inside a `batch()` call. Useful for library authors building custom primitives.

## Examples

### Updating multiple stores atomically

```ts
import { state, derived, effect, batch } from 'callbag-recharge';

const firstName = state('Jane');
const lastName = state('Doe');
const fullName = derived(
  [firstName, lastName],
  () => `${firstName.get()} ${lastName.get()}`
);

let computeCount = 0;
effect([fullName], () => {
  computeCount++;
  console.log(fullName.get());
});
// Logs: "Jane Doe", computeCount = 1

batch(() => {
  firstName.set('John');
  lastName.set('Smith');
});
// Logs once: "John Smith", computeCount = 2 (not 3)
```

### Nested batch

```ts
import { state, batch } from 'callbag-recharge';

const a = state(0);

batch(() => {
  a.set(1);
  batch(() => {
    a.set(2); // inner batch — no drain yet
  });
  a.set(3); // still inside outer batch
});
// Only one emission with value 3
```

### Using the return value

```ts
import { batch } from 'callbag-recharge';

const result = batch(() => {
  // perform mutations...
  return 'done';
});
// result === 'done'
```

## See Also

- [state](./state) — writable stores that benefit from batching
- [derived](./derived) — computed stores that avoid glitches with batching
