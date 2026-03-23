# cursorInfo()

Derive cursor line, column, and display string from a text content store
and a cursor position (character offset) store.

## Signature

```ts
function cursorInfo(
	content: Store<string>,
	position: Store<number>,
	opts?: { name?: string },
): CursorInfo
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `content` | `Store&lt;string&gt;` |  |
| `position` | `Store&lt;number&gt;` |  |
| `opts` | `{ name?: string }` |  |

## Basic Usage

```ts
const content = state("hello\nworld");
const pos = state(8); // "wo|rld"
const cursor = cursorInfo(content, pos);
cursor.line.get();    // 2
cursor.column.get();  // 3
cursor.display.get(); // "Ln 2, Col 3"
```
