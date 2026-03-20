# textBuffer()

Headless reactive text document: content, cursor, dirty tracking, and undo history.

## Signature

```ts
function textBuffer(initial = "", opts?: TextBufferOptions): TextBufferResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `initial` | `unknown` | Initial document text. |
| `opts` | `TextBufferOptions` | Optional `maxHistory`, per-field `equals` for text deduping, and `name`. |

### TextBufferOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxHistory` | `number` | `100` | Max undo steps (minimum 2 internally). |
| `equals` | `(a: string, b: string) =&gt; boolean` | `—` | Optional; when set, compares `text` fields of snapshots. Indices must still match for equality skip. |
| `name` | `string` | ``"textBuffer"`` | Debug name prefix for child stores. |

## Returns

`TextBufferResult` — `content` is derived from the undo stack; `history` stores
`TextBufferSnapshot` values (`text` + selection). Use `history.undo` / `redo` (not raw index
hacks) so the caret stays in sync. `replaceRange` applies a slice edit and caret in one step.

## Options / Behavior Details

- **Undo snapshots:** Each edit pushes `{ text, start, end }`. Moving the caret alone
does not push history — only `insert`, `delete`, `replace`, `replaceAll`, and `replaceRange` do.
- **Undo/redo:** `history.undo` and `redo` run in a `batch` so `content` and cursor updates
commit together for subscribers.
