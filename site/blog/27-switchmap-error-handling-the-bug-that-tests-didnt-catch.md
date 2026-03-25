---
title: "switchMap Error Handling: The Bug Tests Missed"
description: "A deep cut from production-like scenarios: how a switchMap error path escaped tests and what changed in cancellation and teardown semantics."
date: 2026-03-25
author: David Chen
outline: deep
---

# switchMap Error Handling: The Bug That Tests Didn't Catch

*Chronicle 27 - Arc 8: Engineering Deep Cuts*

We had tests for `switchMap`. We still shipped a bug.

The issue appeared only when rapid switching overlapped with inner error timing. Classic unit coverage looked fine. Real transition pressure broke assumptions.

## The failure mode

An inner source errored while a newer inner branch was taking ownership. Depending on timing, error handling could:

- surface on the wrong branch
- trigger duplicate teardown
- leave stale subscription state behind

The bug was not obvious in isolated "one switch then one error" tests.

## Why tests missed it

Our initial cases were too linear:

- deterministic ordering
- low branch churn
- short sequences

The missing ingredient was adversarial interleaving across switch, cancel, and error.

## What we changed

We fixed both logic and testing strategy:

- strengthened branch identity checks in error propagation
- enforced single teardown ownership per active inner
- added churn-heavy timing matrix tests for switch/cancel/error combinations

We also treated benchmark/regression harnesses as correctness probes, not just speed checks.

## Lesson

Operator correctness lives in transitions, not static behavior.

If your tests do not stress interleavings, they validate happy paths only. `switchMap` deserves hostile test inputs by default.
