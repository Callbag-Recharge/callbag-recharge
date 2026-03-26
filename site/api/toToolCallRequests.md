# toToolCallRequests()

Convert `LLMToolCall[]` from fromLLM into `ToolCallRequest[]` for toolRegistry.
Convenience bridge between the two primitives.

Safe to call on partial tool calls mid-stream: malformed JSON arguments
are passed through as the raw string rather than throwing.

## Signature

```ts
function toToolCallRequests(
	calls: LLMToolCall[],
): Array<{ id: string; tool: string; args: unknown }>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `calls` | `LLMToolCall[]` |  |
