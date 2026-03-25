# keyedAsync()

Deduplicates concurrent async calls by key.

If a call for key `k` is already in flight, subsequent calls with the same key
join the existing callbag source instead of starting a new one. Once the source
completes, the key is removed and the next call starts fresh.

## Signature

```ts
function keyedAsync<K, V>(fn: (key: K) => V | Promise<V>): (key: K) => CallbagSource
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `(key: K) =&gt; V | Promise&lt;V&gt;` | Async function keyed by the first argument. |

## Returns

A wrapped function with identical signature that coalesces concurrent calls,
returning a callbag source.

## Basic Usage

```ts
import { keyedAsync } from 'callbag-recharge/utils';
import { rawSubscribe } from 'callbag-recharge/raw';

const load = keyedAsync((key: string) => fetch(`/api/${key}`).then(r => r.json()));
// Two concurrent calls for "user:42" → one fetch, two consumers
rawSubscribe(load("user:42"), (data) => console.log(data));
rawSubscribe(load("user:42"), (data) => console.log(data));
```
