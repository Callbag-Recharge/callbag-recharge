# tieredStorage()

Creates a reactive tiered storage cache backed by `CheckpointAdapter`s.

Each cached key is a `state()` store. On cache miss, tiers are tried in order
(index 0 = hottest). Hits auto-promote to all faster tiers. Concurrent lookups
for the same key share the same state instance (natural dedup).

## Signature

```ts
function tieredStorage(
	adapters: CheckpointAdapter[],
	opts?: TieredStorageOptions,
): TieredStorageAdapter
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `adapters` | `CheckpointAdapter[]` | Ordered `CheckpointAdapter`s, hottest first. |
| `opts` | `TieredStorageOptions` | Optional configuration (maxSize, eviction policy). |

## Returns

`TieredStorageAdapter` — a reactive cache where each entry is a `WritableStore`.

## Basic Usage

```ts
import { tieredStorage, memoryAdapter } from 'callbag-recharge/utils';
import { subscribe } from 'callbag-recharge/extra';

const storage = tieredStorage([memoryAdapter(), fileAdapter({ dir: ".cache" })], {
    maxSize: 100,
  });

const store = storage.load("key");   // WritableStore<unknown | undefined>
subscribe(store, v => console.log(v)); // reactive updates on cache changes
```
