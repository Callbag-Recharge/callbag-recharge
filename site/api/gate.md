# gate()

Human-in-the-loop: pauses stream, inspects pending values, approve/reject/modify before forwarding (Tier 2).

## Signature

```ts
function gate<A>(opts?: GateOptions): (input: Store<A>) => GatedStore<A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `GateOptions` | Optional configuration. |

## Returns

A function that takes `Store&lt;A&gt;` and returns `GatedStore&lt;A&gt;`.

| Method | Signature | Description |
|--------|-----------|-------------|
| `get()` | `() =&gt; A \` | undefined |
| `pending` | `Store\&lt;A[]\&gt;` | Reactive queue of values awaiting approval. |
| `isOpen` | `Store\&lt;boolean\&gt;` | Whether auto-approving. |
| `approve(n?)` | `(count?: number) =&gt; void` | Forward next n pending values. |
| `reject(n?)` | `(count?: number) =&gt; void` | Discard next n pending values. |
| `modify(fn)` | `(fn: (A) =&gt; A) =&gt; void` | Transform and forward next pending. |
| `open()` | `() =&gt; void` | Flush pending + auto-approve future values. |
| `close()` | `() =&gt; void` | Re-enable gating. |
| `source` | `(type, payload?) =&gt; void` | Underlying reactive source for subscriptions. |

## Basic Usage

```ts
import { state, pipe, subscribe } from 'callbag-recharge';
import { gate } from 'callbag-recharge/orchestrate';

const input = state(0);
const gated = pipe(input, gate());

subscribe(gated, v => console.log("approved:", v));
input.set(1);
gated.pending.get();  // [1]
gated.approve();      // logs "approved: 1"
gated.pending.get();  // []
```

## Options / Behavior Details

- **Tier 2:** Cycle boundary — each approved value starts a new reactive update cycle.
- **Queue:** Values queue while gate is closed. `maxPending` limits queue size (FIFO drop).
- **Open/close:** `open()` flushes all pending and auto-approves future values. `close()` re-enables manual gating.
- **Teardown:** After the gate's producer is torn down (unsubscribed), all controls throw. Re-subscribing resets the gate to a clean state.

## Examples

### Auto-approve mode

```ts
const gated = pipe(input, gate({ startOpen: true }));
// All values pass through immediately
gated.close(); // Re-enable manual gating
```

## See Also

- [track](./track) — lifecycle metadata
- [route](./route) — conditional routing
