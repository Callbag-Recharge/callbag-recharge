# H2: AI Chat (WebLLM)

Chat UI running a model in-browser via WebGPU (no API key). Tokens stream in real-time, cancel mid-response, retry, token usage meter.

## Files (planned)

- `store.ts` — `chatStream`, `fromAsyncIter`, `switchMap`, `scan`, `tokenTracker`, `state`, `cancellableAction`
- `AIChat.vue` — message list, input, streaming indicator, token meter
