# contentStats()

Derive word, character, and line counts from a reactive text store.

## Signature

```ts
function contentStats(content: Store<string>, opts?: { name?: string }): ContentStats
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `content` | `Store&lt;string&gt;` |  |
| `opts` | `{ name?: string }` |  |

## Basic Usage

```ts
const content = state("hello world");
const stats = contentStats(content);
stats.wordCount.get(); // 2
stats.charCount.get(); // 11
stats.lineCount.get(); // 1
```
