# collection()

Creates a reactive collection of `MemoryNode&lt;T&gt;` values with tag indexing,
decay-scored eviction, and memory lifecycle management.

## Signature

```ts
function collection<T>(opts?: CollectionOptions<T>): CollectionInterface<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `CollectionOptions&lt;T&gt;` | Optional configuration. |

### CollectionOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxSize` | `number` | `Infinity` | Maximum nodes. Lowest-scored evicted on overflow. |
| `weights` | `ScoreWeights` | `{}` | Default weights for topK and eviction scoring. |
| `admissionPolicy` | `AdmissionPolicyFn&lt;T&gt;` | `undefined` | Gate every add(): admit, reject, update an existing node, or merge into one. |
| `forgetPolicy` | `ForgetPolicyFn&lt;T&gt;` | `undefined` | Predicate run before each add() and during gc(). Return true to remove a node. |

## Returns

`Collection&lt;T&gt;` with the following API:

| Method | Signature | Description |
|--------|-----------|-------------|
| `add(content, opts?)` | `(content: T, opts?: MemoryNodeOptions) =&gt; MemoryNode&lt;T&gt; \` | undefined |
| `remove(nodeOrId)` | `(nodeOrId: MemoryNode&lt;T&gt; \` | string) =&gt; boolean |
| `get(id)` | `(id: string) =&gt; MemoryNode&lt;T&gt; \` | undefined |
| `has(id)` | `(id: string) =&gt; boolean` | Check if a node exists. |
| `nodes` | `Store&lt;MemoryNode&lt;T&gt;[]&gt;` | Reactive store of all nodes (updates on add/remove/summarize). |
| `size` | `Store&lt;number&gt;` | Reactive node count. |
| `query(filter)` | `(filter: (n: MemoryNode&lt;T&gt;) =&gt; boolean) =&gt; MemoryNode&lt;T&gt;[]` | Snapshot filter. |
| `byTag(tag)` | `(tag: string) =&gt; MemoryNode&lt;T&gt;[]` | O(1) tag lookup via reactiveIndex. |
| `topK(k, weights?)` | `(k: number, weights?: ScoreWeights) =&gt; MemoryNode&lt;T&gt;[]` | Top-k by decay score. |
| `summarize(ids, reducer, opts?)` | `(...) =&gt; MemoryNode&lt;T&gt;` | Consolidate nodes into one. |
| `gc()` | `() =&gt; number` | Run forgetPolicy on demand; returns count removed. |
| `tagIndex` | `ReactiveIndex` | Reactive tag-to-nodeId index. |
| `destroy()` | `() =&gt; void` | Tear down all nodes and internal stores. |

## Basic Usage

```ts
import { collection } from 'callbag-recharge/memory';

const mem = collection<string>({ maxSize: 100 });

const n = mem.add("The sky is blue", { importance: 0.8, tags: ["fact"] });
n!.touch(); // update accessedAt + accessCount
mem.topK(5); // top 5 by decay score
```

## Options / Behavior Details

- **Admission policy:** Called synchronously on every `add()` with a snapshot of current nodes. Returns `{ action: "admit" | "reject" | "update" | "merge" }`. Use for dedup, conflict resolution, and content merging.
- **Forget policy:** Runs on existing nodes before each new admission and on explicit `gc()` calls. The newly-admitted node is never evaluated by the policy in the same call.
- **Summarize:** Removes source nodes and inserts one consolidated node in a single `batch()` — subscribers see one atomic update. Run forgetPolicy on survivors before inserting the new node.
- **Eviction vs forget:** `maxSize` eviction uses decay scoring (score-based heap). `forgetPolicy` is content/quality-based. Both can coexist — forget runs first, then eviction trims any remaining overflow.
- **Reactivity:** `nodes` and `size` are derived from an internal version counter that bumps on structural changes (add/remove/summarize/gc). Node content changes are reactive through each node's own stores, not through the collection stores.

## Examples

### Dedup with admissionPolicy

```ts
const mem = collection<string>({
    admissionPolicy: (incoming, nodes) => {
      const dup = nodes.find(n => n.content.get() === incoming);
      if (dup) return { action: "update", targetId: dup.id, content: incoming };
      return { action: "admit" };
    },
});
```

### Auto-prune stale nodes with forgetPolicy

```ts
const mem = collection<string>({
    forgetPolicy: (node) => node.meta.get().importance < 0.1,
  });
// Stale nodes pruned before each add(); call mem.gc() for on-demand cleanup.
```

## See Also

- [memoryNode](./memoryNode) — individual memory node
- [vectorIndex](./vectorIndex) — HNSW semantic search
