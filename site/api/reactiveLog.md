# reactiveLog()

Creates an append-only reactive log with optional bounded circular buffer semantics.

## Signature

```ts
function reactiveLog<V>(opts?: ReactiveLogOptions): ReactiveLog<V>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `ReactiveLogOptions` | Optional configuration. |

### ReactiveLogOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `id` | `string` | `undefined` | User-specified ID. Auto-generated if omitted. |
| `maxSize` | `number` | `0` | Maximum number of entries. 0 = unlimited. Oldest trimmed on overflow. |

## Returns

`ReactiveLog&lt;V&gt;` — a reactive log with the following API:

| Method | Signature | Description |
|--------|-----------|-------------|
| `append(value)` | `(value: V) =&gt; number` | Append a value. Returns the assigned sequence number. |
| `appendMany(values)` | `(values: V[]) =&gt; number[]` | Batch append. Returns sequence numbers. |
| `get(seq)` | `(seq: number) =&gt; LogEntry&lt;V&gt; \` | undefined |
| `slice(from?, to?)` | `(from?: number, to?: number) =&gt; LogEntry&lt;V&gt;[]` | Range read by sequence number (inclusive). |
| `toArray()` | `() =&gt; LogEntry&lt;V&gt;[]` | Snapshot of all entries. |
| `tail(n?)` | `(n?: number) =&gt; Store&lt;LogEntry&lt;V&gt;[]&gt;` | Reactive derived store of the last n entries. |
| `events` | `Store&lt;LogEvent&lt;V&gt; \` | undefined&gt; |
| `length` | `number` | Current number of entries. |
| `clear()` | `() =&gt; void` | Remove all entries. |
| `destroy()` | `() =&gt; void` | Tear down all reactive stores. |

## Basic Usage

```ts
import { reactiveLog } from 'callbag-recharge';

const log = reactiveLog<string>({ maxSize: 100 });
log.append('hello');
log.toArray(); // [{ seq: 1, value: 'hello' }]
```

## Options / Behavior Details

- **Circular buffer:** When `maxSize > 0`, the log uses a fixed-size circular buffer for O(1) appends. Oldest entries are silently overwritten when the buffer is full.
- **Reactive views:** `tail()` returns a derived store that updates whenever the log changes. Multiple calls with the same `n` share the same derived store.

## See Also

- [executionLog](./executionLog) — pipeline execution log
- [pipeline](./pipeline) — workflow builder
