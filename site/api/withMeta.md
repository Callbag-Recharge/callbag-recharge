# withMeta()

Creates reactive companion stores that project protocol events from a source.
All companions update via a single external subscription — zero intrusion.

## Signature

```ts
function withMeta<T>(store: Store<T>, opts?: { name?: string }): MetaResult<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `store` | `Store&lt;T&gt;` | Any Store to observe. |
| `opts` | `{ name?: string }` | Optional configuration. |

## Returns

`MetaResult&lt;T&gt;` — companion stores + dispose.

## Basic Usage

```ts
import { withMeta } from 'callbag-recharge/utils';

const meta = withMeta(myStore);
effect([meta.count], () => console.log('emissions:', meta.count.get()));
```
