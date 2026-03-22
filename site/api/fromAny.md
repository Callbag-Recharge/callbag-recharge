# fromAny()

Normalizes any value type into a callbag `ProducerStore` that emits value(s) then completes.

Supported inputs (checked in order):
1. **Promise / PromiseLike** — emits resolved value, errors on reject
2. **Observable** (`{ subscribe }`) — bridges next/error/complete
3. **AsyncIterable** — pulls values, aborts on cleanup
4. **Iterable** (excluding strings) — emits each element synchronously
5. **Plain value** — emits once, completes

## Signature

```ts
function fromAny<T>(
	input: T | Promise<T> | Iterable<T> | AsyncIterable<T>,
): ProducerStore<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `T | Promise&lt;T&gt; | Iterable&lt;T&gt; | AsyncIterable&lt;T&gt;` | Any value, promise, iterable, async iterable, or observable. |

## Returns

`ProducerStore&lt;T&gt;`

## Basic Usage

```ts
import { fromAny } from 'callbag-recharge/extra';

fromAny(42);                        // emits 42
fromAny(fetch('/api').then(r => r.json())); // emits response
fromAny([1, 2, 3]);                 // emits 1, 2, 3
fromAny(asyncGenerator());          // emits each yielded value
fromAny(rxjsObservable$);           // bridges observable
```
