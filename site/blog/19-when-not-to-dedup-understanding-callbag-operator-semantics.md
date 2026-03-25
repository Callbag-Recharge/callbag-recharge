---
title: "When Not to Dedup: Understanding Callbag Operator Semantics"
description: "A correctness decision: why callbag-recharge avoids default dedup in operators and preserves event semantics unless users opt into suppression."
date: 2026-03-25
author: David Chen
outline: deep
---

# When Not to Dedup: Understanding Callbag Operator Semantics

*Chronicle 19 - Arc 6: Correctness Stories*

Dedup sounds obviously good. Emit fewer values, do less work, everybody wins.

Until you remember that reactive systems are often about events, not just state snapshots.

## The decision

We chose **no default dedup** in core operator semantics.

If two consecutive emissions are equal by value, we still forward both unless the user explicitly opts into dedup behavior.

## Why this matters

Default dedup breaks legitimate flows:

- repeated "same value" triggers (retries, acknowledgements, ticks)
- idempotent commands that still carry timing meaning
- downstream systems that model "happened again," not "changed"

Suppressing equal values by default silently changes program meaning.

## What users can still do

Dedup is still available as an explicit operator choice. The key is opt-in.

That gives users control over trade-offs:

- reduce noise when modeling pure state
- preserve repeated events when modeling workflows

Library defaults should preserve information. User code can remove information intentionally.

## Testing implications

This decision forced us to strengthen tests around:

- repeated identical emissions
- mixed value/event pipelines
- operator composition where one stage dedups and others do not

Correctness became visible because we stopped hiding behavior behind convenience defaults.

## Takeaway

Reactive semantics should be conservative by default: forward what happened.

Dedup is an optimization and a modeling decision. That is exactly why it should never be implicit.
