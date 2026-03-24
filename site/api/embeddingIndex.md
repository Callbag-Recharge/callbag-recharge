# embeddingIndex()

Create an in-browser semantic search index.

Loads an embedding model via Transformers.js and pre-computed vectors
from a binary file. Queries are embedded at runtime and matched against
an HNSW index (from `memory/vectorIndex`).

## Signature

```ts
function embeddingIndex(opts: EmbeddingIndexOptions): EmbeddingIndexResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `EmbeddingIndexOptions` |  |
