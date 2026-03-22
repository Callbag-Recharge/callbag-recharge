# Session: Worker Bridge + H2 AI Chat Design — Reactive Cross-Thread Communication

**Date:** 2026-03-22
**Topic:** Can callbag-recharge abstract Web Workers / SharedWorkers / Service Workers behind a reactive store bridge? Pain point research, API design, and H2 hero app architecture.

---

## KEY DISCUSSION

### Starting Point: "Can we build friendlier worker communications?"

Research into developer pain points with browser worker APIs, existing libraries (Comlink, threads.js, observable-webworker), and how callbag-recharge's reactive primitives map to worker communication.

### Pain Point Research (8 Major Issues)

Online research surfaced consistent complaints across StackOverflow, blog posts (Surma/Chrome DevRel), library issue trackers, and dev community discussions:

| # | Pain Point | What hurts |
|---|---|---|
| 1 | **No request/response correlation** | `postMessage` is fire-and-forget. Every developer reinvents message ID routing, pending-promise maps, giant `switch` on `e.data.type` |
| 2 | **No streaming primitive** | Comlink (~1M weekly npm downloads) models everything as Promises. Returning incremental results requires abandoning the nice API for raw `postMessage` |
| 3 | **Cancellation is an afterthought** | No standard way to cancel in-flight worker tasks. AbortController doesn't integrate with messaging protocol |
| 4 | **Serialization overhead** | Structured clone is deep copy. 100KB payloads → 100ms+ on low-end devices. `ArrayBuffer` transfer is zero-copy but destructive. `SharedArrayBuffer` requires cross-origin isolation headers that break third-party embeds |
| 5 | **No shared reactive state** | If both threads need consistent access to same state, must manually sync via messages. No library handles this well |
| 6 | **Worker lifecycle leaks** | Workers aren't GC'd. No platform event for "all ports disconnected" on SharedWorker. Memory leaks common |
| 7 | **Separate file requirement** | Bundler integration fragile (different syntax per bundler). Can't inline worker code |
| 8 | **Type safety across boundary** | `MessageEvent.data` is `any`. End-to-end types require manual declarations |

### Existing Library Landscape

| Library | Solves | Misses |
|---|---|---|
| **Comlink** (Google, 12.6K stars) | RPC via Proxy, hides postMessage | No streaming, no cancellation, no pools. Every call = separate `postMessage` round-trip |
| **threads.js** | Worker pools, Observable support | Heavy, bundler plugins needed |
| **observable-webworker** | RxJS Observable I/O, auto-termination | Couples to RxJS, Angular-ecosystem, niche |
| **workerize** (Preact team) | RPC-style function calls | Only exported functions, Webpack-specific |
| **Partytown** (Builder.io) | Moves third-party scripts off main thread | DOM proxy latency, not general-purpose |

**Key insight from research:** The worker channel is inherently a stream (ongoing sequence of messages over time), yet the dominant abstraction (Comlink/RPC) models it as isolated request/response pairs. A reactive/stream approach is a better conceptual fit for the underlying primitive.

### The Three Worker Types

| | Web Worker | SharedWorker | Service Worker |
|---|---|---|---|
| **Relationship** | 1 page : 1 worker | N pages : 1 worker | N pages : 1 proxy |
| **Lifetime** | Dies with page | Dies when last tab closes | Browser-managed |
| **Communication** | `postMessage` direct | `MessagePort` per tab | `navigator.serviceWorker` |
| **IndexedDB** | Yes | Yes | Yes |
| **WebGPU** | Yes | No | No |
| **fetch()** | Yes | Yes | Yes (+ intercept) |

All three share IndexedDB access — concurrent writes are safe (transactional). Only caveat: `onversionchange` conflicts during schema upgrades (already handled by our IndexedDB adapters).

**Decision:** Abstract all three behind the same `workerBridge()` API. Auto-detect worker type from the constructor argument.

### Storage API Compatibility

| Storage API | Main Thread | Web Worker | SharedWorker | Service Worker |
|---|---|---|---|---|
| **IndexedDB** | Yes | Yes | Yes | Yes |
| **localStorage** | Yes | No | No | No |
| **Cache API** | Yes | Yes | Yes | Yes |
| **OPFS** | Yes | Yes (best here) | Yes | Yes |

### ArrayBuffer / SharedArrayBuffer

- **ArrayBuffer transfer** (zero-copy, sender loses access): Good for embeddings, model weights, tensors between threads
- **SharedArrayBuffer** (true shared memory): Requires `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` headers. Breaks OAuth popups, third-party iframes, some CDN scripts. Feasible for self-contained WebLLM apps

### WebLLM Integration Research

WebLLM (`@mlc-ai/web-llm`) already provides all three worker types:
- `WebWorkerMLCEngineHandler` — Web Worker for inference
- `ServiceWorkerMLCEngineHandler` — Service Worker for persistent model
- `CreateWebWorkerMLCEngine` / `CreateServiceWorkerMLCEngine` — main-thread proxy factories

Streaming via `AsyncIterable<ChatCompletionChunk>` — maps directly to a callbag producer.

**Critical insight:** WebLLM already abstracts its own worker communication. We don't wrap WebLLM's engine in our bridge. We wrap the *result* in callbag stores — meeting WebLLM at the `AsyncIterable` boundary, not the `postMessage` boundary. Our bridge is for workers where *we* own the communication: memory, embeddings, data processing.

---

## API DESIGN

### Transport Abstraction (Internal)

```ts
// Normalizes the 3 worker types + BroadcastChannel
interface WorkerTransport {
  post(data: any, transfer?: Transferable[]): void;
  listen(handler: (data: any) => void): () => void;
  terminate?(): void;
}
```

Auto-detection:
- `Worker` → `worker.postMessage()` / `worker.onmessage`
- `SharedWorker` → `worker.port.postMessage()` / `worker.port.onmessage`
- `ServiceWorker` / `navigator.serviceWorker.controller` → `sw.postMessage()` / `navigator.serviceWorker.onmessage`
- `BroadcastChannel` → `ch.postMessage()` / `ch.onmessage`

### Wire Protocol

```ts
type BridgeMessage =
  | { t: 'v'; s: string; d: any }           // value update: store name, data
  | { t: 's'; s: string; sig: string }       // lifecycle signal: PAUSE/RESET/RESUME/TEARDOWN
  | { t: 'r'; stores: string[] }             // ready: worker declares its exported store names
  | { t: 'i'; stores: Record<string, any> }  // init: main sends initial values of exposed stores
```

**Key design choice:** Only settled values cross the wire. DIRTY/RESOLVED stays local to each side's graph. `batch()` on the sender coalesces multiple rapid `set()` calls into one `postMessage`.

### Main-Thread API (`workerBridge`)

```ts
const worker = workerBridge(new Worker('./w.js', { type: 'module' }), {
  expose: { count, query },                    // stores the worker can read
  import: ['results', 'progress'] as const,    // stores the worker provides
  transfer: { embeddings: v => [v.buffer] },   // transferable extractor per store
  name: 'llm-worker',                          // Inspector name
});

// worker.results → Store<T>  (read-only, reactive)
// worker.progress → Store<T> (read-only, reactive)
// worker.status → Store<'connecting' | 'ready' | 'error'>
// worker.error → Store<Error | undefined>
// worker.destroy() → sends TEARDOWN, terminates worker
```

### Worker-Side API (`workerSelf`)

```ts
workerSelf({
  import: ['count', 'query'] as const,
  expose: (imported) => {
    const results = state([]);
    effect([imported.count], ([c]) => { /* react to main thread */ });
    return { results, progress };
  },
});
```

### Transfer Support

```ts
// In worker — zero-copy ArrayBuffer back to main
embeddings.set(float32Array, { transfer: [float32Array.buffer] });
```

Bridge intercepts and uses `postMessage(data, [transferables])`.

---

## H2 AI CHAT ARCHITECTURE

### Three Workers, Three Roles

```
┌─────────────────────────────────────────────────────────────┐
│  Main Thread (Vue UI)                                       │
│                                                             │
│  ┌─────────────┐     ┌──────────────────────────────┐       │
│  │ User Input  │────→│ Web Worker: LLM Inference    │       │
│  │ prompt      │     │ (WebLLM + WebGPU)            │       │
│  │ messages    │     │                              │       │
│  │             │←────│ tokens, modelStatus, usage   │       │
│  └─────────────┘     └──────────────────────────────┘       │
│         │                                                   │
│         │             ┌──────────────────────────────┐       │
│         └────────────→│ SharedWorker: Memory         │       │
│                       │ (summarization + IndexedDB)  │       │
│         ┌─────────────│                              │       │
│         │             │ summary, context, memoryUsed │       │
│         │             └──────────────────────────────┘       │
│  ┌──────▼──────┐                                            │
│  │ Derived     │      ┌──────────────────────────────┐       │
│  │ contextWin  │      │ Service Worker: Cache        │       │
│  │ isStreaming  │      │ (model weight persistence)   │       │
│  │ canSend     │      │ (registered at app boot)     │       │
│  └─────────────┘      └──────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### Worker 1 — LLM Inference (Web Worker)

WebLLM handles its own worker communication. We wrap with callbag stores:

```ts
// store.ts
const prompt = state('');
const messages = state<Message[]>([]);
const tokens = state('');
const modelStatus = state<'loading' | 'ready' | 'generating' | 'idle'>('loading');
const loadProgress = state(0);
const usage = state<Usage | null>(null);

const engine = await CreateWebWorkerMLCEngine(
  new Worker(new URL('./llm-worker.ts', import.meta.url), { type: 'module' }),
  'Llama-3.1-8B-Instruct-q4f32_1-MLC',
  { initProgressCallback: (r) => { loadProgress.set(r.progress); } }
);
modelStatus.set('ready');

// prompt changes → stream completion
effect([prompt], async ([p], { signal }) => {
  if (!p) return;
  modelStatus.set('generating');
  tokens.set('');

  const stream = await engine.chat.completions.create({
    stream: true,
    stream_options: { include_usage: true },
    messages: [...messages.get(), { role: 'user', content: p }],
  });

  let full = '';
  for await (const chunk of stream) {
    if (signal.aborted) break;  // RESET/TEARDOWN → cancel
    const delta = chunk.choices[0]?.delta?.content || '';
    full += delta;
    tokens.set(full);
    if (chunk.usage) usage.set(chunk.usage);
  }

  messages.set([...messages.get(),
    { role: 'user', content: p },
    { role: 'assistant', content: full },
  ]);
  modelStatus.set('idle');
});
```

Key: effect's `signal` (AbortSignal) means cancellation is free — RESET → `for await` breaks.

### Worker 2 — Memory Manager (SharedWorker via bridge)

```ts
// Main thread
const memory = workerBridge(new SharedWorker('./memory-worker.ts', { type: 'module' }), {
  expose: { messages },
  import: ['summary', 'contextWindow', 'memoryStats'] as const,
  name: 'memory',
});
```

```ts
// memory-worker.ts
workerSelf({
  import: ['messages'] as const,
  expose: (imported) => {
    const summary = state('');
    const contextWindow = state<Message[]>([]);
    const memoryStats = state({ entries: 0, sizeBytes: 0 });

    effect([imported.messages], async ([msgs]) => {
      if (msgs.length < 6) { contextWindow.set(msgs); return; }

      const older = msgs.slice(0, -4);
      const recent = msgs.slice(-4);
      const newSummary = await summarize(older);
      summary.set(newSummary);
      contextWindow.set([
        { role: 'system', content: `Previous conversation summary: ${newSummary}` },
        ...recent,
      ]);

      // Write to IndexedDB directly from worker — no round-trip
      await db.put('memories', { timestamp: Date.now(), summary: newSummary, messageCount: msgs.length });
      const stats = await db.count('memories');
      memoryStats.set({ entries: stats, sizeBytes: /* ... */ });
    });

    return { summary, contextWindow, memoryStats };
  },
});
```

Why SharedWorker: multiple chat tabs share one memory worker, one IndexedDB connection, one summarization pipeline. No duplicate work, no write conflicts.

### Worker 3 — Service Worker (model weight cache)

Standard Service Worker caching. No bridge needed — no reactive state to sync.

```ts
// sw.ts
const MODEL_CACHE = 'webllm-models-v1';
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('mlc-ai') || event.request.url.includes('.wasm')) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(MODEL_CACHE).then(cache => cache.put(event.request, clone));
          return response;
        })
      )
    );
  }
});
```

### File Structure

```
src/adapters/
  worker.ts              ← workerBridge(), workerSelf(), WorkerTransport

site/.vitepress/theme/components/showcases/AIChat/
  store.ts               ← pure library code: states, effects, bridge setup
  llm-worker.ts          ← WebWorkerMLCEngineHandler (WebLLM's, not ours)
  memory-worker.ts       ← workerSelf() + summarization + IndexedDB
  sw.ts                  ← model weight caching
  AIChat.vue             ← Vue UI: message list, input, streaming, meters
```

### Derived State (main thread)

```ts
const isGenerating = derived([modelStatus], s => s === 'generating');
const currentResponse = derived([tokens], t => t);
const contextWindow = derived([memory.contextWindow, messages], ([ctx, msgs]) =>
  ctx.length ? ctx : msgs  // fallback before worker ready
);
```

### User Experience Flow

1. **First visit**: Service Worker registers, model downloads (~2-4GB), progress bar from `loadProgress` store
2. **Return visit**: Model loads from cache in seconds
3. **Type a message**: `prompt` → effect → WebLLM streams → `tokens` store → Vue renders each chunk
4. **Cancel mid-response**: Click cancel → RESET signal → AbortSignal → `for await` breaks → clean stop
5. **Long conversation**: Memory SharedWorker summarizes older messages, keeps context window tight
6. **Open second tab**: SharedWorker already running — shared memory, no duplicate summarization
7. **Token meter**: `usage` store drives reactive token count display
8. **Retry**: Remove last message from `messages`, re-set `prompt` → re-streams

---

## REJECTED ALTERNATIVES

1. **Wrap WebLLM's worker in our bridge** — Rejected. WebLLM already has `CreateWebWorkerMLCEngine` which hides `postMessage`. Our bridge would be a wrapper around a wrapper. Instead, meet WebLLM at the `AsyncIterable` boundary and wrap with callbag stores.

2. **Build our own inference worker** — Rejected. WebLLM handles WebGPU, model loading, tokenization, KV cache. Reimplementing would be massive and pointless.

3. **Use BroadcastChannel instead of SharedWorker** — Rejected for memory worker. BroadcastChannel is pub/sub only (no shared computation). SharedWorker means one summarization pipeline shared across tabs.

4. **SharedArrayBuffer for state sync** — Rejected as default. Requires cross-origin isolation headers that break third-party embeds. Support as opt-in for perf-critical paths (raw embeddings).

5. **Send DIRTY/RESOLVED across the wire** — Rejected. Each side has its own reactive graph with its own DIRTY/RESOLVED cycle. Sending control signals across would double the traffic for no benefit. Only settled values cross.

6. **Comlink-style RPC** — Rejected as primary model. RPC is request/response; worker communication is fundamentally a stream. Stores-as-the-API is a better fit.

7. **Abstract Service Worker in bridge** — Partially rejected for H2. Service Worker's role here is caching, not reactive state. The bridge supports Service Worker transport for other use cases, but H2's SW is plain caching.

---

## KEY INSIGHTS

1. **The worker channel IS a stream** — the dominant abstraction (Comlink/RPC) fights this by modeling it as isolated request/response. callbag stores embrace the streaming nature.

2. **Three workers, three roles** — Web Worker for compute (WebGPU/inference), SharedWorker for shared state (cross-tab memory), Service Worker for caching (model weights). Each type has a natural use case in AI chat.

3. **Meet libraries at their boundary** — WebLLM has its own excellent worker abstraction. Don't re-wrap it. Bridge at the `AsyncIterable` boundary. Our bridge is for workers where WE own the communication.

4. **IndexedDB is the shared state primitive** — all worker types can access it. The memory worker writes directly to IndexedDB from the worker thread, no `postMessage` round-trip needed.

5. **effect + AbortSignal = free cancellation** — RESET signal → AbortSignal → `for await` breaks. No special cancellation protocol needed for streaming LLM responses.

6. **Batch coalescing solves serialization overhead** — multiple rapid `set()` calls coalesce into one `postMessage` via `batch()`. Direct answer to pain point #4.

---

## BUILD ORDER

| Step | What | Where | Effort |
|---|---|---|---|
| 1 | `WorkerTransport` + auto-detect (Web/Shared/Service/BroadcastChannel) | `adapters/worker.ts` | S |
| 2 | `workerBridge()` + `workerSelf()` — expose/import, value sync, batch coalescing | `adapters/worker.ts` | M |
| 3 | Lifecycle signals across bridge (PAUSE/RESET/TEARDOWN) | `adapters/worker.ts` | S |
| 4 | `withStatus()` integration + transfer support | `adapters/worker.ts` | S |
| 5 | H2 `store.ts` — WebLLM + memory worker wiring | `showcases/AIChat/` | M |
| 6 | H2 `AIChat.vue` — UI (message list, streaming, token meter, cancel) | `showcases/AIChat/` | M |
| 7 | H2 `memory-worker.ts` + `sw.ts` | `showcases/AIChat/` | M |
| 8 | Tests for bridge protocol | `__tests__/adapters/` | S |

Total: ~6-8 days.

---

## DOWNSTREAM IMPACT

- **Phase 7 adapters** — `WorkerTransport` generalizes to any bidirectional message channel. Redis, NATS, Unix socket adapters can use the same transport interface.
- **Phase 8c multi-agent distribution** — Worker bridge is the browser-native version of cross-process bridges. Same pattern, different transport.
- **Phase 6 deep memory** — Vector index (HNSW) naturally runs in a dedicated worker. The bridge provides the reactive interface.
- **H1 Markdown Editor** — Could use a Web Worker for heavy markdown parsing + syntax highlighting.
- **H3 Workflow Builder** — Could use SharedWorker for cross-tab pipeline state.

---

## FILES CHANGED

No implementation files changed. Design session only.
- Roadmap updated with Phase 5g (Worker Bridge) and H2 dependencies
- This session log added to archive
