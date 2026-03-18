---
outline: deep
---

# AI Chat with Streaming

Build a streaming AI chat with auto-cancellation, chunk accumulation, and retry — using only Level 1-2 primitives.

## The Problem

Every AI chat app needs:
- **Streaming chunks** from the LLM API accumulated into a full message
- **Auto-cancellation** — when the user sends a new prompt, cancel the in-flight response
- **Retry** — resilient API calls that recover from transient failures
- **Reactive UI state** — conversation history, loading indicator, token count

Most solutions use ad-hoc `useState` + `useEffect` + `AbortController` + refs. This recipe shows how callbag-recharge handles all of it in a declarative reactive graph.

## The Solution

<<< @/../examples/streaming.ts

## Full Example: Chat with History

```ts
import { state, derived, effect, pipe, producer } from 'callbag-recharge'
import { switchMap, scan, filter, subscribe } from 'callbag-recharge/extra'

// ── State ──────────────────────────────────────────────────

const prompt = state('')
const history = state<Array<{ role: string; content: string }>>([])
const isStreaming = state(false)

// ── Streaming response ─────────────────────────────────────

// switchMap auto-cancels the previous stream when prompt changes
const chunks = pipe(
  prompt,
  filter((p): p is string => p.length > 0),
  switchMap((p) =>
    producer<string>(({ emit, complete }) => {
      const ctrl = new AbortController()
      isStreaming.set(true)

      ;(async () => {
        const res = await fetch('/api/chat', {
          method: 'POST',
          body: JSON.stringify({ prompt: p }),
          signal: ctrl.signal,
        })
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          emit(decoder.decode(value))
        }
        complete()
        isStreaming.set(false)
      })().catch(() => {
        isStreaming.set(false)
      })

      return () => {
        ctrl.abort()
        isStreaming.set(false)
      }
    }),
  ),
  filter((chunk): chunk is string => chunk !== undefined),
)

// Accumulate chunks into the full response text
const currentResponse = pipe(
  chunks,
  scan((acc, chunk) => acc + chunk, ''),
)

// ── Derived state ──────────────────────────────────────────

const tokenEstimate = derived(
  [currentResponse],
  () => Math.ceil((currentResponse.get() ?? '').length / 4)
)

const displayHistory = derived(
  [history, currentResponse, isStreaming],
  () => {
    const h = history.get()
    if (isStreaming.get()) {
      return [...h, { role: 'assistant', content: currentResponse.get() ?? '' }]
    }
    return h
  }
)

// ── Side effects ───────────────────────────────────────────

// When streaming completes, append to history
effect([isStreaming], () => {
  const streaming = isStreaming.get()
  const response = currentResponse.get()
  if (!streaming && response) {
    history.update(h => [...h, { role: 'assistant', content: response }])
  }
  return undefined
})

// ── Usage ──────────────────────────────────────────────────

function sendMessage(text: string) {
  history.update(h => [...h, { role: 'user', content: text }])
  prompt.set(text)
}

// Subscribe to updates (connect to your UI framework)
subscribe(displayHistory, (messages) => {
  console.log('Messages:', messages.length)
})
subscribe(tokenEstimate, (tokens) => {
  console.log('Tokens ~', tokens)
})
```

## Why This Works

1. **`pipe` + `switchMap`** — Each new prompt cancels the previous fetch via `AbortController`. No manual cleanup. The cleanup function in the producer fires automatically.

2. **`pipe` + `scan`** — Accumulates chunks into a growing string. Each chunk emission updates `currentResponse`, which updates `tokenEstimate` and `displayHistory` via the reactive graph.

3. **`filter`** — Skips empty prompts and `undefined` initial values from `switchMap`.

4. **Diamond resolution** — `displayHistory` depends on both `history` and `isStreaming`. When streaming ends and both update, the derived store recomputes exactly once with consistent values.

5. **Inspectable** — Every store in this graph has a name and can be observed via `Inspector`. You can see the full reactive graph, current values, and dirty/resolved phases at any time.

## Adding Retry

Wrap the streaming pipe with `retry` for resilient API calls:

```ts
import { retry } from 'callbag-recharge/extra'

const resilientChunks = pipe(chunks, retry(3))
const currentResponse = pipe(resilientChunks, scan((acc, chunk) => acc + chunk, ''))
```

The `retry` operator will re-subscribe to the producer up to 3 times on error, automatically re-triggering the fetch.

## Framework Integration

This recipe is framework-agnostic. To connect to React:

```ts
// Minimal React hook (no external dependency)
function useStore<T>(store: Store<T>): T {
  const [value, setValue] = useState(store.get())
  useEffect(() => subscribe(store, setValue), [store])
  return value
}

function ChatUI() {
  const messages = useStore(displayHistory)
  const streaming = useStore(isStreaming)
  const tokens = useStore(tokenEstimate)
  // ... render
}
```

The same stores work with Vue (`watchEffect`), Svelte (`$:` blocks), Solid (`createEffect`), or no framework at all.
