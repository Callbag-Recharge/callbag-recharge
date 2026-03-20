---
name: qa
description: "Adversarial code review, apply fixes, final checks (test/lint/build), and doc updates. Run after /dev-dispatch or any manual implementation. Use when user says 'qa', 'review', or 'code review'. Supports --skip-docs to skip documentation phase."
disable-model-invocation: true
argument-hint: "[--skip-docs] [optional context about what was implemented]"
---

You are executing the **qa** workflow for callbag-recharge.

Context from user: $ARGUMENTS

### Flag detection

If `$ARGUMENTS` contains `--skip-docs`, skip Phase 4 (Documentation Updates).

---

## Phase 1: Adversarial Code Review

### 1a. Gather the diff

Run `git diff` to get all uncommitted changes. If there are also untracked files relevant to the task, read and include them.

### 1b. Launch parallel review subagents

Launch these as parallel Agent calls. Each receives the diff and the context from $ARGUMENTS (what was implemented and why).

**Subagent 1: Blind Hunter** — Pure code review, no project context:
> You are a Blind Hunter code reviewer. Review this diff for: logic errors, off-by-one errors, race conditions, resource leaks, missing error handling, security issues, dead code, unreachable branches. Output each finding as: **title** | **severity** (critical/major/minor) | **location** (file:line) | **detail**. Be adversarial — assume bugs exist.

**Subagent 2: Edge Case Hunter** — Has project read access:
> You are an Edge Case Hunter. Review this diff in the context of a callbag-based reactive state library. Check for: unhandled signal combinations (DIRTY without DATA, DATA without DIRTY, double DIRTY), diamond resolution failures, completion/error propagation gaps, reconnect state leaks, bitmask overflow, missing RESOLVED signals when suppressing DATA, type 3 STATE forwarding violations, cleanup/teardown resource leaks. For each finding, provide: **title** | **trigger_condition** | **potential_consequence** | **location** | **suggested_guard**.

### 1c. Triage findings

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

### 1d. Present findings (HALT)

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

## Phase 2: Apply Review Fixes

Apply the approved fixes from Phase 1.

---

## Phase 3: Final Checks

Run all of these and fix any failures (do NOT skip or ignore):

1. `pnpm test` — all tests must pass
2. `pnpm run lint:fix` — fix lint issues
3. `pnpm run build` — check for DTS/build problems

If a failure is related to an implementation design question, **HALT** and raise it to the user for discussion before fixing.

---

## Phase 4: Documentation Updates

**Skip this phase if `--skip-docs` was passed.**

If JSDoc or API docs need updating, read `docs/docs-guidance.md` first.

Update the relevant documentation:
- `docs/architecture.md` — if architecture changed
- JSDoc on exported functions (source of truth for API docs)
- Register in `scripts/gen-api-docs.mjs` REGISTRY if new exported function
- Run `pnpm run docs:gen` if JSDoc was added/changed
- `docs/test-guidance.md` — if new test patterns were established
- `CLAUDE.md` — only if fundamental workflow/commands changed
- Other context docs the user provided at dispatch time
