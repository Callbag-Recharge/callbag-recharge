# topic()

Create a persistent append-only message stream.

## Signature

```ts
function topic<T>(name: string, opts?: TopicOptions<T>): Topic<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Topic name (used for identification and namespacing). |
| `opts` | `TopicOptions&lt;T&gt;` | Optional configuration. |

## Returns

`Topic&lt;T&gt;` — publish messages, read by seq, reactive companions, lifecycle control.

## Options / Behavior Details

- **Backed by reactiveLog:** Messages are stored as `LogEntry<MessageMeta<T>>` in an
append-only log with monotonic sequence numbers and optional bounded buffer.
- **Schema validation:** Pass `{ parse(v): T }` (Zod/Valibot/ArkType compatible) to
validate messages at publish time. Invalid messages throw.
- **Dedup:** Pass `dedupKey` in publish options. Duplicate keys within the dedup window
(default 60s) are silently dropped.
- **Delayed messages:** Pass `delay` in publish options. Message is published after the
delay via setTimeout.
- **Compaction:** Configure `compaction.keyFn` to enable log compaction (retains latest
entry per key). Manual via topic internals or auto-triggered at threshold.
- **Namespacing:** Pass a `Namespace` to scope the topic name and persistence keys.
