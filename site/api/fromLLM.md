# fromLLM()

Creates a unified reactive source for LLM inference via any OpenAI-compatible endpoint.

## Signature

```ts
function fromLLM(opts: LLMOptions): LLMStore
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `LLMOptions` | Provider configuration (provider, baseURL, apiKey, model). |

## Returns

`LLMStore` — `Store&lt;string&gt;` with `status`, `error`, `tokens` companion stores, plus `generate()` and `abort()`.

## Basic Usage

```ts
import { fromLLM } from 'callbag-recharge/adapters';
import { effect } from 'callbag-recharge';

const llm = fromLLM({ provider: 'ollama', model: 'llama4' });

effect([llm], () => {
    console.log(llm.get()); // accumulating response...
  });

llm.generate([{ role: 'user', content: 'What is TypeScript?' }]);
// llm.status.get() → "active"
// llm.get() → "TypeScript is..."
```

## Options / Behavior Details

- **Provider-agnostic:** Works with OpenAI, Ollama, Anthropic (via proxy), Vercel AI SDK, or any OpenAI-compatible endpoint.
- **No hard deps:** Uses fetch + SSE line parsing. No SDK imports required.
- **Auto-cancel:** Calling `generate()` while streaming aborts the previous generation.
- **Token tracking:** `tokens` store populated on stream completion (when usage data is available).
- **Status:** Uses WithStatusStatus enum (pending → active → completed/errored) for consistent lifecycle tracking.
- **Persistent source:** This is a long-lived store backed by `state()`. It does not send callbag END — lifecycle is managed imperatively via `generate()`/`abort()`, not via stream completion. Do not wrap with `withStatus()` or `retry()` — use the built-in `.status` and `.error` companions instead.
