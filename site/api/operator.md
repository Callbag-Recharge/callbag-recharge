# operator()

Creates a custom transform node that receives all signal types from upstream dependencies and decides what to forward downstream.

## Signature

```ts
function operator<B>(
  deps: Store<unknown>[],
  init: (actions: Actions<B>) => (depIndex: number, type: number, data: any) => void,
  opts?: OperatorOpts<B>
): Store<B>
```

### Actions

```ts
type Actions<B> = {
  emit: (value: B) => void;
  seed: (value: B) => void;
  signal: (s: Signal) => void;
  complete: () => void;
  error: (e: unknown) => void;
  disconnect: (dep?: number) => void;
}
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `Store<unknown>[]` | Array of upstream stores to observe. |
| `init` | `(actions) => handler` | Initialization function. Receives actions, returns an event handler. |
| `opts` | `OperatorOpts<B>` | Optional configuration. |

### OperatorOpts

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `undefined` | Debug name for Inspector. |
| `initial` | `B` | `undefined` | Baseline value before first emission. |
| `equals` | `(a: B, b: B) => boolean` | `undefined` | Emission guard. |
| `getter` | `(cached: B \| undefined) => B` | `undefined` | Pull-based `get()` when disconnected. |
| `resetOnTeardown` | `boolean` | `false` | Reset to `initial` when last subscriber disconnects. |
| `resubscribable` | `boolean` | `false` | Allow re-subscription after completion. |
| `kind` | `string` | `"operator"` | Inspector kind override. |

### Actions API

| Method | Description |
|--------|-------------|
| `emit(value)` | Set value and push DATA to downstream subscribers. |
| `seed(value)` | Set value without pushing DATA. Safe during init phase. |
| `signal(s)` | Push a Signal (DIRTY/RESOLVED) on the STATE channel. |
| `complete()` | Send END to all downstream, disconnect upstream. |
| `error(e)` | Send END with error to all downstream, disconnect upstream. |
| `disconnect(dep?)` | Disconnect one upstream dep (by index) or all deps (no argument). |

## Returns

`Store<B>` — a read-only store with `get()` and `source`.

## Basic Usage

```ts
import { state, operator } from 'callbag-recharge';
import { DIRTY, RESOLVED, DATA, STATE, END } from 'callbag-recharge/protocol';

const source = state(0);

const doubled = operator<number>([source], ({ emit, signal }) => {
  return (depIndex, type, data) => {
    if (type === STATE) {
      signal(data); // forward DIRTY/RESOLVED
    } else if (type === DATA) {
      emit(data * 2);
    } else if (type === END) {
      // handle completion
    }
  };
});
```

## Options / Behavior Details

- **Tier 1:** Participates in diamond resolution. Receives type 3 STATE signals (DIRTY, RESOLVED) from upstream deps.
- **Handler receives everything:** The handler function is called for all signal types from all deps: START, DATA, END, and STATE. The `depIndex` parameter identifies which dep sent the event.
- **Lazy connection:** Connects to upstream deps when the first subscriber arrives. Disconnects when the last subscriber leaves.
- **Diamond resolution contract:** When suppressing a value (e.g., filtering), you MUST send `signal(RESOLVED)` to maintain correct diamond resolution. Failing to do so will stall downstream derived nodes that are waiting for all dirty deps to resolve.
- **seed vs emit:** Use `seed()` during initialization to set an initial value without triggering a DATA push. Use `emit()` during event handling to push values downstream.

## Examples

### Custom filter operator

```ts
function filterOp<T>(predicate: (v: T) => boolean) {
  return (source: Store<T>): Store<T> =>
    operator<T>([source], ({ emit, signal }) => {
      return (depIndex, type, data) => {
        if (type === STATE) {
          signal(data);
        } else if (type === DATA) {
          if (predicate(data)) {
            emit(data);
          } else {
            signal(RESOLVED); // MUST send RESOLVED when suppressing
          }
        }
      };
    });
}
```

### Multi-dep combiner

```ts
const a = state(1);
const b = state('hello');

const combined = operator<string>([a, b], ({ emit, signal }) => {
  let dirty = 0;
  return (depIndex, type, data) => {
    if (type === STATE && data === DIRTY) {
      dirty++;
      if (dirty === 1) signal(DIRTY);
    } else if (type === DATA) {
      dirty--;
      if (dirty === 0) {
        emit(`${a.get()}-${b.get()}`);
      }
    } else if (type === STATE && data === RESOLVED) {
      dirty--;
      if (dirty === 0) signal(RESOLVED);
    }
  };
});
```

## See Also

- [derived](./derived) — simpler computed stores (handles diamond resolution automatically)
- [producer](./producer) — push-based source without upstream deps
- [pipe](./pipe) — composing operators
