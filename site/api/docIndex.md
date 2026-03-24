# docIndex()

Create a read-only FTS5 trigram search index over a pre-built wa-sqlite DB.

The DB is fetched and loaded into WASM on first call. Subsequent `search()`
calls execute FTS5 MATCH queries synchronously against the in-memory DB.

## Signature

```ts
function docIndex(opts: DocIndexOptions): DocIndexResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `DocIndexOptions` |  |
