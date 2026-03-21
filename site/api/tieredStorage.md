# tieredStorage()

Compose two `CheckpointAdapter`s into a tiered storage adapter.

## Signature

```ts
function tieredStorage(
	hot: CheckpointAdapter,
	cold: CheckpointAdapter,
	opts?: TieredStorageOptions,
): TieredStorageAdapter
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `hot` | `CheckpointAdapter` | Fast-access adapter (e.g., memoryAdapter, in-process cache). |
| `cold` | `CheckpointAdapter` | Durable adapter (e.g., fileAdapter, sqliteAdapter). |
| `opts` | `TieredStorageOptions` | Optional configuration. |

## Returns

`TieredStorageAdapter` — a CheckpointAdapter with `promote()` and `demote()` methods.

## Basic Usage

```ts
import { tieredStorage, memoryAdapter, lru } from 'callbag-recharge/utils';
import { fileAdapter } from 'callbag-recharge/utils';

const adapter = tieredStorage(
  memoryAdapter(),
  fileAdapter({ dir: ".cache" }),
  { maxHotSize: 50, eviction: lru() },
);
adapter.save("key", { data: 42 }); // → hot tier
adapter.load("key");               // → hot hit
```

## Options / Behavior Details

- **Read path:** Hot first, fall back to cold. On cold hit, auto-promotes to hot (which may trigger eviction/demotion of another key).
- **Write path:** Always writes to hot. If `maxHotSize` is set and hot tier exceeds limit, eviction policy selects keys to demote to cold.
- **Eviction:** Uses `EvictionPolicy<string>` (default: LRU). Tracks access via `touch()` on reads, `insert()` on writes. Evicted keys are demoted to cold (fire-and-forget).
- **Manual control:** `promote(id)` copies cold→hot, `demote(id)` copies hot→cold then clears hot.
