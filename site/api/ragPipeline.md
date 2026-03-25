# ragPipeline()

Creates a reactive retrieve-augment-generate pipeline.

## Signature

```ts
function ragPipeline(opts: RagPipelineOptions): RagPipelineResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `RagPipelineOptions` | Pipeline configuration (query store, search sources, LLM store). |

## Returns

`RagPipelineResult` — reactive `context`, `docs`, `generating`, `error` stores + `destroy()`.

## Basic Usage

```ts
import { state } from 'callbag-recharge';
import { ragPipeline, docIndex, fromLLM } from 'callbag-recharge/ai';

const query = state('');
const docs = docIndex({ db: '/docs-index.db' });
const llm = fromLLM({ provider: 'ollama', model: 'llama4' });

const rag = ragPipeline({ query, docSearch: docs, llm });

// Trigger retrieval + generation
query.set('How do I use derived stores?');
// rag.generating.get() → true
// rag.context.get() → "SEARCH RESULTS:\n[1] ..."
// llm.get() → accumulating response...
```

## Options / Behavior Details

- **Reactive query:** Set `opts.query` to a non-empty string to trigger retrieval + generation.
- **Async semantic search:** If `semanticSearch` is provided and loaded, waits for embedding
result before generating. Uses `latestAsync` to cancel stale in-flight searches on rapid query changes.
- **Context assembly:** `SYSTEM PROMPT` → `SUMMARY` → `USER CONTEXT` → `SEARCH RESULTS`.
- **Cleanup:** `destroy()` cancels in-flight searches, unsubscribes from query, and tears down
derived stores. Does not destroy passed-in stores (llm, docSearch, etc.).
