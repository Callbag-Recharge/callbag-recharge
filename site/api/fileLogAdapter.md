# fileLogAdapter()

File-based execution log adapter. Appends entries as newline-delimited JSON (JSONL).

## Signature

```ts
function fileLogAdapter(opts: FileLogAdapterOptions): ExecutionLogPersistAdapter
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `FileLogAdapterOptions` | Configuration with `dir` path and optional `filename`. |

## Returns

`ExecutionLogPersistAdapter` — append/load/clear backed by the filesystem.

## Basic Usage

```ts
import { executionLog } from 'callbag-recharge/orchestrate';
import { fileLogAdapter } from 'callbag-recharge/orchestrate';

const adapter = fileLogAdapter({ dir: './logs' });
const log = executionLog({ persist: adapter });
```

## Options / Behavior Details

- **Node.js only:** Uses `node:fs` for file operations. Not available in browser builds.
- **Async:** All operations return Promises.
- **Format:** Each entry is one JSON line. Append-friendly — no read-modify-write.
