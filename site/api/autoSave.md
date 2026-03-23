# autoSave()

Wire up auto-save for any content store: debounce → checkpoint → status.

Requires a `dirty` store to track whether the buffer has unsaved changes.
After each successful checkpoint persist, optionally calls `markClean()`.

## Signature

```ts
function autoSave<T>(
	content: Store<T>,
	dirty: Store<boolean>,
	adapter: CheckpointAdapter,
	opts?: AutoSaveOptions,
): AutoSaveResult<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `content` | `Store&lt;T&gt;` |  |
| `dirty` | `Store&lt;boolean&gt;` |  |
| `adapter` | `CheckpointAdapter` |  |
| `opts` | `AutoSaveOptions` |  |

## Basic Usage

```ts
const editor = textEditor({ initial: "" });
const save = autoSave(editor.buffer.content, editor.buffer.dirty, memoryAdapter(), {
    debounceMs: 1000,
    checkpointId: "my-editor",
    markClean: () => editor.buffer.markClean(),
  });
save.status.get(); // "saved" | "saving" | "unsaved"
save.dispose();
```
