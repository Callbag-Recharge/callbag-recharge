# Design Discussion Archive

This directory preserves the most important design discussions from the callbag-recharge project, extracted from Claude Code sessions between March 14–16, 2026.

## Quick Start

**New to the archive?** Start here:

1. Read **DESIGN-ARCHIVE-INDEX.md** — overview of all sessions and reading guides
2. Read **EXTRACTION-SUMMARY.md** — what was extracted and how to use it
3. Pick a specific session based on what interests you

## Archive Files

### Index and Reference
- **DESIGN-ARCHIVE-INDEX.md** — Master index, reading guides, key themes
- **EXTRACTION-SUMMARY.md** — What was extracted, statistics, how to use
- **README.md** — This file

### Core Design Sessions

1. **SESSION-8452282f-type3-breakthrough.md**
   - Type 3 Control Channel — foundational decision
   - When: March 14, 2026
   - Length: 140 lines
   - Best for: Understanding the unified callbag protocol

2. **SESSION-ce974b95-push-phase-memoization.md**
   - Push-Phase Memoization vs Pull-Phase Comparison
   - When: March 14, 2026
   - Length: 174 lines
   - Best for: How RESOLVED signal enables transitive optimization

3. **SESSION-47f1a07f-library-comparison.md**
   - Zustand, Jotai, SolidJS, Preact Signals Comparison
   - When: March 15, 2026
   - Length: 218 lines
   - Best for: Positioning against other state management libraries

4. **SESSION-4f72f2b0-no-default-dedup.md**
   - No-Default-Dedup Correctness Fix
   - When: March 15, 2026
   - Length: 244 lines
   - Best for: Why transparency matters in stream operators

5. **SESSION-ecc3a7e6-benchmark-regression.md**
   - Benchmark Regression Exposed 3 Operator Bugs
   - When: March 15, 2026
   - Length: 258 lines
   - Best for: How benchmarks catch design contract violations

6. **SESSION-8693d636-v4-output-slot.md**
   - Output Slot Optimization (null→fn→Set)
   - When: March 16, 2026
   - Length: 301 lines
   - Best for: Memory optimization via lazy allocation

7. **SESSION-2d2c2674-adopt-removal.md**
   - ADOPT Protocol Removal — Why It Was Unnecessary
   - When: March 16, 2026
   - Length: 202 lines
   - Best for: Design simplification through clarity

8. **SESSION-88e9bd81-v4-benchmarks.md**
   - V4 Benchmarks and the "Cost of Correctness"
   - When: March 16, 2026
   - Length: 252 lines
   - Best for: Performance story and trade-offs

## Reading Paths

### For Architecture Newcomers (4 sessions, ~1 hour)
1. 8452282f — Type 3 breakthrough (foundation)
2. ce974b95 — Push-phase memoization (how it works)
3. 8693d636 — Output slot (memory optimization)
4. 88e9bd81 — Benchmarks (validation)

### For Understanding Trade-offs (3 sessions, ~45 minutes)
1. 47f1a07f — Library comparison (design philosophy)
2. 4f72f2b0 — No-default-dedup (correctness vs convenience)
3. 88e9bd81 — Benchmarks (performance vs correctness)

### For Implementation (5 sessions, ~90 minutes)
1. 8452282f — Type 3 (what changed)
2. ecc3a7e6 — Regression (what breaks when done wrong)
3. 8693d636 — Output slot (memory optimization)
4. 2d2c2674 — ADOPT removal (simplification)
5. 88e9bd81 — Benchmarks (verification)

### For Design Review (3 sessions, ~1 hour)
Read the "Rejected Alternatives" sections:
1. 8452282f — 5 rejected alternatives
2. 47f1a07f — 5 rejected alternatives
3. ecc3a7e6 — 3 rejected alternatives

## Archive Format

Each session file contains:

```
---
SESSION: [id]
DATE: [date]
TOPIC: [topic]
---

## KEY DISCUSSION
[The actual reasoning chains, code examples, metrics]

## REJECTED ALTERNATIVES
[What was considered, why not]

## KEY INSIGHT
[The main takeaway]

## FILES CHANGED
[Implementation side effects]

---END SESSION---
```

This format preserves the thinking process, not just conclusions.

## Key Themes

### 1. Unification Under Callbag
Use callbag protocol cleanly. Type 3 for control signals, type 1 for data. No split channels.

### 2. Explicit Dependencies
Chosen over implicit tracking because it's clearer and scales better.

### 3. Correctness First, Performance Second
Trade memory for observability. Trade throughput for diamond resolution correctness.

### 4. Transparency in Operators
Extras are pass-through by default. Dedup is opt-in. No magic.

### 5. Design Iteration
Some decisions evolved during implementation. This is healthy — iterate towards clarity.

## Navigation Tips

- **Search for specific topics:** Each file has multiple headers and code blocks
- **Compare approaches:** Look at "Rejected Alternatives" to see what was considered
- **Understand rationale:** "Key Insight" sections summarize the main reasoning
- **See impact:** "Files Changed" shows what was implemented
- **Date order:** Sessions are in chronological order (can see evolution)

## Traceability

Each file references:
- Session ID (e.g., 8452282f)
- Date (e.g., March 14, 2026)
- Full session available at: `~/.claude/projects/-Users-davidchenallio-src-callbag-recharge/{session_id}.jsonl`

## Stats

| Metric | Value |
|--------|-------|
| Total sessions | 8 |
| Total lines | 1,967 |
| Date range | Mar 14–16, 2026 |
| Archive files | 11 |

## Next Steps

1. **Read DESIGN-ARCHIVE-INDEX.md** — Get oriented
2. **Pick a session** based on your interest
3. **Reference when needed** — Use "Rejected Alternatives" to avoid re-litigating decisions
4. **Contribute** — These decisions inform future architecture choices

---

**Archive created:** March 16, 2026  
**Archive status:** Complete and ready for use  
**Maintainer:** Claude Code (Haiku 4.5)
