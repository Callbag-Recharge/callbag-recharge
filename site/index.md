---
layout: home

hero:
  name: callbag-recharge
  text: State that flows.
  tagline: Reactive state management for TypeScript, built on the callbag protocol.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/Callbag-Recharge/callbag-recharge

features:
  - title: Tiny Core
    details: ~3.7 KB gzipped ESM, zero dependencies. ~376 bytes per store.
  - title: Glitch-Free
    details: Two-phase push guarantees diamond-safe derived values.
  - title: 60+ Operators
    details: Tree-shakeable extras — debounce, switchMap, retry, and more.
  - title: Fully Inspectable
    details: Every node in the reactive graph is observable via Inspector.
---

## Quick Example

```ts
import { state, derived, effect } from "callbag-recharge";

const count = state(0);
const doubled = derived([count], (c) => c * 2);

effect([doubled], (d) => {
  console.log("doubled:", d); // doubled: 0, doubled: 2, ...
});

count.set(1);
```
