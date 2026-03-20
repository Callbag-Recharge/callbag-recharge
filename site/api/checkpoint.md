# checkpoint()

Durable step boundary. Persists values on emit, recovers saved state on re-subscribe (Tier 2).

## Signature

```ts
function checkpoint<A>(
	id: string,
	adapter: CheckpointAdapter,
	opts?: { name?: string },
): (input: Store<A>) => CheckpointedStore<A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Unique checkpoint identifier for persistence. |
| `adapter` | `CheckpointAdapter` | Storage adapter implementing save/load/clear. |
| `opts` | `{ name?: string }` | Optional configuration. |

## Returns

`StoreOperator&lt;A, A&gt;` — pipe-compatible. The returned store has a `meta` property and `clear()` method.

| Method | Signature | Description |
|--------|-----------|-------------|
| `get()` | `() =&gt; A \` | undefined |
| `meta` | `Store\&lt;CheckpointMeta\&gt;` | Reactive metadata: recovered, persistCount, id. |
| `clear()` | `() =&gt; void` | Clear the saved checkpoint value. |
| `source` | `callbag` | Underlying callbag source for subscriptions. |

## Basic Usage

```ts
import { state, pipe, subscribe } from 'callbag-recharge';
import { checkpoint, memoryAdapter } from 'callbag-recharge/orchestrate';

const adapter = memoryAdapter();
const source = state(0);
const durable = pipe(source, checkpoint("step-1", adapter));
subscribe(durable, v => console.log(v));
source.set(42); // persisted to adapter under "step-1"
// On next subscribe: 42 is emitted immediately from adapter
```

## Options / Behavior Details

- **Tier 2:** Cycle boundary — each persisted value starts a new DIRTY+value cycle.
- **Recovery:** On subscribe, loads saved value from adapter. If found, emits it immediately before forwarding upstream values.
- **Async load buffering:** Upstream values during async load are buffered and replayed after recovery.
- **Pluggable:** Any adapter implementing `{ save, load, clear }` works. Ships with `memoryAdapter()`.

## See Also

- [track](./track) — lifecycle metadata
- [pipeline](./pipeline) — workflow builder
