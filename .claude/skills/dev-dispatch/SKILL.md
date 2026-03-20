---
name: dev-dispatch
description: "Full development workflow: implement feature/fix, self-test, adversarial code review, apply fixes, final checks, update docs. Use when user says 'dispatch', 'dev-dispatch', or provides a task with implementation context. Supports --light flag for bug fixes and small changes."
disable-model-invocation: true
argument-hint: "[--light] [task description or context]"
---

You are executing the **dev-dispatch** workflow for callbag-recharge.

The user's task/context is: $ARGUMENTS

### Mode detection

If `$ARGUMENTS` contains `--light`, this is **light mode**. Otherwise, this is **full mode**. Differences are noted inline per phase.

---

## Phase 1: Context Loading

Load these files as **reference context** — you don't need to internalize every section, focus on parts relevant to the task:
- `docs/architecture.md` — skim for orientation; focus on §1 Core Principles, §2 Import Rules, §3 Protocol, §9 Signal Handling. Deep-read other sections only if the task touches that area.
- `docs/test-guidance.md` — focus on the test checklist for the relevant operator tier and file organization. Skip patterns you won't use.

Also read any files the user referenced in $ARGUMENTS.

---

## Phase 2: Research & Planning

Gather all information needed to implement the task:
- Read relevant source files
- Understand existing patterns in the area you'll modify
- Check existing tests for the area
- Check `docs/roadmap.md` if this is a new feature

Do NOT start implementing yet.

---

## Phase 3: Architecture Discussion

### Full mode — HALT

**HALT and report to the user before implementing.** Present:

1. **Architecture assumptions** — any assumptions about how this fits into the existing system
2. **New patterns** — any new patterns you're introducing that don't exist in the codebase yet
3. **Options considered** — alternative approaches with pros/cons
4. **Recommendation** — your preferred approach and why

Prioritize (in order):
1. **Correctness** — does it follow rxjs/callbag semantics correctly?
2. **Completeness** — does it handle all edge cases?
3. **Consistency** — does it match existing library patterns?
4. **Simplicity** — is it the minimal solution?

Do NOT consider backward compatibility at this early stage.

**Wait for user approval before proceeding.**

### Light mode — Skip unless escalation needed

Proceed directly to Phase 4 **unless** your Phase 2 research reveals any of these:
- Changes to core primitives (`src/core/`) or signal semantics (DIRTY/DATA/RESOLVED/END)
- New patterns not present anywhere in the codebase
- Multiple viable approaches with non-obvious trade-offs

If any of these apply, escalate: HALT and present findings as in full mode.

---

## Phase 4: Implementation & Self-Test

After user approves (full mode) or after Phase 2 (light mode, no escalation):
1. Implement the changes
2. Create tests following `docs/test-guidance.md`:
   - Put tests in the most specific existing test file
   - Follow the checklist for the operator tier (tier 1 or tier 2)
   - Use `Inspector.observe()` for protocol-level assertions
3. Run tests: `pnpm test`
4. Fix any test failures

---

## Phase 5: Implementation Summary

Report what you modified:
- Files changed and why
- New exports added
- Test coverage summary
- Any deviations from the approved plan

---

## Phase 6: Adversarial Code Review

**Immediately after Phase 5** (no user approval needed), run an adversarial code review.

### 6a. Gather the diff

Run `git diff` to get all uncommitted changes. If there are also untracked files relevant to the task, include them.

### 6b. Launch parallel review subagents

Launch these as parallel Agent calls. Each receives the diff and the conversation context summary (what was implemented and why). No spec file — use chat context.

**Subagent 1: Blind Hunter** — Pure code review, no project context:
> You are a Blind Hunter code reviewer. Review this diff for: logic errors, off-by-one errors, race conditions, resource leaks, missing error handling, security issues, dead code, unreachable branches. Output each finding as: **title** | **severity** (critical/major/minor) | **location** (file:line) | **detail**. Be adversarial — assume bugs exist.

**Subagent 2: Edge Case Hunter** — Has project read access:
> You are an Edge Case Hunter. Review this diff in the context of a callbag-based reactive state library. Check for: unhandled signal combinations (DIRTY without DATA, DATA without DIRTY, double DIRTY), diamond resolution failures, completion/error propagation gaps, reconnect state leaks, bitmask overflow, missing RESOLVED signals when suppressing DATA, type 3 STATE forwarding violations, cleanup/teardown resource leaks. For each finding, provide: **title** | **trigger_condition** | **potential_consequence** | **location** | **suggested_guard**.

### 6c. Triage findings

Classify each finding into:
- **patch** — fixable code issue. Include the fix recommendation.
- **defer** — pre-existing issue, not caused by this change.
- **reject** — false positive or noise. Drop silently.

For each **patch** and **defer** finding, evaluate fix priority using these criteria (most to least important):
1. **rxjs/callbag precedent** — does our behavior match what other LLMs/developers expect from rxjs/callbag conventions?
2. **Semantic correctness** — does it follow the documented signal semantics in architecture.md?
3. **Completeness** — does it handle all edge cases?
4. **Consistency** — does it match patterns used elsewhere in this library?
5. **Level of effort** — how much work to fix?

### 6d. Present findings (HALT)

Present ALL patch and defer findings to the user. Treat both equally — defer findings are just as important. For each finding:
- The issue and its location
- **Recommended fix** with pros/cons
- Whether it affects architecture (flag these explicitly)
- Whether it needs user decision or can be auto-applied

Group findings:
1. **Needs Decision** — architecture-affecting or ambiguous fixes
2. **Auto-applicable** — clear fixes that follow existing patterns

**Wait for user decisions on group 1. Group 2 can be applied immediately if user approves the batch.**

---

## Phase 7: Apply Review Fixes

Apply the approved fixes from Phase 6.

---

## Phase 8: Final Checks

Run all of these and fix any failures (do NOT skip or ignore):

1. `pnpm test` — all tests must pass
2. `pnpm run lint:fix` — fix lint issues
3. `pnpm run build` — check for DTS/build problems

If a failure is related to an implementation design question, **HALT** and raise it to the user for discussion before fixing.

---

## Phase 9: Documentation Updates

If JSDoc or API docs need updating, read `docs/docs-guidance.md` now (deferred from Phase 1).

Update the relevant documentation:
- `docs/architecture.md` — if architecture changed
- JSDoc on exported functions (source of truth for API docs)
- Register in `scripts/gen-api-docs.mjs` REGISTRY if new exported function
- Run `pnpm run docs:gen` if JSDoc was added/changed
- `docs/test-guidance.md` — if new test patterns were established
- `CLAUDE.md` — only if fundamental workflow/commands changed
- Other context docs the user provided at dispatch time
