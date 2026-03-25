---
title: "Lazy Tier 2: The switchMap Footgun We Had to Kill"
description: "How eager Tier 2 setup created subtle switchMap correctness and perf issues, and why v4 moved to lazy activation to avoid unnecessary churn."
date: 2026-03-25
author: David Chen
outline: deep
---

# Lazy Tier 2: The switchMap Footgun We Had to Kill

*Chronicle 16 - Arc 5: Architecture v4 - Performance Without Compromise*

`switchMap` is simple to describe and easy to get wrong in an engine.

Our old behavior eagerly activated Tier 2 work before it was actually needed. That looked harmless, but in `switchMap` chains it produced unnecessary subscribe/unsubscribe churn and exposed timing windows where stale inner streams could still do work.

v4 fixed this by making Tier 2 activation lazy.

## The original footgun

In the eager model, creating an inner path could trigger setup immediately, even if:

- the parent value was about to switch again
- no downstream sink was currently consuming that branch
- the branch would be disposed in the same tick

With rapid source updates, we paid repeated setup cost for branches that never produced durable output.

## What lazy Tier 2 means

Lazy Tier 2 shifts work to demand time:

- construct references early
- activate expensive path state only on first real consumption
- tear down promptly when the branch is superseded

This matches `switchMap` semantics: "latest wins" should mean old branches stop being expensive as soon as they are irrelevant.

## Why this is a correctness story too

This change is not only about speed. It tightens behavior:

- fewer opportunities for stale branch side effects
- clearer lifecycle boundaries for cancellation and reset
- easier reasoning about which branch is authoritative at any moment

When setup is lazy and scoped to active demand, there are fewer ambiguous states.

## Bench-level effect

The biggest wins appeared in workloads with:

- high-frequency source emissions
- expensive inner setup
- low output retention for superseded branches

Steady, low-churn graphs see smaller gains. That is expected. We optimized the failure mode, not the happy path.

## Takeaway

Reactive correctness often means refusing to do work early "just in case."

Lazy Tier 2 aligned `switchMap` implementation with user intent: do the minimum for the current branch, and stop paying for branches that already lost.
