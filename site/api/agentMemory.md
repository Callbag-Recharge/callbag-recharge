# agentMemory()

Reactive agentic memory with queued extraction/embedding and per-operation handles.

## Signature

```ts
function agentMemory(opts: AgentMemoryOptions): AgentMemoryResult
```

## Core behavior

- `add()` runs fact extraction through an internal extraction `jobQueue` (serial LLM calls).
- Extracted facts fan out to an embedding `jobQueue` (configurable concurrency).
- `search()` performs semantic lookup against the internal vector index.
- Memory mutations publish `MemoryEvent` messages on `inner.events`.

## Operation-centric API

`add()` and `search()` return operation handles. There is no global memory-wide status store.

```ts
const addOp = mem.add(messages, scope, { opId: "ingest-42" });
const searchOp = mem.search("typescript", { userId: "alice" }, 10, { opId: "query-99" });

addOp.status.get(); // "queued" | "active" | "completed" | "errored" | "cancelled"
addOp.extracted.get(); // ExtractedFact[]
addOp.storedIds.get(); // string[]

searchOp.results.get(); // AgentMemorySearchResult[]
searchOp.cancel();
```

## Options

| Option | Type | Description |
|---|---|---|
| `llm` | `LLMStore` | LLM used for fact extraction. |
| `embed` | `EmbedFn` | Embedding function `(text, signal?) => Promise<vector>`. |
| `dimensions` | `number` | Vector dimension size. |
| `embeddingConcurrency` | `number` | Embed queue concurrency. Default `4`. |
| `extractionRetry` | `{ maxRetries?: number }` | Extraction retry policy. Default `{ maxRetries: 3 }`. |
| `searchOverfetch` | `number` | Overfetch multiplier before scope filtering. Default `2`. |
| `dedupThreshold` | `number` | Cosine threshold for dedup/update behavior. |
| `adapter` | `CheckpointAdapter` | Optional persistence adapter. |
| `knowledgeGraph` | `KnowledgeGraph<string>` | Optional graph integration target. |
| `graphLlm` | `LLMStore` | Required when `knowledgeGraph` is provided. |
| `graphExtractionPrompt` | `string` | Optional graph extraction prompt override. |
| `shared` | `{ transport, topicName?, filter?, bridgeName? }` | Optional topic bridge config for distributed event sync. |

## Return value

`AgentMemoryResult` exposes:

- `add(messages, scope?, opts?) => AgentMemoryAddOperation`
- `search(query, scope?, k?, opts?) => AgentMemorySearchOperation`
- `getAll(scope?) => MemoryNode<string>[]`
- `update(id, content) => void`
- `delete(id) => boolean`
- `size: Store<number>`
- `inner` access to collection/vector index/queues/events/optional shared bridge
- `destroy()`

## Operation options

Both operation methods accept optional call-specific IDs:

- `add(..., { opId?: string })`
- `search(..., { opId?: string })`

If the same `opId` is used concurrently, ids are deduplicated (`id`, `id#2`, ...).

