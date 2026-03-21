# indexedDBLogAdapter()

IndexedDB execution log adapter for browser environments.

## Signature

```ts
function indexedDBLogAdapter(opts?: IndexedDBLogAdapterOptions): ExecutionLogPersistAdapter
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `IndexedDBLogAdapterOptions` | Optional database and store names. |

## Returns

`ExecutionLogPersistAdapter` — append/load/clear backed by IndexedDB.

## Basic Usage

```ts
import { executionLog } from 'callbag-recharge/orchestrate';
import { indexedDBLogAdapter } from 'callbag-recharge/orchestrate';

const adapter = indexedDBLogAdapter();
const log = executionLog({ persist: adapter });
```

## Options / Behavior Details

- **Browser only:** Uses the IndexedDB API. Not available in Node.js without polyfills.
- **Async:** All operations return Promises.
- **Auto-creates:** Database and object store are created on first use.
