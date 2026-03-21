# sqliteLogAdapter()

SQLite execution log adapter via better-sqlite3 (peer dependency).

## Signature

```ts
function sqliteLogAdapter(opts: SQLiteLogAdapterOptions): ExecutionLogPersistAdapter
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `SQLiteLogAdapterOptions` | Configuration with `db` instance and optional `table` name. |

## Returns

`ExecutionLogPersistAdapter` — append/load/clear backed by SQLite.

## Basic Usage

```ts
import Database from 'better-sqlite3';
import { executionLog } from 'callbag-recharge/orchestrate';
import { sqliteLogAdapter } from 'callbag-recharge/orchestrate';

const db = new Database('./workflow.db');
const adapter = sqliteLogAdapter({ db });
const log = executionLog({ persist: adapter });
```

## Options / Behavior Details

- **Peer dep:** Requires `better-sqlite3`. Not bundled.
- **Sync:** better-sqlite3 is synchronous, so operations are sync (no Promises).
- **Auto-creates table:** The table is created if it doesn't exist.
