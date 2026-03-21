# compaction()

Composable log compaction — retains only the latest entry per key.

## Signature

```ts
function compaction<V>(
	log: ReactiveLog<V>,
	keyFn: (value: V) => string,
	opts?: CompactionOptions,
): CompactionResult<V>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `log` | `ReactiveLog&lt;V&gt;` | The reactiveLog to compact. |
| `keyFn` | `(value: V) =&gt; string` | Function that extracts a dedup key from each entry value. |
| `opts` | `CompactionOptions` | Optional configuration. |

## Returns

`CompactionResult&lt;V&gt;` — `compact()` for manual trigger, `destroy()` to stop auto-compaction.

## Basic Usage

```ts
import { reactiveLog } from 'callbag-recharge/data';
import { compaction } from 'callbag-recharge/data';

const log = reactiveLog<{ id: string; v: number }>();
const c = compaction(log, e => e.id);
log.append({ id: "a", v: 1 });
log.append({ id: "b", v: 2 });
log.append({ id: "a", v: 3 });
c.compact(); // removes first "a" entry, keeps { id: "a", v: 3 } and { id: "b", v: 2 }
```

## Options / Behavior Details

- **Composable:** Does not modify the ReactiveLog interface. Attaches externally and operates on the log's public API.
- **Compaction semantics:** For each key, only the entry with the highest sequence number is retained. All older entries for that key are discarded.
- **Implementation:** Reads all entries via `toArray()`, deduplicates, then `clear()` + `appendMany()` to rebuild. Sequence numbers are reassigned (compaction is a structural rewrite).
- **Auto-trigger:** Set `threshold` to auto-compact when entry count reaches the threshold. Checked on every append event.
