# map()

Transforms each upstream value through `fn`. Returns a `StoreOperator` for use with `pipe()`.

## Signature

```ts
function map<A, B>(fn: (value: A) => B, opts?: StoreOptions): StoreOperator<A, B>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `(value: A) =&gt; B` | Transform function applied to each upstream value. |
| `opts` | `StoreOptions` | Optional configuration. |

### StoreOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `undefined` | Debug name for Inspector. |
| `equals` | `(a: B, b: B) =&gt; boolean` | `undefined` | Push-phase memoization. When set, sends RESOLVED instead of DATA if value unchanged. |

## Returns

`StoreOperator&lt;A, B&gt;` — a function that takes a `Store&lt;A&gt;` and returns a `Store&lt;B&gt;`.

## Basic Usage

```ts
import { state, pipe } from 'callbag-recharge';
import { map } from 'callbag-recharge/extra';

const count = state(3);
const doubled = pipe(count, map(x => x * 2));
doubled.get(); // 6

count.set(5);
doubled.get(); // 10
```

## Options / Behavior Details

- **Tier 1:** Participates in diamond resolution. Forwards type 3 STATE signals from upstream.
- **Stateful:** Maintains the last transformed value. `get()` returns `fn(input.get())` when disconnected (pull-compute).
- **Push-phase memoization:** When `equals` is provided and the mapped result equals the previous value, a RESOLVED signal is sent instead of DATA, allowing downstream nodes to skip recomputation.

## Examples

### With equals for memoization

```ts
import { state, pipe } from 'callbag-recharge';
import { map } from 'callbag-recharge/extra';

const data = state({ x: 1, y: 2 });
const xOnly = pipe(data, map(d => d.x, { equals: Object.is }));

data.set({ x: 1, y: 99 }); // xOnly sends RESOLVED — x didn't change
```

### Chaining with other operators

```ts
import { state, pipe } from 'callbag-recharge';
import { map, filter } from 'callbag-recharge/extra';

const n = state(1);
const result = pipe(
  n,
  filter(x => x > 0),
  map(x => x * 10),
);
result.get(); // 10
```

## See Also

- [pipe](/api/pipe) — compose operators
- [derived](/api/derived) — computed stores from dependencies
