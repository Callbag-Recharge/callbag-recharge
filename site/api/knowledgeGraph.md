# knowledgeGraph()

Creates a reactive knowledge graph with entity relationships, temporal
tracking, and graph-based retrieval.

## Signature

```ts
function knowledgeGraph<T>(opts?: KnowledgeGraphOptions<T>): KnowledgeGraphInterface<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `KnowledgeGraphOptions&lt;T&gt;` | Optional configuration (all `CollectionOptions` pass through to the internal entity collection). |

## Returns

`KnowledgeGraph&lt;T&gt;` — entity CRUD, relation management, graph queries, reactive stores.

## Basic Usage

```ts
import { knowledgeGraph } from 'callbag-recharge/memory';

const kg = knowledgeGraph<string>();
kg.addEntity("Alice", { id: "alice" });
kg.addEntity("Bob", { id: "bob" });
kg.addRelation("alice", "bob", "knows", { weight: 0.9 });

kg.neighbors("alice"); // [MemoryNode<"Bob">]
kg.outgoing("alice", "knows"); // [Relation]
```

## Options / Behavior Details

- **Entities** are stored in an internal `Collection<T>`, exposed via `.collection`. All collection features (topK, byTag, gc, summarize, admission/forget policies, eviction) are available.
- **Relations** are directed, typed edges with temporal metadata (createdAt, updatedAt, weight). Indexed by type via `typeIndex`.
- **Cascade deletion** — removing an entity automatically removes all its relations via `subscribe` on collection.nodes (§1.19).
- **Graph traversal** — BFS via `traverse()`, shortest path via `shortestPath()`, subgraph extraction via `subgraph()`.
- **Reactive queries** — `relationsOf()` and `neighborsOf()` return cached reactive stores that update when relations change.

## See Also

- [collection](./collection) — entity storage
- [vectorIndex](./vectorIndex) — semantic search
