# Design Discussion Extraction Summary

**Completed:** March 16, 2026
**Source:** Claude Code sessions from March 14–16, 2026
**Archive Location:** `/docs/archive/`

## Overview

Extracted 8 priority design sessions totaling **1,967 lines** of detailed architectural discussions. These are not summaries or conclusions — they preserve the actual reasoning chains, rejected alternatives, and key insights from pivotal design decisions.

## Sessions Extracted

### 1. SESSION-8452282f-type3-breakthrough.md (140 lines)
**Date:** March 14, 2026
**Topic:** Type 3 Control Channel Breakthrough

The pivotal moment when the team recognized that callbag's type 3 could be used as a dedicated control channel for state signals (DIRTY, RESOLVED), allowing type 1 (DATA) to carry only real values. This led to two-phase push architecture and became the foundation for v3.

**Contains:**
- Core problem with v2 dual-channel design
- The breakthrough insight and three problems it solved
- Why two-phase push is fundamentally better than pull-phase memoization
- Why derived eagerly connects (STANDALONE mode)
- Producer as universal base primitive
- 5 rejected alternatives with reasoning
- Key insight on unified callbag protocol

### 2. SESSION-ce974b95-push-phase-memoization.md (174 lines)
**Date:** March 14, 2026
**Topic:** Push-Phase Memoization Debate

Deep dive into the memoization semantics when derived stores have an `equals` option. Contrasts two approaches: pull-phase comparison (v2) vs push-phase RESOLVED signal (v3).

**Contains:**
- Pull-phase model and its problems
- Push-phase memoization and advantages
- Why push-phase cascades (transitive skipping)
- Why equals should be opt-in, not default
- RESOLVED as semantic signal, not side effect
- 4 rejected alternatives
- Interaction with batch() and correctness verification

### 3. SESSION-47f1a07f-library-comparison.md (218 lines)
**Date:** March 15, 2026
**Topic:** Library Comparison (Zustand, Jotai, SolidJS, Preact Signals)

Comparative research establishing how Recharge's mental model maps to other libraries and why certain design choices were made.

**Contains:**
- Zustand (Flux-lite) analysis
- Jotai (implicit tracking) analysis and why explicit deps are better
- SolidJS (two-phase execution) and callbag differences
- Preact Signals (memory-efficient) and composability trade-off
- Critical implicit vs explicit tracking debate
- "Three Promises" philosophy (trust, harmony, action)
- Performance positioning and why Inspector adds value
- 5 rejected alternatives
- Key insight on explicit deps enabling reasoning about the graph

### 4. SESSION-4f72f2b0-no-default-dedup.md (244 lines)
**Date:** March 15, 2026
**Topic:** No-Default-Dedup Decision

Identified and fixed a correctness bug: `subscribe()` and tier 2 operators were wrongly deduplicating emissions, violating RxJS/callbag semantics.

**Contains:**
- The bug (subscribe deduping on Object.is)
- Why it breaks downstream (cascading bug to tier 2 operators)
- Subtlety: state.equals vs subscribe transparency
- The fix strategy (two-part)
- Broader principle: transparency vs optimization
- Tier 1 vs tier 2 operator semantics
- State's dedup role vs operator transparency
- 4 rejected alternatives
- Key insight: transparency is foundation of composability

### 5. SESSION-ecc3a7e6-benchmark-regression.md (258 lines)
**Date:** March 15, 2026
**Topic:** Benchmark Regression Exposed 3 Operator Bugs

Re-ran benchmarks and found 5–8% regression. Investigation uncovered three design contract violations:

**Contains:**
- The regression (4–8% slowdown across all benchmarks)
- Bug #1: operator.complete()/error() skipped resetOnTeardown
- Bug #2: producer._checkAndEmit() ignored autoDirty: false
- Bug #3: operator didn't forward unknown type 3 signals
- Investigation process (systematic debugging)
- Why each bug violated design principles
- Performance impact of fixes
- Benchmarks as design validation tools
- 3 rejected alternatives
- Key insight: regressions indicate contract violations, not just performance

### 6. SESSION-8693d636-v4-output-slot.md (301 lines)
**Date:** March 16, 2026
**Topic:** V4 Output Slot Optimization

Implemented the lazy output slot model replacing `_sinks: Set` with `_output: null | fn | Set`.

**Contains:**
- The problem: Set allocation waste (200 bytes per node)
- The solution: lazy union type (null for disconnected, fn for single, Set for multi)
- Memory impact (~90% savings for typical graphs)
- Type challenge and TypeScript signature
- STANDALONE and derived handling
- Transition logic (state machine for output slot)
- Testing the transitions
- Why ADOPT protocol becomes unnecessary
- Performance impact (15% faster store creation)
- Scaling characteristics (O(n) in subscribers, O(1) in deps)
- 4 rejected alternatives
- Key insight: lazy allocation is powerful optimization pattern

### 7. SESSION-2d2c2674-adopt-removal.md (202 lines)
**Date:** March 16, 2026
**Topic:** ADOPT Protocol Removal

Recognized that output slot model makes REQUEST_ADOPT/GRANT_ADOPT unnecessary.

**Contains:**
- Original problem ADOPT was meant to solve
- Why ADOPT was overengineered
- Code diff showing clean removal
- Philosophical insight: protocols only for semantically important transitions
- Contrast with DIRTY/RESOLVED (semantically important)
- Testing impact (deleted v4-adopt.test.ts)
- Code review process that identified the issue
- Broader lesson on refactoring towards clarity
- Performance impact (zero; just complexity reduction)
- 3 rejected alternatives
- Key insight: separating dep connections from output dispatch makes ADOPT unnecessary

### 8. SESSION-88e9bd81-v4-benchmarks.md (252 lines)
**Date:** March 16, 2026
**Topic:** V4 Benchmarks and "Cost of Correctness"

Comprehensive benchmark suite comparing Recharge to Preact Signals, SolidJS, RxJS.

**Contains:**
- Full benchmark results (read, write, computed, diamond)
- Why Recharge wins on raw state read (+48% vs Preact)
- Why Recharge wins on computed read with memoization (+33%)
- Memory trade-off analysis (~6x vs Preact, but includes Inspector)
- Four major sources of memory overhead (Inspector, STANDALONE, classes, type 3)
- Performance on specific patterns (linear, fan-out, many-dep)
- "Cost of correctness" narrative (four major trades and verdict on each)
- Scaling characteristics (linear in store creation, O(n) in subscribers, O(1) in deps)
- Comparison to benchmark goals (exceeded on 4/4 metrics)
- Future optimization opportunities identified but not pursued
- 4 rejected alternatives
- Key insight: performance is table stakes, but correctness is non-negotiable

### 9. DESIGN-ARCHIVE-INDEX.md (178 lines)

Master index with:
- Overview of all 8 core sessions
- Compressed summary of each
- Reading guide for different audiences
- Key themes (unification, explicit deps, correctness first, transparency)
- Archive format explanation
- How to navigate for specific purposes

---

## Key Statistics

| Metric | Value |
|--------|-------|
| Sessions extracted | 8 priority sessions |
| Total lines | 1,967 lines |
| Average per session | 245 lines |
| Archive files | 9 files (.md) |
| Date range | March 14–16, 2026 |
| Topics covered | Architecture, protocols, performance, libraries, debugging |

---

## Content Quality Notes

### What's Preserved
- **Actual reasoning chains** — not just conclusions
- **Rejected alternatives** — with reasoning for each rejection
- **Code examples** — showing the difference between approaches
- **Specific metrics** — benchmarks, memory numbers, performance results
- **Implementation details** — which functions changed, why
- **Design contracts** — explicit principles being followed or violated
- **Interaction patterns** — how features compose (e.g., batch + RESOLVED)

### What's Distilled
- Verbose exploration (kept highlights)
- Dead-end debugging (kept key insights only)
- Iteration history (consolidated to final decision + rejected paths)
- Multiple similar conversations (synthesized into single narrative)

### Format Consistency
Each session file follows:
1. Header (SESSION, DATE, TOPIC)
2. KEY DISCUSSION (the actual reasoning)
3. REJECTED ALTERNATIVES (what was considered, why not)
4. KEY INSIGHT (the main takeaway)
5. FILES CHANGED (what was implemented)
6. END SESSION marker

---

## How to Use This Archive

### For New Contributors
1. Read DESIGN-ARCHIVE-INDEX.md first
2. Follow "For architecture newcomers" reading guide
3. Deep-dive into specific topics as needed

### For Design Review
- Reference specific sessions when discussing trade-offs
- Use "rejected alternatives" to avoid re-litigating old decisions
- Point to "key insight" sections for high-level understanding

### For Implementation
- "FILES CHANGED" section shows what was touched
- "Design contracts" sections show what the code must satisfy
- "Rejected alternatives" show pitfalls to avoid

### For Architecture Evolution
- "Future optimization opportunities" sections note possibilities
- "Scaling characteristics" show where bottlenecks might appear
- Sessions show how to incrementally refine designs

---

## Traceability

Each archive file is linked to its source session through:
- Session ID (e.g., 8452282f)
- Creation date (March 14, 2026)
- Session can be found at: `~/.claude/projects/-Users-davidchenallio-src-callbag-recharge/{session_id}.jsonl`

Git commits related to each session can be found via:
```bash
git log --all --grep="8452282f" # search by session ID
git log --since="2026-03-14" --until="2026-03-15" # search by date
```

---

## Archive Completeness

### Sessions Extracted (Priority List)
- ✅ 8452282f (Mar 14) — Type 3 breakthrough
- ✅ ce974b95 (Mar 14) — Push-phase memoization
- ✅ 47f1a07f (Mar 15) — Library comparison
- ✅ 4f72f2b0 (Mar 15) — No-default-dedup
- ✅ ecc3a7e6 (Mar 15) — Benchmark regression bugs
- ✅ 8693d636 (Mar 16) — V4 output slot
- ✅ 2d2c2674 (Mar 16) — ADOPT removal
- ✅ 88e9bd81 (Mar 16) — V4 benchmarks

### Sessions Noted but Not Extracted (Secondary)
- 269923a2, 05b247c1, 3844edd6, 69f77860, 660b129d, 344b81ab, 476164b4, f23a9e35, ac72cc83, 4cb2d590, b1e8b5e5
- These sessions are captured in the "Additional Sessions" section of the index
- Full extraction available if needed

---

## Next Steps

1. **Review and verify** — Someone should read these for accuracy/completeness
2. **Archive in source control** — Consider `git add docs/archive/`, commit as "Archive design decisions"
3. **Update README** — Link from main docs to this archive
4. **Blog candidates** — Several sessions are blog post material:
   - Type 3 control channel (8452282f)
   - Library comparison (47f1a07f)
   - No-default-dedup correctness (4f72f2b0)
5. **Merge into docs** — Consider incorporating key insights into main architecture docs

---

**Archive created:** March 16, 2026  
**Archive status:** Complete and ready for review
