# useSubscribeRecord()

Subscribe to a dynamic set of keyed store records. When keys change,
old subscriptions are torn down and new ones created automatically.

Solves the common pattern of rendering a list where each item owns
multiple reactive stores (e.g., DAG nodes with status + breaker + log).

Must be called during Vue `setup()`.

## Signature

```ts
function useSubscribeRecord<K extends string, R extends Record<string, any>>(
	keys: WatchSource<K[]>,
	factory: StoreFactory<K, R>,
): Readonly<Ref<Record<K, R>>>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `keys` | `WatchSource&lt;K[]&gt;` | Reactive source of current keys (e.g., node IDs). |
| `factory` | `StoreFactory&lt;K, R&gt;` | Function that returns a `{ [field]: Store&lt;V&gt; }` object per key. |

## Returns

`Readonly&lt;Ref&lt;Record&lt;K, R&gt;&gt;&gt;` — reactive record of resolved values.

## Basic Usage

```ts
const nodes = useSubscribe(wb.nodes); // Ref<WorkflowNode[]>
const nodeData = useSubscribeRecord(
  () => nodes.value.map(n => n.id),
  (id) => {
    const n = nodes.value.find(n => n.id === id)!;
    return { status: n.task.status, breaker: n.breakerState };
  },
);
// Template: {{ nodeData["extract"].status }}
```
