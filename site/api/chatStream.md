# chatStream()

Creates an LLM streaming chat with auto-cancellation and backpressure.

## Signature

```ts
function chatStream(factory: ChatStreamFactory, opts?: ChatStreamOptions): ChatStreamResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `factory` | `ChatStreamFactory` | Async iterable factory: receives messages + AbortSignal, yields text chunks. |
| `opts` | `ChatStreamOptions` | Optional configuration. |

## Returns

`ChatStreamResult` — `send`, `stop`, `retry`, `clear`, `messages`, `partial`, `streaming`, `error`.

## Basic Usage

```ts
import { chatStream } from 'callbag-recharge/ai/chatStream';

const chat = chatStream(async function* (signal, messages) {
    const res = await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages }),
        signal,
      });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value);
  }
});

chat.send('Hello!');
// chat.messages.get() → [{ role: 'system', content: '...' }, { role: 'user', content: 'Hello!' }]
// chat.partial.get() → accumulating response text...
// chat.streaming.get() → true
```

## Options / Behavior Details

- **Auto-cancel:** Sending a new message while streaming cancels the current generation.
- **Rate limiting:** Pass a `rateLimiter` to throttle API calls (e.g., for LLM RPM limits).
- **Message history:** `messages` store includes the system prompt (if set) and reactively updates.
