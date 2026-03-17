# pipe()

Composes store operators left to right, where each step produces a new inspectable store.

## Signature

```ts
function pipe<A>(source: Store<A>): Store<A>
function pipe<A, B>(source: Store<A>, op1: StoreOperator<A, B>): Store<B>
function pipe<A, B, C>(
  source: Store<A>,
  op1: StoreOperator<A, B>,
  op2: StoreOperator<B, C>
): Store<C>
function pipe<A, B, C, D>(
  source: Store<A>,
  op1: StoreOperator<A, B>,
  op2: StoreOperator<B, C>,
  op3: StoreOperator<C, D>
): Store<D>
function pipe<A, B, C, D, E>(
  source: Store<A>,
  op1: StoreOperator<A, B>,
  op2: StoreOperator<B, C>,
  op3: StoreOperator<C, D>,
  op4: StoreOperator<D, E>
): Store<E>
// Variadic fallback for 5+ operators
function pipe(
  source: Store<unknown>,
  ...ops: Array<StoreOperator<any, any>>
): Store<unknown>
```

### StoreOperator

```ts
type StoreOperator<A, B> = (input: Store<A>) => Store<B>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Store<A>` | The input store to transform. |
| `...ops` | `StoreOperator<*, *>[]` | One or more operator functions to apply in order. |

## Returns

`Store<B>` — the store produced by the last operator in the chain. Each intermediate step is also a full store, inspectable via Inspector.

## Basic Usage

```ts
import { state, pipe } from 'callbag-recharge';
import { map, filter } from 'callbag-recharge/extra';

const count = state(0);

const result = pipe(
  count,
  filter(n => n > 0),
  map(n => n * 10)
);

count.set(3);
result.get(); // 30
```

## Options / Behavior Details

- **Each step is a store:** Every operator in the pipe creates a new `Store` backed by `derived()`. Each step is fully inspectable via Inspector.
- **Type inference:** Full type inference up to 4 operators. Beyond 4, falls back to `Store<unknown>`.
- **Tier 1:** All pipe steps participate in diamond resolution via the two-phase push protocol.
- **Composable:** Operators are plain functions `Store<A> => Store<B>`, so they compose naturally.

### Built-in operators (core)

The core package provides three operator factories:

| Operator | Signature | Description |
|----------|-----------|-------------|
| `map(fn)` | `(fn: (a: A) => B) => StoreOperator<A, B>` | Transforms each value. |
| `filter(fn)` | `(fn: (a: A) => boolean) => StoreOperator<A, A>` | Passes only values matching the predicate. |
| `scan(fn, seed)` | `(fn: (acc: B, val: A) => B, seed: B) => StoreOperator<A, B>` | Accumulates values with a reducer. |

These are re-exported from `callbag-recharge/extra`.

## Examples

### Map, filter, and scan

```ts
import { state, pipe } from 'callbag-recharge';
import { map, filter, scan } from 'callbag-recharge/extra';

const input = state(0);

const total = pipe(
  input,
  filter(n => n > 0),
  map(n => n * 2),
  scan((acc, val) => acc + val, 0)
);

input.set(3);
total.get(); // 6

input.set(5);
total.get(); // 16
```

### Inspecting pipe steps

```ts
import { state, pipe } from 'callbag-recharge';
import { map } from 'callbag-recharge/extra';
import { Inspector } from 'callbag-recharge';

const source = state(1, { name: 'source' });
const doubled = pipe(source, map(n => n * 2));

Inspector.inspect(doubled);
// { name: undefined, kind: 'derived', value: 2, status: ... }
```

### Higher performance with pipeRaw

For performance-critical paths, `pipeRaw` (in extras) fuses all transform functions into a single `derived()` store, avoiding intermediate store allocations:

```ts
import { state } from 'callbag-recharge';
import { pipeRaw, SKIP } from 'callbag-recharge/extra';

const input = state(0);

const result = pipeRaw(
  input,
  n => (n > 0 ? n * 2 : SKIP), // filter + map in one step
);
```

## See Also

- [map, filter, scan](https://github.com/anthropics/callbag-recharge/tree/main/src/extra/) — built-in operator factories
- [derived](./derived) — the underlying primitive for each pipe step
- [operator](./operator) — building custom operators
