# Inspector

Global singleton for reactive graph observability. All metadata lives in WeakMaps, keeping store objects lean. Zero-cost when disabled.

## Signature

```ts
const Inspector: {
  enabled: boolean;
  inspect<T>(store: Store<T>): StoreInfo<T>;
  graph(): Map<string, StoreInfo>;
  register(store: Store<unknown>, opts?: { name?: string; kind?: string }): void;
  registerEdge(parent: Store<unknown>, child: Store<unknown>): void;
  getEdges(): Map<string, string[]>;
  getName(store: Store<unknown>): string | undefined;
  getKind(store: Store<unknown>): string | undefined;
  trace<T>(store: Store<T>, cb: (value: T, prev: T | undefined) => void): () => void;

  // Signal hooks
  onEmit: ((store: Store<unknown>, value: unknown) => void) | null;
  onSignal: ((store: Store<unknown>, signal: unknown) => void) | null;
  onStatus: ((store: Store<unknown>, status: NodeStatus) => void) | null;
  onEnd: ((store: Store<unknown>, error?: unknown) => void) | null;
}
```

### StoreInfo

```ts
interface StoreInfo<T = unknown> {
  name: string | undefined;
  kind: string;
  value: T;
  status: NodeStatus | undefined;
}
```

### NodeStatus

```ts
type NodeStatus =
  | "DISCONNECTED"
  | "DIRTY"
  | "SETTLED"
  | "RESOLVED"
  | "COMPLETED"
  | "ERRORED"
```

## API

| Method | Description |
|--------|-------------|
| `inspect(store)` | Returns `{ name, kind, value, status }` for a single store. |
| `graph()` | Returns a `Map` of all living named stores. GC'd stores are automatically cleaned up. |
| `register(store, opts?)` | Registers a store. Called automatically by primitives (`state`, `derived`, `producer`, `operator`). |
| `registerEdge(parent, child)` | Tracks a dependency edge between two stores. |
| `getEdges()` | Returns a copy of the dependency graph as a `Map<string, string[]>`. |
| `getName(store)` | Returns the debug name of a store. |
| `getKind(store)` | Returns the kind of a store (`"state"`, `"derived"`, `"producer"`, `"operator"`). |
| `trace(store, cb)` | Subscribes to value changes via raw callbag. Returns an unsubscribe function. |

### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | `boolean` | Auto-detected | When `false`, `register` and `getName` are no-ops. Auto-detects `NODE_ENV !== 'production'`. Set explicitly to override. |

### Signal Hooks

All hooks are `null` by default (zero-cost). Set a function to activate.

| Hook | Signature | Fires when |
|------|-----------|------------|
| `onEmit` | `(store, value) => void` | A store emits a new value. |
| `onSignal` | `(store, signal) => void` | A store sends a control signal (DIRTY/RESOLVED). |
| `onStatus` | `(store, status) => void` | A store's NodeStatus changes. |
| `onEnd` | `(store, error?) => void` | A store completes or errors. |

## Basic Usage

```ts
import { state, Inspector } from 'callbag-recharge';

const count = state(0, { name: 'count' });

Inspector.inspect(count);
// { name: 'count', kind: 'state', value: 0, status: 'DISCONNECTED' }
```

## Examples

### Building a devtools panel with graph()

```ts
import { state, derived, Inspector } from 'callbag-recharge';

const a = state(1, { name: 'a' });
const b = state(2, { name: 'b' });
const sum = derived([a, b], () => a.get() + b.get(), { name: 'sum' });

const stores = Inspector.graph();
for (const [key, info] of stores) {
  console.log(`${key}: ${info.kind} = ${info.value} (${info.status})`);
}
// a: state = 1 (DISCONNECTED)
// b: state = 2 (DISCONNECTED)
// sum: derived = 3 (DISCONNECTED)
```

### Tracing value changes

```ts
const count = state(0, { name: 'count' });

const stop = Inspector.trace(count, (value, prev) => {
  console.log(`count: ${prev} -> ${value}`);
});

count.set(1); // Logs: "count: 0 -> 1"
count.set(2); // Logs: "count: 1 -> 2"

stop(); // unsubscribe
```

### Disabling in production

```ts
import { Inspector } from 'callbag-recharge';

// Explicit disable (overrides NODE_ENV auto-detection)
Inspector.enabled = false;

// All register/getName calls become no-ops
// graph() returns an empty map
// inspect() still works (reads store directly) but name/kind are unavailable
```

## See Also

- [state](./state) — stores that register with Inspector
- [derived](./derived) — computed stores with status tracking
- [producer](./producer) — sources with lifecycle status
