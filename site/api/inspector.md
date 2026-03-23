# Inspector

Static class for opt-in reactive graph observability. All metadata lives in WeakMaps, keeping store objects lean. Zero-cost when disabled.

## Signature

```ts
class Inspector {
  static enabled: boolean;

  // Registration (called automatically by primitives)
  static register(node: object, opts?: { name?: string; kind?: string; deps?: object[] }): void;
  static registerEdge(parent: object, child: object): void;

  // Read-only graph queries
  static inspect<T>(node: object): StoreInfo<T>;
  static graph(): Map<string, StoreInfo>;
  static getEdges(): Map<string, string[]>;
  static getName(node: object): string | undefined;
  static getKind(node: object): string | undefined;
  static dumpGraph(): string;
  static snapshot(): { nodes: Array<{...}>; edges: Array<{...}> };

  // Callbag sinks for debugging
  static observe<T>(store: Store<T>): ObserveResult<T>;
  static spy<T>(store: Store<T>, opts?: { name?: string; log?: Function }): ObserveResult<T>;
  static trace<T>(store: Store<T>, cb: (value: T, prev: T | undefined) => void): () => void;

  // Orchestrate helpers
  static observeTaskState(taskState: { status: Store<any>; error: Store<any> }): TaskStateObserveResult;
  static causalityTrace<T>(store: Store<T>): CausalityResult<T>;

  // Graph visualization
  static tap<T>(store: Store<T>, name?: string): Store<T>;
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

### ObserveResult

```ts
interface ObserveResult<T> {
  values: T[];
  signals: Signal[];
  events: Array<{ type: "data" | "signal" | "end"; data: unknown }>;
  ended: boolean;
  endError: unknown;
  dirtyCount: number;
  resolvedCount: number;
  name: string | undefined;
  dispose: () => void;
}
```

### TaskStateTransition

```ts
interface TaskStateTransition {
  from: string;
  to: string;
  error?: unknown;
  timestamp: number;
}
```

### TaskStateObserveResult

```ts
interface TaskStateObserveResult {
  transitions: TaskStateTransition[];
  readonly currentStatus: string;
  dispose: () => void;
}
```

### CausalityEntry

```ts
interface CausalityEntry<T = unknown> {
  result: T;
  triggerDepIndex: number;
  triggerDepName: string | undefined;
  depValues: unknown[];
  timestamp: number;
}
```

### CausalityResult

```ts
interface CausalityResult<T> extends ObserveResult<T> {
  causality: CausalityEntry<T>[];
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

## API — Graph Queries

| Method | Description |
|--------|-------------|
| `inspect(node)` | Returns `{ name, kind, value, status }` for a single node. |
| `graph()` | Returns a `Map` of all living named stores. GC'd stores are automatically cleaned up. |
| `getEdges()` | Returns a copy of the dependency graph as `Map<string, string[]>`. |
| `getName(node)` | Returns the debug name of a node. |
| `getKind(node)` | Returns the kind of a node (`"state"`, `"derived"`, `"producer"`, `"operator"`, `"effect"`). |
| `dumpGraph()` | Pretty-print the entire graph for console/CLI debugging. Shows values, status, and edges. |
| `snapshot()` | JSON-serializable snapshot of nodes + edges. Designed for AI consumption during debugging. |

## API — Registration

| Method | Description |
|--------|-------------|
| `register(node, opts?)` | Registers a node with name, kind, and deps. Called automatically by primitives. |
| `registerEdge(parent, child)` | Tracks a dependency edge. Called automatically by `derived`, `operator`, `effect`. |

## API — Debugging Sinks

| Method | Description |
|--------|-------------|
| `observe(store)` | Subscribes to full callbag protocol. Returns live `ObserveResult` — arrays grow as the store emits. Test-friendly. |
| `spy(store, opts?)` | Like `observe()` but also logs each event. Pass custom logger or defaults to `console.log`. |
| `trace(store, cb)` | Subscribes to value changes only (deduped via `Object.is`). Returns unsubscribe function. |
| `tap(store, name?)` | Creates a transparent passthrough wrapper for graph visualization. Zero overhead — subscribers connect to original. |

## API — Orchestrate Helpers

| Method | Description |
|--------|-------------|
| `observeTaskState(taskState)` | Subscribes to a `taskState`'s status and error stores. Returns live `TaskStateObserveResult` with status transitions. Test-friendly for orchestrate assertions. |
| `causalityTrace(store)` | Extends `observe()` for derived stores. Records which dep triggered each re-evaluation, with dep values snapshot. Only works on derived stores (throws otherwise). |

### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | `boolean` | Auto-detected | When `false`, `register` and `getName` are no-ops. Auto-detects `NODE_ENV !== 'production'`. Set explicitly to override. |

## Basic Usage

```ts
import { state, Inspector } from 'callbag-recharge';

const count = state(0, { name: 'count' });

Inspector.inspect(count);
// { name: 'count', kind: 'state', value: 0, status: 'DISCONNECTED' }
```

## Examples

### observe() for testing

```ts
import { state, Inspector } from 'callbag-recharge';

const n = state(0, { name: 'n' });
const obs = Inspector.observe(n);

n.set(5);
obs.values;      // [5]
obs.dirtyCount;  // 1
obs.ended;       // false
obs.dispose();   // stop observing
```

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

### snapshot() for AI debugging

```ts
const snap = Inspector.snapshot();
// { nodes: [{ name: 'a', kind: 'state', value: 1, status: 'DISCONNECTED' }, ...],
//   edges: [{ from: 'a', to: 'sum' }, { from: 'b', to: 'sum' }] }
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

### spy() for interactive debugging

```ts
const n = state(0);
const obs = Inspector.spy(n, { name: 'debug' });
// Logs each event: [debug] DATA: 0, [debug] STATE: DIRTY, etc.

n.set(42); // Logs: [debug] DATA: 42
obs.dispose();
```

### tap() for graph visualization

```ts
const source = state(0, { name: 'source' });
const tapped = Inspector.tap(source, 'tap-point');

// tapped appears as a separate node in Inspector.graph()
// but delegates get()/source() to the original — zero overhead
```

### observeTaskState() for orchestrate testing

```ts
import { taskState, Inspector } from 'callbag-recharge';

const task = taskState<string>();
const obs = Inspector.observeTaskState(task);

await task.run(async () => 'done');

obs.transitions;
// [{ from: 'idle', to: 'running', timestamp: ... },
//  { from: 'running', to: 'success', timestamp: ... }]
obs.currentStatus; // 'success'
obs.dispose();
```

### causalityTrace() for derived debugging

```ts
import { state, derived, Inspector } from 'callbag-recharge';

const a = state(1, { name: 'a' });
const b = state(2, { name: 'b' });
const sum = derived([a, b], () => a.get() + b.get());

const trace = Inspector.causalityTrace(sum);

a.set(10);
trace.causality[0].triggerDepName; // 'a'
trace.causality[0].depValues;     // [10, 2]
trace.causality[0].result;        // 12
trace.dispose();
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
- [Protocol](./protocol) — NodeStatus and control signals
