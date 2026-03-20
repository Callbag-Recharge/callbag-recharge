# Extra

Basic operators, sources, and sinks. Each module implements a single reactive building block using core primitives and/or raw callbag protocol. Tree-shakeable via subpath exports.

**Tier 1** operators participate in diamond resolution (forward type 3 STATE signals). **Tier 2** operators are cycle boundaries built on `producer()`.

Imports from `core/` only. Intra-extra imports are allowed (e.g. `subscribe` used by tier 2 operators).
