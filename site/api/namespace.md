# namespace()

Create a scoped namespace for key prefixing and isolation.

## Signature

```ts
function namespace(name: string): Namespace
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | The namespace name (e.g., "tenant-a", "agent-1"). |

## Returns

`Namespace` — helper with `prefix()`, `checkpoint()`, and `child()` methods.

## Basic Usage

```ts
import { namespace } from 'callbag-recharge/utils';
import { memoryAdapter, checkpoint } from 'callbag-recharge/utils';

const ns = namespace("tenant-a");
const adapter = memoryAdapter();
const scoped = ns.checkpoint(adapter);
// scoped.save("step-1", value) → adapter.save("tenant-a/step-1", value)
```

## Options / Behavior Details

- **Pure naming:** No reactive stores. Just string prefixing with `/` separator.
- **Checkpoint scoping:** `ns.checkpoint(adapter)` wraps an adapter so all save/load/clear calls use prefixed keys. The underlying adapter is shared.
- **Nesting:** `ns.child("sub")` creates `"parent/sub"` namespace. Unlimited nesting depth.
- **Not a security boundary:** Any code with the adapter reference can bypass the namespace. This is a convention helper, not access control.
