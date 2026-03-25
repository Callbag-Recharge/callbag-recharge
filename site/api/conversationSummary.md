# conversationSummary()

Auto-summarizes a conversation when token count exceeds a threshold.

## Signature

```ts
function conversationSummary(opts: ConversationSummaryOptions): ConversationSummaryStore
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `ConversationSummaryOptions` | Chat stream, LLM store, and token threshold. |

## Returns

`ConversationSummaryStore` — `Store&lt;string&gt;` with the rolling summary, plus `destroy()`.

## Basic Usage

```ts
import { state } from 'callbag-recharge';
import { chatStream, conversationSummary, fromLLM, ragPipeline } from 'callbag-recharge/ai';

const llm = fromLLM({ provider: 'ollama', model: 'llama4' });
const chat = chatStream(async function* (messages, signal) { ... });
const summary = conversationSummary({ chat, llm, maxTokens: 2000 });

const query = state('');
const rag = ragPipeline({ query, docSearch, llm, summary });
// summary.get() → rolling summary injected as SUMMARY section in rag.context
```

## Options / Behavior Details

- **Trigger window:** Only fires after an assistant response (last message is `"assistant"`),
when the LLM is idle (`status !== "active"`).
- **Rolling:** Each summarization replaces the previous summary. Chain with `systemPromptBuilder`
or pass as `summary` to `ragPipeline` to inject into the system prompt.
- **Shared LLM:** Safe to share `llm` with `ragPipeline`. The `status !== "active"` guard
prevents summarization from interrupting an in-progress generation.
