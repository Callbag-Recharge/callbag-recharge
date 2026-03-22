# Raw

Pure callbag protocol primitives with zero core dependencies. This is the foundation layer — importable from any tier in the dependency hierarchy.

- `rawSubscribe` — callbag sink (subscribe to any callbag source)
- `fromTimer` — callbag source from setTimeout (delays without core deps)
- `firstValueFrom` — callbag → Promise bridge (the ONE place `new Promise` is allowed)
- `fromNodeCallback` — convert Node.js error-first callbacks to callbag sources

`raw/` never imports from `core/` or any other folder. Uses only the callbag protocol directly.
