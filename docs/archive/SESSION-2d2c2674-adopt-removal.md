---
SESSION: 2d2c2674
DATE: March 16, 2026
TOPIC: ADOPT Protocol Removal — Why It Was Unnecessary When You Understand Output Slots
---

## KEY DISCUSSION

This session reviewed the ADOPT protocol (REQUEST_ADOPT/GRANT_ADOPT) that was designed in earlier versions to handle derived node output slot handoff. Upon implementing the v4 output slot model, the team realized **ADOPT was solving a non-problem** and removed it entirely.

### The Original Problem ADOPT Was Meant to Solve

**Context:** Derived nodes eagerly connect to deps (STANDALONE mode) and maintain an internal "output slot" — conceptually, an internal sink that keeps the derived's cached value current.

**Scenario:** A derived node D depends on A. D is created with no external subscribers:
```
A.emit(1) → D receives it → D._cachedValue = 1
          → D.get() returns 1 (current)
```

Now an external subscriber S arrives:
```
A.emit(2) → D receives it → D._cachedValue = 2
          → D forwards to S
```

**The Question:** How does D know when to switch from "maintaining my own cache" to "forwarding to external S"?

**ADOPT Protocol Attempt:**
- When external subscriber S arrives at D, D sends REQUEST_ADOPT upstream
- Upstream acknowledges: GRANT_ADOPT
- D's internal handler is replaced with S's sink
- No more double-subscription

### Why ADOPT Was Overengineered

The team realized the output slot model (null → fn → Set) handles this elegantly **without any protocol:**

```ts
// Derived starts in STANDALONE: _output = null
const d = derived([a], fn);
// - D connects to A directly (closure-based)
// - A has no external subscribers yet
// - D._output = null (no external dispatch needed)
// - D._cachedValue is maintained by D's handler closure

// External subscriber S arrives
const unsub = subscribe(d, (v) => console.log(v));
// - D._output = S (function reference, SINGLE mode)
// - Now D's dispatch is active: all A's changes reach S
// - D's handler closure still runs (keeping _cachedValue current)
// - No protocol needed

// A emits a value
a.set(42);
// - A's sinks (D's connection) receive it
// - D's handler runs: _cachedValue = 42, _status = SETTLED
// - D dispatches: _output(DATA, 42) → calls S
// - S receives 42
```

**Key Insight:** The handler closure runs regardless. The output slot just controls where dispatch goes. No handoff is needed because:
1. D's internal tap (the handler) is always active via closure
2. The output slot is just a dispatch target (null/fn/Set)
3. Changing the dispatch target doesn't affect the tap

### The Code Diff

Removing ADOPT was clean:

```ts
// REMOVED from protocol.ts
const REQUEST_ADOPT = Symbol("REQUEST_ADOPT");
const GRANT_ADOPT = Symbol("GRANT_ADOPT");

// REMOVED from derived.ts
// No more:
// - Checking for REQUEST_ADOPT signals
// - Sending GRANT_ADOPT
// - Complex state machine for adoption handoff

// Simplified derived.ts
// - Just maintain _output as null → fn → Set
// - Handler closure always runs
// - Dispatch target changes seamlessly
```

### Why It Was Easy to Miss

The ADOPT protocol was designed when the team was thinking about the output slot differently:

**Old Model (implied):**
- Derived has an "internal terminator" (conceptually)
- To add external subscriber, need to "hand over" the terminator
- Requires protocol to coordinate

**Correct Model (v4):**
- Derived has a handler closure (always active)
- Output slot is just a dispatch point (mechanical)
- No "handoff" needed; dispatch target just changes

Once the team implemented output slots cleanly, ADOPT became obvious redundancy.

### The Philosophical Insight

This session crystallized a design principle:

**Don't add protocols for state transitions unless the state transition is semantically important.**

ADOPT was added because:
- "Derived needs to know when external subscriber arrives"
- "We need to hand off responsibility"
- "This is a state change, so we need a signal"

But the actual state change (output slot goes from null to fn) is mechanical and doesn't require upstream notification. The handler closure is always there.

**Contrast:** DIRTY/RESOLVED are semantically important signals:
- DIRTY means "my value is uncertain"
- RESOLVED means "I was uncertain, but my value is the same"
- These inform downstream about the state of computation

ADOPT was just a state transition; not semantically important.

### Testing Impact

Removing ADOPT simplified the test suite:

```ts
// REMOVED tests (no longer needed)
src/__tests__/core/v4-adopt.test.ts
// Tests like:
// - "derived receives REQUEST_ADOPT"
// - "derived sends GRANT_ADOPT"
// - "multiple subscribers coordinate adoption"

// These tests were verifying a protocol that wasn't semantically necessary
// The output slot tests (v4-output-slot.test.ts) cover the real behavior
```

### Code Review Process

The removal was identified during code review of the v4 implementation:

1. Reviewer noticed REQUEST_ADOPT/GRANT_ADOPT in protocol.ts
2. Asked: "Why do we need ADOPT if output slot is mechanical?"
3. Traced through derived.ts to understand the flow
4. Realized: handler closure is always active, output slot is just dispatch target
5. Confirmed: removing ADOPT doesn't break any tests
6. Conclusion: Delete ADOPT, simplify the design

### The Broader Lesson

This is an example of **refactoring towards clarity.** Sometimes good design reveals that earlier designs were solving the wrong problem:

- Earlier: "How do we coordinate when derived switches from internal to external?"
- ADOPT: Protocol to handle this
- Later: "Actually, internal and external dispatch are independent concerns"
- v4 output slot: Makes it obvious that no protocol is needed

### Performance Impact of Removal

Removing ADOPT had no measurable performance impact (it was rarely sent/handled). The benefit was **simplicity:**

- 2 fewer symbols in protocol.ts
- ~20 lines of complex state machine in derived.ts removed
- Clearer conceptual model: "output slot is mechanical, not protocol-driven"

## REJECTED ALTERNATIVES

### 1. Keep ADOPT for "future extensibility"
- **Why rejected:** Cargo cult code — if no current use case, don't add complexity
- **Removed:** Delete dead code

### 2. Rename ADOPT to something clearer (e.g., OUTPUT_SLOT_TRANSITION)
- **Why rejected:** Renaming doesn't fix the core issue — the protocol isn't needed
- **Removed:** Entire protocol

### 3. Make ADOPT optional (libraries can choose to use it)
- **Why rejected:** Optional protocols confuse implementers
- **Removed:** Keep protocol simple

## KEY INSIGHT

**Output slots make ADOPT unnecessary.** The key realization is separating two concerns:

1. **Dep connections (handler closure)** — always active, driven by internal need to maintain _cachedValue
2. **Output dispatch (output slot)** — mechanical redirection to current subscriber(s)

These are independent. Changing the output slot doesn't affect the handler. No protocol needed.

This is a lesson in **iterative refinement:** sometimes an earlier design (ADOPT protocol) makes sense when the mental model is fuzzy. As the model clarifies (output slot as lazy allocation), the design simplifies (ADOPT becomes unnecessary).

## FILES CHANGED

- `src/core/protocol.ts` — Removed REQUEST_ADOPT, GRANT_ADOPT symbols
- `src/core/derived.ts` — Removed ADOPT handling logic
- `src/__tests__/core/v4-adopt.test.ts` — Deleted (tests for a protocol that no longer exists)
- `src/core/derived.ts`, `src/core/operator.ts` — Simplified output slot handling
- `CLAUDE.md` — Updated to reflect simplified architecture (no ADOPT)
- `docs/architecture-v4.md` — Updated §6 (output slot) to explain why ADOPT isn't needed

---END SESSION---
