# fromTrigger()

Creates a manual trigger source. `.fire(value)` emits into the stream without equality dedup.

## Signature

```ts
function fromTrigger<T>(opts?: { initial?: T; name?: string }): TriggerStore<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `{ initial?: T; name?: string }` | Optional configuration. |

### 

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `undefined` | Debug name for Inspector. |
| `initial` | `T` | `undefined` | Value before first fire(). |

## Returns

`TriggerStore&lt;T&gt;` — a store with:

| Method | Signature | Description |
|--------|-----------|-------------|
| `get()` | `() =&gt; T \` | undefined |
| `fire(value)` | `(value: T) =&gt; void` | Emit a value to all subscribers. |
| `source` | `callbag` | Underlying callbag source for subscriptions. |

## Basic Usage

```ts
import { fromTrigger } from 'callbag-recharge/orchestrate';
import { subscribe } from 'callbag-recharge';

const trigger = fromTrigger<string>();
subscribe(trigger, v => console.log(v));
trigger.fire("go"); // logs "go"
trigger.fire("go"); // logs "go" again
```

## Options / Behavior Details

- **No dedup:** Every `fire()` call emits, even if the value is the same as the previous one.
- **Pulse semantics:** Backed by producer() — an event source, not persistent state.

## See Also

- [producer](./producer) — general-purpose source
