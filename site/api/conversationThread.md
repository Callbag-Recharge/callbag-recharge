# conversationThread()

Creates a multi-thread conversation manager for agent-scoped isolation with shared context.

## Signature

```ts
function conversationThread(opts: ConversationThreadOptions): ConversationThreadResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `ConversationThreadOptions` | Factory for LLM streams and optional defaults. |

## Returns

`ConversationThreadResult` — `create`, `get`, `has`, `list`, `shared`, `inject`, `destroy`.

## Basic Usage

```ts
import { conversationThread } from 'callbag-recharge/ai/conversationThread';

const threads = conversationThread({
    factory: async function* (signal, messages) {
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
},
});

const planner = threads.create("planner", { systemPrompt: "You are a planner." });
const coder = threads.create("coder", { systemPrompt: "You write code." });

// Set shared context visible to all threads
threads.shared.set("Project uses TypeScript and React.");

planner.send("Plan the authentication feature");
// Later: share planner's output with coder
threads.inject("coder", planner.messages.get());
coder.send("Implement the plan above.");
```

## Options / Behavior Details

- **Per-thread isolation:** Each thread maintains its own `chatStream` instance with
independent message history, streaming state, and error handling.
- **Shared context:** The `shared` store holds text visible to all threads. When shared
context is set, it is prepended to each thread's message history as a system message on the
next `send()` call via a wrapping factory.
- **Cross-thread injection:** `inject(targetId, messages)` adds messages from another
thread as system-role context in the target, enabling agents to share observations.
Injection is additive — each call appends a new system message rather than replacing
previous injections. Call `setMessages()` on the target thread to reset if needed.
- **Lifecycle:** Each thread is a chatStream — call `destroyThread(id)` to clear and
remove a single thread, or `destroy()` to tear down all threads.
