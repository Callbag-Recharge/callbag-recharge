# SESSION: Generic Legos + Text Editor Build Plan

**Date:** March 19, 2026
**Topic:** Identify missing generic building blocks ("legos") across the library, then compose them into a text editor pattern — validating both the primitives and the composition model.

---

## MOTIVATION

Two objectives:
1. **Test correctness** — Mid-size legos exercise diamond resolution, batch updates, disconnect-on-unsub, error propagation, and multi-store coordination in ways that unit tests on primitives alone cannot.
2. **Build reusable blocks** — The gap between core primitives and full patterns (like `chatStream`, `agentLoop`) is too wide. Intermediate legos make composition accessible and reduce boilerplate for downstream tools.

The text editor is the **proving ground** — a realistic application that composes 5+ legos and exercises the full reactive graph lifecycle.

---

## INVENTORY AUDIT: WHAT EXISTS

### Patterns (10)
| Pattern | Primitives | Reusable parts baked in |
|---------|-----------|------------------------|
| formField | state, derived, effect | dirty tracking, sync+async validation, debounce |
| undoRedo | state, derived, batch | history stack, checkpoint, undo/redo |
| createStore | state, derived, subscribe, batch | selector, teardown |
| chatStream | state | message accumulation, cancellation |
| agentLoop | state | phase FSM, iteration control |
| toolCallState | state | status FSM, duration tracking |
| pagination | state, derived, cancellableAction | page navigation, loading state |
| rateLimiter | producer, state, subscribe | drop/queue/error strategies |
| hybridRoute | state, subscribe | confidence routing, fallback |
| memoryStore | collection, derived, state | 3-tier memory, decay scoring |

### Utils (19+)
| Utility | Type | Consumers |
|---------|------|-----------|
| backoff (6 strategies) | pure fn | retry, circuitBreaker, connectionHealth |
| eviction (5 policies) | pure obj | reactiveMap, collection, any bounded store |
| rateLimiter (2) | pure obj | rateLimiter pattern, API clients |
| cancellableAction | reactive | pagination, any async fetch |
| cancellableStream | reactive | chatStream, SSE, WebSocket |
| stateMachine | reactive | could be used by agentLoop, toolCallState |
| circuitBreaker | pure obj | withBreaker orchestration op |
| connectionHealth | reactive | WebSocket, SSE adapters |
| batchWriter | reactive | logging, analytics, bulk API |

### Data Structures (4)
reactiveMap, reactiveLog, reactiveIndex, pubsub

---

## GAP ANALYSIS: MISSING LEGOS

### Tier A — Extract from existing patterns (refactor, no new concepts)

#### A1: `dirtyTracker(source, baseline, equals?)`
**Location:** `utils/dirtyTracker.ts`
**What:** A `Store<boolean>` that tracks whether a source has diverged from a baseline value. Currently baked into formField (lines 92-94).
**Interface:**
```ts
interface DirtyTracker {
  dirty: Store<boolean>;
  /** Update the baseline (e.g., after save) */
  resetBaseline(value?: T): void;
  dispose(): void;
}
```
**Why generic:** Editors, forms, settings panels, config diff indicators, "unsaved changes" prompts — all need dirty tracking. formField's version is non-extractable (hardcoded to `initial`).
**Exercises:** derived equality check, disconnect-on-unsub, baseline mutation.
**Consumers:** formField (refactor to use), textBuffer, any "save" workflow.

#### A2: `validationPipeline(source, validators[])`
**Location:** `utils/validationPipeline.ts`
**What:** Composable sync+async validation chain. formField's validation is coupled to its lifecycle. This extracts it as a standalone pipeline.
**Interface:**
```ts
type SyncValidator<T> = (value: T) => string | true | undefined;
type AsyncValidator<T> = (value: T, signal: AbortSignal) => Promise<string | undefined>;

interface ValidationPipelineOptions<T> {
  sync?: SyncValidator<T>[];
  async?: AsyncValidator<T>[];
  debounceMs?: number;
}

interface ValidationPipeline<T> {
  error: Store<string>;       // first failing error
  errors: Store<string[]>;    // all errors
  valid: Store<boolean>;
  validating: Store<boolean>;
  /** Manually trigger validation */
  validate(): void;
  dispose(): void;
}
```
**Why generic:** Form fields, CLI input validation, data ingestion pipelines, schema validation, editor content validation (markdown lint, word count limits).
**Exercises:** effect cleanup (abort controllers), derived chains, multi-store coordination.
**Consumers:** formField (refactor), textEditor (content validation), data pipeline input.

#### A3: `asyncQueue(opts)`
**Location:** `utils/asyncQueue.ts`
**What:** Generic async task queue with concurrency control. batchWriter handles flush-on-threshold but can't limit concurrent execution.
**Interface:**
```ts
interface AsyncQueueOptions {
  concurrency?: number;  // default: 1
  strategy?: 'fifo' | 'lifo' | 'priority';
}

interface AsyncQueue<T, R> {
  enqueue(task: T, priority?: number): Promise<R>;
  size: Store<number>;
  pending: Store<number>;
  running: Store<number>;
  pause(): void;
  resume(): void;
  clear(): void;
  dispose(): void;
}
```
**Why generic:** Tool call execution queues, file upload queues, API call throttling, pipeline step scheduling, LLM request batching.
**Exercises:** producer lifecycle, state coordination, cleanup on dispose.
**Consumers:** agentLoop (sequential tool calls), pipeline steps, bulk operations.

---

### Tier B — New generic primitives

#### B1: `selection(opts?)`
**Location:** `patterns/selection/index.ts`
**What:** Generic selection model — works for text cursors, list item selection, table ranges, tree nodes.
**Interface:**
```ts
interface SelectionOptions {
  mode?: 'single' | 'range' | 'multi';  // default: 'range'
  /** Total selectable length (for clamp). Reactive — can be a Store. */
  length?: number | Store<number>;
}

interface Selection {
  start: Store<number>;
  end: Store<number>;
  /** Collapsed = cursor (start === end) */
  collapsed: Store<boolean>;
  /** Selected text length */
  size: Store<number>;
  /** Direction of selection */
  direction: Store<'forward' | 'backward' | 'none'>;

  select(start: number, end: number): void;
  collapse(position: number): void;
  collapseToStart(): void;
  collapseToEnd(): void;
  extend(by: number): void;
  selectAll(): void;
  moveCursor(by: number): void;
  dispose(): void;
}
```
**Why generic:** Text cursor, list selection, spreadsheet cell range, tree view, timeline scrubbing, code editor, image crop region.
**Exercises:** batch updates (select updates start+end atomically), derived chains (collapsed, size, direction all derived from start+end), boundary clamping with reactive length.
**Consumers:** textBuffer, reactiveList (item selection), any UI with position tracking.

#### B2: `reactiveList(initial[])`
**Location:** `data/reactiveList.ts`
**What:** Reactive ordered collection with positional operations. reactiveMap is key-value; this is index-based with structural change tracking.
**Interface:**
```ts
interface ReactiveList<T> {
  items: Store<readonly T[]>;
  length: Store<number>;
  version: Store<number>;

  get(index: number): T | undefined;
  set(index: number, value: T): void;
  push(...items: T[]): void;
  pop(): T | undefined;
  insert(index: number, ...items: T[]): void;
  remove(index: number, count?: number): T[];
  move(from: number, to: number): void;
  swap(i: number, j: number): void;
  clear(): void;

  /** Derived store for a specific index (reactive to structural changes) */
  at(index: number): Store<T | undefined>;
  /** Derived store from a slice */
  slice(start: number, end?: number): Store<readonly T[]>;
  /** Reactive find */
  find(predicate: (item: T) => boolean): Store<T | undefined>;

  snapshot(): readonly T[];
}
```
**Why generic:** Chat message lists, todo items, editor lines, sortable UIs, playlist management, log viewers, table rows.
**Exercises:** version-gated derived (same pattern as reactiveMap), structural change propagation, derived `at()` stores that update on insert/remove.
**Consumers:** textBuffer (line-based editing mode), chatStream (message list), any ordered UI.

#### B3: `commandBus(commands)`
**Location:** `patterns/commandBus/index.ts`
**What:** Typed command dispatch with middleware and undo integration. pubsub is topic-based but untyped; this adds type safety, middleware, and command history.
**Interface:**
```ts
interface CommandDef<Args = void, Result = void> {
  execute(args: Args): Result | Promise<Result>;
  undo?(args: Args): void | Promise<void>;
}

interface CommandBusOptions {
  /** Max history for undo. 0 = no history. Default: 50 */
  maxHistory?: number;
  /** Middleware stack */
  middleware?: CommandMiddleware[];
}

interface CommandBus<Commands extends Record<string, CommandDef<any, any>>> {
  /** Dispatch a command */
  dispatch<K extends keyof Commands>(
    name: K,
    args: Commands[K] extends CommandDef<infer A, any> ? A : never
  ): Commands[K] extends CommandDef<any, infer R> ? R : void;

  /** Last dispatched command */
  lastCommand: Store<{ name: string; args: unknown } | null>;

  /** Whether undo is available */
  canUndo: Store<boolean>;
  canRedo: Store<boolean>;
  undo(): void;
  redo(): void;

  /** Subscribe to specific command executions */
  on<K extends keyof Commands>(name: K, handler: (args: any) => void): () => void;

  dispose(): void;
}
```
**Why generic:** Editor keybindings, agent action dispatch, CLI tools, game input, undo/redo across any domain, macro recording.
**Exercises:** state + pubsub composition, typed dispatch, middleware chains, undo stack integration with undoRedo pattern.
**Consumers:** textEditor (keybindings), agentLoop (action dispatch), any interactive tool.

#### B4: `countdown(ms)` / `stopwatch()`
**Location:** `utils/timer.ts`
**What:** Reactive timer with pause/resume/reset. interval exists as a raw source but no controlled timer pattern.
**Interface:**
```ts
interface Countdown {
  remaining: Store<number>;  // ms remaining
  active: Store<boolean>;
  expired: Store<boolean>;
  start(): void;
  pause(): void;
  resume(): void;
  reset(ms?: number): void;
  dispose(): void;
}

interface Stopwatch {
  elapsed: Store<number>;   // ms elapsed
  active: Store<boolean>;
  laps: Store<readonly number[]>;
  start(): void;
  pause(): void;
  resume(): void;
  lap(): void;
  reset(): void;
  dispose(): void;
}
```
**Why generic:** Rate limit UIs, session timeouts, pomodoro timers, debounce visualization, game timers, progress indicators, benchmark tooling.
**Exercises:** producer with interval cleanup, state coordination, effect lifecycle.
**Consumers:** rateLimiter (visual feedback), connectionHealth (timeout display), any time-sensitive UI.

#### B5: `focusManager(ids)`
**Location:** `patterns/focusManager/index.ts`
**What:** Reactive focus/activation tracking for a set of identifiable elements.
**Interface:**
```ts
interface FocusManager {
  active: Store<string | null>;
  /** Whether any element is focused */
  hasFocus: Store<boolean>;

  focus(id: string): void;
  blur(): void;
  next(): void;
  prev(): void;
  /** Register/unregister focusable IDs */
  register(id: string): void;
  unregister(id: string): void;

  /** Check if specific ID is active */
  isFocused(id: string): Store<boolean>;

  dispose(): void;
}
```
**Why generic:** Editor tabs, form field navigation, panel focus, accessibility (roving tabindex), menu navigation, multi-pane layouts.
**Exercises:** derived per-ID stores (isFocused), dynamic registration, ordered traversal.
**Consumers:** textEditor (toolbar/content focus), multi-editor layouts, accessibility.

---

### Tier C — Composed patterns (built from Tier A+B legos)

#### C1: `textBuffer(initial?)`
**Location:** `patterns/textBuffer/index.ts`
**What:** Headless reactive text document model. The core "document" that an editor operates on.
**Composes:** `state<string>` + `selection` (B1) + `undoRedo` + `dirtyTracker` (A1)
**Interface:**
```ts
interface TextBufferOptions {
  /** Max undo history. Default: 100 */
  maxHistory?: number;
  /** Custom equality for dirty tracking */
  equals?: (a: string, b: string) => boolean;
}

interface TextBuffer {
  // Content
  content: Store<string>;
  /** Line count */
  lineCount: Store<number>;
  /** Character count */
  charCount: Store<number>;

  // Cursor & Selection
  cursor: Selection;

  // History
  history: UndoRedoResult<string>;

  // Dirty tracking
  dirty: Store<boolean>;
  markClean(): void;

  // Edit operations (all update content + cursor + history atomically)
  insert(text: string): void;
  /** Delete selection, or single char if collapsed */
  delete(direction?: 'forward' | 'backward'): void;
  /** Replace selection range */
  replace(text: string): void;
  /** Replace all content */
  replaceAll(text: string): void;
  /** Get text in range */
  getRange(start: number, end: number): string;
  /** Get selected text */
  selectedText: Store<string>;

  // Line operations
  getLine(n: number): string;
  insertLine(n: number, text: string): void;

  dispose(): void;
}
```
**Why this composition matters:** Every edit operation must atomically update content + cursor + push to undo stack + update dirty flag. This exercises `batch()` heavily — 4 stores updated in a single transaction with diamond resolution ensuring derived stores (lineCount, charCount, selectedText, dirty) recompute exactly once.
**Exercises:** batch atomicity, diamond resolution (content → lineCount + charCount + dirty + selectedText), undo/redo state restoration (content + cursor position), disconnect-on-unsub for derived stores.

#### C2: `textEditor(opts?)`
**Location:** `patterns/textEditor/index.ts`
**What:** Full headless editor. Composes textBuffer with commands, focus, and optional validation/preview.
**Composes:** `textBuffer` (C1) + `commandBus` (B3) + `focusManager` (B5) + `validationPipeline` (A2)
**Interface:**
```ts
interface TextEditorOptions {
  initial?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Max length (validated) */
  maxLength?: number;
  /** Custom validators */
  validators?: SyncValidator<string>[];
  asyncValidators?: AsyncValidator<string>[];
  /** Enable markdown preview */
  markdown?: boolean | ((content: string) => string);
  /** Submit handler */
  onSubmit?: (content: string) => void | Promise<void>;
  /** Cancel handler */
  onCancel?: () => void;
}

interface TextEditor {
  buffer: TextBuffer;
  commands: CommandBus<EditorCommands>;
  focus: FocusManager;

  // Validation
  error: Store<string>;
  valid: Store<boolean>;

  // Preview (if markdown enabled)
  preview: Store<string>;

  // Actions
  submit(): Promise<void>;
  cancel(): void;
  /** Whether content is non-empty and valid */
  canSubmit: Store<boolean>;
  /** Whether submit is in progress */
  submitting: Store<boolean>;

  dispose(): void;
}

// Built-in editor commands
interface EditorCommands {
  bold: CommandDef;
  italic: CommandDef;
  heading: CommandDef<{ level: 1 | 2 | 3 }>;
  link: CommandDef<{ url: string; text?: string }>;
  list: CommandDef<{ ordered: boolean }>;
  code: CommandDef<{ block: boolean }>;
  undo: CommandDef;
  redo: CommandDef;
}
```
**Why this is the capstone:** textEditor composes 5 patterns (textBuffer, selection, undoRedo, commandBus, focusManager) + 2 utils (dirtyTracker, validationPipeline). Its reactive graph has 15+ stores with multiple diamond shapes. If this works correctly — batch updates are atomic, diamonds resolve once, cleanup is complete — the library's composition model is validated.

---

## BUILD ORDER

Each step is independently shippable, testable, and useful.

```
Phase 1: Foundation Legos (Tier A — extract + refactor)
  Step 1: dirtyTracker          → utils/dirtyTracker.ts
  Step 2: validationPipeline    → utils/validationPipeline.ts
  Step 3: asyncQueue            → utils/asyncQueue.ts

Phase 2: Generic Primitives (Tier B — new)
  Step 4: selection             → patterns/selection/index.ts
  Step 5: reactiveList          → data/reactiveList.ts
  Step 6: countdown + stopwatch → utils/timer.ts
  Step 7: commandBus            → patterns/commandBus/index.ts
  Step 8: focusManager          → patterns/focusManager/index.ts

Phase 3: Composed Patterns (Tier C — composition)
  Step 9:  textBuffer           → patterns/textBuffer/index.ts
  Step 10: textEditor           → patterns/textEditor/index.ts

Phase 4: Examples
  Step 11: examples/text-editor-simple.ts    (textbox + submit/cancel)
  Step 12: examples/markdown-editor.ts       (full markdown with preview)
  Step 13: examples/form-with-editor.ts      (editor inside formField)
```

### Phase 4.5: Workable Markdown Editor Readiness (MVP hardening)

To move from "composed primitives exist" to a **workable markdown editor** for real usage,
complete the following after Phase 4:

```
Step 14: textBuffer undo snapshots restore cursor+selection with content
Step 15: textEditor command ergonomics hardening (multiline list/code-block behavior, toggle semantics)
Step 16: canonical UI adapter example (textarea/contenteditable wiring contract)
Step 17: edge-case tests for suppressed signal paths + async submit/validator failures
```

**Goal of Phase 4.5:** ensure editor behavior is robust enough for day-to-day markdown editing,
not just API-level composition validation.

### Dependency Graph

```
dirtyTracker ─────────────────────────────────────────┐
validationPipeline ───────────────────────────────┐   │
asyncQueue (independent)                          │   │
selection ────────────────────────────────────┐   │   │
reactiveList (independent)                    │   │   │
timer (independent)                           │   │   │
commandBus ──────────────────────────────┐    │   │   │
focusManager ───────────────────────┐    │    │   │   │
                                    │    │    │   │   │
                                    ▼    ▼    ▼   ▼   ▼
                                   textBuffer ────────┘
                                        │
                                        ▼
                                   textEditor
                                        │
                                        ▼
                                   examples/
```

### Parallelization

Steps 1-3 are independent — can be built in parallel.
Steps 4-8 are independent — can be built in parallel.
Steps 9-10 are sequential (10 depends on 9).
Steps 11-13 are independent once 10 is done.

---

## WHAT EACH STEP STRESS-TESTS

| Step | Lego | Library features exercised |
|------|-------|--------------------------|
| 1 | dirtyTracker | derived equality, disconnect-on-unsub, baseline mutation |
| 2 | validationPipeline | effect cleanup (abort), derived chains, multi-store coordination |
| 3 | asyncQueue | producer lifecycle, state coordination, dispose cleanup |
| 4 | selection | batch atomicity (start+end), derived chains (5 stores from 2), boundary clamping |
| 5 | reactiveList | version-gated derived, structural propagation, lazy `at()` stores |
| 6 | timer | producer with setInterval cleanup, pause/resume state machine |
| 7 | commandBus | state + pubsub, typed dispatch, undo stack, middleware |
| 8 | focusManager | derived per-ID stores, dynamic registration, ordered traversal |
| 9 | textBuffer | **batch (4-store atomic edits)**, **diamond resolution (content → 4 derived)**, undo/redo state restore |
| 10 | textEditor | **full graph (15+ stores, multiple diamonds)**, cross-pattern composition, complete cleanup |

---

## TEST STRATEGY

Each lego gets its own test file following existing conventions:

```
src/__tests__/utils/dirtyTracker.test.ts
src/__tests__/utils/validationPipeline.test.ts
src/__tests__/utils/asyncQueue.test.ts
src/__tests__/utils/timer.test.ts
src/__tests__/patterns/selection.test.ts
src/__tests__/patterns/commandBus.test.ts
src/__tests__/patterns/focusManager.test.ts
src/__tests__/patterns/textBuffer.test.ts
src/__tests__/patterns/textEditor.test.ts
src/__tests__/data/reactiveList.test.ts
```

### Key test categories per lego:
1. **Basic operations** — CRUD, state transitions
2. **Reactive correctness** — derived stores update, diamonds resolve once
3. **Batch atomicity** — multi-store updates are atomic
4. **Cleanup** — dispose() releases all subscriptions, timers, abort controllers
5. **Edge cases** — empty state, boundary values, rapid state changes
6. **Composition** — lego works when composed with others (integration)

### Integration tests (Phase 3):
- `textBuffer`: insert + undo + dirty check in single batch
- `textEditor`: type + validate + submit lifecycle
- `textEditor`: markdown commands update content + preview atomically

### Integration tests (Phase 4.5 hardening):
- `textBuffer`: undo/redo restores both content and cursor/selection snapshot
- `textEditor`: multiline command behavior (list/code block/heading) remains stable
- `textEditor`: equal/no-op writes preserve downstream derived stability (`canSubmit`, selection-derived views)
- `textEditor`: rejected `onSubmit` and async validator failures recover cleanly (`submitting` reset, error/valid coherence)

---

## REJECTED ALTERNATIVES

### "Just build the editor directly"
**Why not:** The editor without intermediate legos means baking selection, dirty tracking, validation, and command dispatch into one monolithic pattern. No reuse, no testing of composition, no benefit to other tools.

### "Put everything in utils/"
**Why not:** selection, commandBus, focusManager are reactive patterns (they create stores). utils/ is for pure strategies with zero reactive deps (except reactiveEviction). The boundary matters for import rules.

### "reactiveList as a wrapper over reactiveMap"
**Why not:** reactiveMap is key-value; positional operations (insert at index, move, swap) require shifting indices. A dedicated implementation is cleaner and avoids O(n) key remapping.

### "Skip commandBus, use plain functions"
**Why not:** Undo/redo integration, middleware, and typed dispatch are the value. Plain functions can't provide command history or macro recording.

### "Build markdown parsing into the library"
**Why not:** Markdown parsing is a rendering concern, not state management. The editor takes an optional `markdown` function — users bring their own parser (marked, markdown-it, etc). The library's job is the reactive graph, not string transformation.

---

## SUCCESS CRITERIA

1. **All 10 legos have passing tests** with the categories above
2. **textEditor composes without workarounds** — no manual subscriptions, no imperative glue
3. **examples/ demonstrate real usage** — copy-paste-able, not toy demos
4. **Existing patterns can adopt** — formField refactored to use dirtyTracker + validationPipeline with no behavior change
5. **Bundle size** — each lego is tree-shakeable; importing textEditor doesn't pull asyncQueue or timer
6. **Workable markdown editing loop** — cursor-aware undo/redo + predictable multiline command behavior + canonical UI adapter example

---

## FUTURE CONSUMERS (why these legos matter beyond the editor)

| Lego | Other tools it enables |
|------|----------------------|
| dirtyTracker | Settings panel, config editor, "unsaved changes" guard, deploy diff |
| validationPipeline | Data ingestion, schema validation, API input, CLI prompts |
| asyncQueue | Tool execution, file processing, batch API calls, LLM request queue |
| selection | Code editor, spreadsheet, timeline, image crop, drag-select |
| reactiveList | Chat messages, logs, playlists, tables, kanban columns |
| commandBus | Game input, CLI tools, macro recording, agent actions, accessibility |
| timer | Rate limit UI, session timeout, progress bars, benchmark display |
| focusManager | Tab panels, menus, accessibility, multi-editor layouts |
| textBuffer | Code editor, rich text, terminal emulator, note-taking |
| textEditor | AI chat input, orchestration config, documentation tool |
