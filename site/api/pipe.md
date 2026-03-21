# pipe()

Composes `StoreOperator` functions left-to-right, returning a single output store.
Each operator wraps the previous store; order matches visual reading order.

## Signature

```ts
function pipe<A>(source: Store<A>): Store<A>
function pipe<A, R extends Store<any>>(source: Store<A>, op1: (source: Store<A>) => R): R
function pipe<A, B, R extends Store<any>>(
	source: Store<A>,
	op1: StoreOperator<A, B>,
	op2: (source: Store<B>) => R,
): R
function pipe<A, B, C, R extends Store<any>>(
	source: Store<A>,
	op1: StoreOperator<A, B>,
	op2: StoreOperator<B, C>,
	op3: (source: Store<C>) => R,
): R
function pipe<A, B, C, D, R extends Store<any>>(
	source: Store<A>,
	op1: StoreOperator<A, B>,
	op2: StoreOperator<B, C>,
	op3: StoreOperator<C, D>,
	op4: (source: Store<D>) => R,
): R
function pipe(
	source: Store<unknown>,
	...ops: Array<StoreOperator<any, any>>
): Store<unknown>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Store&lt;unknown&gt;` | The input `Store`. |
| `ops` | `Array&lt;StoreOperator&lt;any, any&gt;&gt;` | One or more `StoreOperator`s (e.g. `map`, `filter`, `scan` from `callbag-recharge/extra`). |

## Returns

The final `Store` after all operators have been applied.

## Basic Usage

```ts
import { state, pipe } from 'callbag-recharge';
import { map } from 'callbag-recharge/extra';

const n = state(3);
const doubled = pipe(n, map((x) => x * 2));
doubled.get(); // 6
```

## See Also

- [map](/api/map)
- [pipeRaw](/api/pipeRaw) — fused single derived for performance
