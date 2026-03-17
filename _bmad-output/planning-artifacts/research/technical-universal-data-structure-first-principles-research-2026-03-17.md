---
stepsCompleted: [1, 2, 3, 4, 5]
inputDocuments: ['docs/state-management.md']
workflowType: 'research'
lastStep: 5
research_type: 'technical'
research_topic: 'Universal Data Structure from First Principles — Nodes for the Reactive Graph'
research_goals: 'Design the optimal data structure for modern demands (web, Web3, AI, infrastructure) that pairs with callbag-recharge as the communication/edge layer'
user_name: 'Callbag Recharge'
date: '2026-03-17'
web_research_enabled: true
source_verification: true
---

# Research Report: Technical

**Date:** 2026-03-17
**Author:** Callbag Recharge
**Research Type:** Technical

---

## Research Overview

This research applies first-principles thinking (从第一性原理出发) to answer: **if we were designing data structures from scratch for today's demands — web, Web3, AI, and infrastructure — what would they look like?** And specifically: if callbag-recharge handles the *edges* of a reactive graph (communication, data flow, operators), what should the *nodes* (data containers) look like?

The research was conducted across four parallel dimensions: (1) audit of 30+ existing data structures/formats, (2) demand landscape across 6 domains, (3) security and performance deep-dive, and (4) first-principles node design synthesis. Key findings: every domain converges on 5 universal properties — reactive by default, streaming-native, lazy with push notification, explicit dependencies, and self-describing metadata. The proposed UniversalNode design addresses all of these while pairing cleanly with callbag-recharge's existing architecture.

See the full executive summary in the Research Synthesis section at the end of this document.

---

## Technical Research Scope Confirmation

**Research Topic:** Universal Data Structure from First Principles — Nodes for the Reactive Graph
**Research Goals:** Design the optimal data structure for modern demands (web, Web3, AI, infrastructure) that pairs with callbag-recharge as the communication/edge layer

**Technical Research Scope:**

- Architecture Analysis — design patterns, frameworks, system architecture
- Implementation Approaches — development methodologies, coding patterns
- Technology Stack — languages, frameworks, tools, platforms
- Integration Patterns — APIs, protocols, interoperability
- Performance Considerations — scalability, optimization, patterns

**Research Methodology:**

- First-principles reasoning anchored to real-world demands
- Comprehensive audit of 30+ existing data structures and formats
- Cross-domain analysis (web, Web3, AI, infrastructure, IoT, data engineering)
- Security and performance deep-dive with concrete technical analysis
- Synthesis into a concrete design proposal with TypeScript interface

**Scope Confirmed:** 2026-03-17

---

## Technology Stack Analysis: Existing Data Structures Audit

### 1. Serialization Formats

#### JSON (JavaScript Object Notation)
- **Where used:** Universal in web APIs, config files, NoSQL documents, logging. The lingua franca of the web.
- **Design assumptions:** Human readability > compactness. Schema-free. Everything is string/number/boolean/null/array/object. UTF-8 text.
- **Strengths:** Universal parser support, human-readable, self-describing, zero-setup, native to JavaScript.
- **Pain points:** No binary data (base64 = 33% overhead), no int64 (IEEE 754 double loses precision), no date/time type, no comments, verbose (repeated keys), slow parsing (text scanning), no schema validation built-in, no streaming parse in spec.
- **Second-chance wishes:** Binary data support, 64-bit integers, canonical serialization for hashing (RFC 8785 exists but rare), streaming/incremental parsing as first-class.
- **Security:** None inherent. Prototype pollution (`__proto__`), ReDoS in validators, expansion attacks in recursive structures.

#### Protocol Buffers (protobuf)
- **Where used:** gRPC, Google internal, Kubernetes API, microservices.
- **Design assumptions:** Schema-first, compact wire format, forward/backward compat via field numbers, code generation.
- **Strengths:** Extremely compact (varint, no field names on wire), strong compat story, fast ser/deser, well-defined type system.
- **Pain points:** Requires codegen step, not human-readable, not self-describing (need `.proto` to decode), proto3 lost field presence tracking, no union types beyond `oneof`, no field-level encryption.
- **Second-chance wishes:** Field presence tracking (partially restored), algebraic data types, self-describing wire option, richer types (datetime, decimal), zero-copy deser.
- **Security:** Transport-level only. Deeply nested messages can trigger excessive allocation.

#### CBOR (Concise Binary Object Representation)
- **Where used:** WebAuthn/FIDO2, COSE signing/encryption, IoT (CoAP), IPLD, decentralized identity.
- **Design assumptions:** IETF-standard superset of JSON's data model, designed for constrained environments.
- **Strengths:** IETF standard, native binary/bignum/datetime/URI types via tags, deterministic encoding mode, **COSE provides standardized signing/encryption at the data level** (unique among formats), indefinite-length items for streaming.
- **Pain points:** Less adoption in mainstream web, multiple encoding modes create interop confusion, weaker tooling than JSON.
- **Security:** **Strong — COSE (RFC 9052) provides signing, encryption, and MAC at format level.** Used in WebAuthn, EU Digital COVID Certificates, W3C Verifiable Credentials.

#### FlatBuffers / Cap'n Proto (Zero-Copy Formats)
- **FlatBuffers:** True zero-copy — read fields directly from byte buffer. Random access without full deser. Schema required.
- **Cap'n Proto:** Wire format IS memory format. No encode/decode step. **First-class capability-based RPC** (object capabilities, not just methods). Time-travel RPC (pipeline calls).
- **Common pain points:** Schema required at both ends, read-only access (copy-on-write for mutations), alignment padding wastes space, difficult debugging.
- **Cap'n Proto's unique insight:** Capabilities as first-class citizens in the serialization format. This is directly relevant to our node design.

#### Apache Avro
- **Where used:** Kafka (Confluent Schema Registry), Spark, data pipelines.
- **Strengths:** Excellent schema evolution (full/transitive compatibility), schema accompanies data, native union types.
- **Pain points:** Not self-describing on wire without schema, complex schema resolution, weak non-JVM support.

### 2. Columnar / Analytical Formats

#### Apache Arrow
- **Where used:** Pandas, DuckDB, DataFusion, Polars, Spark. The universal analytical interchange format.
- **Strengths:** Zero-copy IPC between processes, SIMD-friendly layout, language-agnostic C data interface, Arrow Flight protocol.
- **Pain points:** Not suitable for point lookups, large overhead for small datasets, no in-place mutation, nested types complex, no built-in persistence format.
- **Security:** None. Shared memory = any process can read all data. No column-level encryption.

#### Apache Parquet
- **Where used:** Standard for data lake storage (S3, HDFS). Spark, Hive, Presto, BigQuery, Delta Lake, Iceberg.
- **Strengths:** Excellent compression (dictionary, RLE, delta, ZSTD per column), column pruning, row group statistics for predicate pushdown, nested data (Dremel encoding).
- **Pain points:** Write amplification for updates (must rewrite row groups), footer-based metadata (bad for streaming), complex nested encoding, small file problem, no row-level deletes.
- **Second-chance wishes:** Row-level updates/deletes (Delta Lake/Iceberg/Hudi exist to paper over this), simpler nested encoding, header-based metadata for streaming.

#### Lance (Modern ML-Optimized Format)
- **Strengths:** Fast random access (critical for training data), versioning, good for vector search + structured data.
- **Status:** Very new, small ecosystem, but shows what's possible when you design for modern ML workloads.

### 3. Content-Addressed Structures

#### IPLD / IPFS Merkle-DAG
- **Where used:** IPFS, Filecoin, libp2p, decentralized applications.
- **Design assumptions:** Content addressing (CID = hash of content) provides immutability and verifiability. Links between nodes are CIDs. Data model is superset of JSON with bytes and links.
- **Strengths:** Immutable by construction, built-in integrity verification, free deduplication, transport agnostic, multiple codecs (dag-cbor, dag-json), composable.
- **Pain points:** Performance penalty for hashing everything, no mutable references in base layer (need IPNS), chunking strategies unclear, DAG traversal over network is slow, garbage collection is hard, IPLD selectors are under-specified.
- **Second-chance wishes:** Efficient mutable structures on top of content addressing, faster link resolution, simpler query language, partial verification.
- **Security:** Integrity built-in. No confidentiality (public by default). No access control at format level. No revocation.

#### Git Objects
- **Strengths:** Proven at enormous scale, excellent dedup, Merkle tree integrity, packfile space efficiency.
- **Pain points:** SHA-1 broken (SHA-256 transition slow), large binaries handled poorly, no object-level encryption or access control.
- **Key insight:** Git's model of "immutable objects + mutable refs" is exactly the pattern we need: `UniversalNode` (immutable snapshot) + `Store` (mutable reactive wrapper).

### 4. Conflict-Free Structures (CRDTs)

#### Automerge, Yjs, Diamond Types
- **Where used:** Collaborative editing, offline-first apps, distributed databases.
- **Strengths:** No central server for conflict resolution, offline-first, guaranteed convergence, rich type support.
- **Pain points:**
  - Metadata overhead is massive (operation IDs, vector clocks, tombstones — 100x for a simple counter)
  - "Conflict-free" ≠ "intention-preserving" — merges can surprise
  - Tombstones persist forever (GC unsolved in decentralized settings)
  - Schema evolution largely unaddressed
  - Undo/redo surprisingly complex
  - Access control conflicts with decentralized model
- **Second-chance wishes:** Bounded metadata growth, richer merge semantics (app-defined), schema evolution, smaller sync format, access control that works with CRDTs.
- **Security:** Fundamentally challenging — assumes all participants trusted. Byzantine participants can corrupt state.

### 5. Graph / Linked Structures

#### RDF / JSON-LD / Property Graphs
- **RDF:** Global URIs, SPARQL queries. Powerful but verbose and slow. Semantic Web vision largely failed.
- **JSON-LD:** JSON-compatible RDF. Good for web-native linked data (schema.org, Verifiable Credentials, ActivityPub). Pain: context resolution is slow/fragile, spec is complex.
- **Property Graphs (Neo4j):** Intuitive nodes+edges with properties. Cypher query language. Pain: scaling is hard (graph partitioning is NP-hard), no standard query language until GQL.

### 6. Event-Based Structures

#### Event Sourcing Logs
- **Strengths:** Complete audit trail, time travel, enables CQRS, events replay through new projections.
- **Pain points:** Event schema evolution is extremely hard, eventual consistency, snapshotting adds complexity, GDPR conflicts with immutable events (crypto-shredding workaround).
- **Key insight:** The `prev` chain in our proposed node design IS an event log of snapshots.

#### Kafka Records / CloudEvents
- **Kafka:** High throughput (millions/sec), durable, partitioned. Pain: operational complexity, no native query, consumer rebalancing pauses.
- **CloudEvents:** Standard envelope for events (CNCF). Thin adoption outside serverless/CNCF.

### 7. Embedded Structures

#### SQLite
- **The most-deployed database engine in the world.** Zero config, single file, full SQL, ACID, WAL mode.
- **Pain points:** Single writer, no built-in replication (Litestream/Turso address this), type affinity confusion.
- **Trend:** SQLite-as-application-file-format is gaining traction. Turso/libsql exploring multi-writer.

#### DuckDB / LevelDB / RocksDB
- **DuckDB:** "SQLite for analytics" — columnar, vectorized, reads Parquet/CSV directly, embedded.
- **RocksDB:** Embedded LSM-tree KV store used in CockroachDB, TiKV, blockchain nodes. Fast writes, tunable, but complex.

### 8. AI-Specific Structures

#### Embeddings / Vectors
- **What:** Dense float vectors (384-4096 dims) for semantic similarity.
- **Pain points:** No interpretability, model upgrades require re-embedding entire corpus, metadata filtering + vector search hard to co-optimize, memory-intensive (1M × 1536 dims × 4 bytes = 6GB), stale embeddings, no standard format.
- **Second-chance wishes:** Standard format with metadata, model-version-aware stores, sparse-dense hybrid, streaming/incremental updates.

#### Tensor Formats (safetensors)
- **NumPy pickle:** **Allows arbitrary code execution** — exploited in supply chain attacks. safetensors was created specifically to fix this (no code execution, bounds-checked).
- **Cautionary tale:** Any format that embeds executable content is a security risk.

#### Context Window Structures
- **Pain points:** No standard format across LLM providers, token counting is model-specific, no built-in priority/importance, no caching/dedup across calls, no streaming format for incremental context.
- **Second-chance wishes:** Standard context format, semantic compression, reference-based context (point to previous conversations), priority metadata, built-in token budget management.

### 9. Capability / Security Structures

#### UCAN (User Controlled Authorization Networks)
- **Where used:** Fission, WNFS, some IPFS applications.
- **How:** DID-based delegation chains in signed JWTs. Offline-first, attenuated delegation, time-bounded.
- **Pain points:** Revocation is the hard problem (defeats offline-first), token chains grow large, spec still evolving.
- **Key insight:** Closest existing mechanism to "authorization embedded in data."

#### Macaroons
- **How:** HMAC-chained tokens with caveats. Anyone can attenuate by adding restrictions.
- **Strengths:** Elegant, compact, third-party caveats enable contextual auth.
- **Limitations:** Requires online verification (HMAC needs issuer), limited adoption.

### Cross-Cutting Synthesis from Audit

| Theme | Finding |
|---|---|
| **Schema evolution** | Universally painful. Protobuf field numbers, Avro reader/writer schemas, event upcasting, CRDT type changes — everyone struggles. |
| **Content addressing** | Provides immutability + integrity for free (IPLD, Git, Nix). But mutability is what apps need. The bridge is underexplored. |
| **Data-level security** | Rare and desired. Only CBOR/COSE and capability tokens (UCAN, Macaroons) provide this. |
| **Zero-copy / lazy access** | Matters everywhere (FlatBuffers, Arrow, safetensors, SQLite mmap). Eager deserialization is wasteful. |
| **CRDTs** | Solve the hardest problem (merge) but pay enormous metadata costs. Need merge with bounded overhead. |
| **Deterministic serialization** | Essential for hashing/signing/caching but most formats don't guarantee it. CBOR and Cap'n Proto are exceptions. |
| **GC / lifecycle** | Hard everywhere — IPFS, CRDTs, Nix, event sourcing all struggle with when to discard data. |
| **Partial reads** | Increasingly important. Reading everything when you need one field is wasteful. |
| **No format handles structured data + binary + vectors + capabilities.** | This is the gap. |

---

## Integration Patterns Analysis: Demand Landscape

### 1. Web (SPA / SSR / Islands)

**Data types:** Component state (ephemeral), form state (nested, validated), server state (loading/stale/error), URL state (string-serialized), auth/session, derived/computed.

**Must-have properties:**
- **Fine-grained reactivity** — Re-rendering entire subtrees for one field change is the #1 perf problem
- **Serializable snapshots** — SSR hydration requires wire-safe state
- **Structural sharing** — Immutable updates need sharing to avoid cloning trees
- **Lazy/deferred evaluation** — Islands architecture demands lazy computation
- **Batched updates** — N state changes must coalesce into 1 render
- **Equality checking** — Avoiding spurious re-renders

**Pain points:**
1. Server/client state impedance mismatch (TanStack Query cache is a parallel state system)
2. Hydration mismatch errors (data structures don't distinguish server-known from client-known)
3. Framework lock-in of state logic (Redux = React, Svelte stores = Svelte only)
4. Form state complexity (path-based access with fine-grained subscription)

**Second-chance wishes:**
- Same primitive for server and client state with location annotation
- Serialization awareness built into the state primitive
- URL state as first-class derived store
- Pull-based lazy eval with push-based notification (= callbag-recharge's two-phase push)

### 2. Web3 / Decentralized

**Data types:** On-chain state (contract storage), off-chain/L2 state, content-addressed data (CIDs), identity (DIDs, VCs), DAO governance, transaction lifecycle.

**Must-have properties:**
- Content addressability, Merkle proof support, cross-chain references, optimistic local state, schema evolution without migration (contracts are immutable)

**Pain points:**
1. RPC as bottleneck (no built-in subscription model — poll or unreliable `eth_subscribe`)
2. IPFS availability (integrity ≠ availability, pinning is centralized)
3. State fragmented across chains (no unified view)
4. Smart contract state is opaque (256-bit storage slots packed by compiler)

**Second-chance wishes:**
- Reactive subscriptions in the chain protocol itself
- Cross-chain references with finality metadata
- Off-chain data attestation with on-chain trust properties
- Transaction lifecycle as explicit state machine

### 3. AI / ML / LLM

**Data types:** Embedding vectors, context windows, streaming chunks (SSE), agent memory (short/long/episodic), tool call lifecycle, RAG pipeline data, multi-agent state, training data.

**Must-have properties:**
- **Streaming-native** — LLM output arrives token-by-token. "Complete value required" is fundamentally wrong.
- **Token-budget-aware** — Context windows are finite. "How much space does this take?" must be queryable.
- **Heterogeneous payloads** — Single turn may contain text, tool calls, images, structured JSON, errors. Tagged unions needed.
- **Cancellation/abort** — LLM calls are expensive. Must propagate cancellation.
- **Append-only with snapshots** — Conversation history is append-only but needs branching for "edit and regenerate."
- **Similarity-queryable** — In-memory state must support "find most relevant items."

**Pain points:**
1. **Streaming accumulation is ad-hoc** — Every LLM integration reimplements "accumulate SSE chunks." No standard reactive primitive.
2. **Agent memory has no consensus** — LangChain's memory classes are a taxonomy search, not a solution. Needs recency + relevance + importance simultaneously.
3. **Tool call orchestration is state management in disguise** — Parallel tools, wait for results, decide next step = reactive graph problem. But modeled as imperative `await` chains.
4. **Context window management is manual packing** — System prompt + history + RAG chunks + tool schemas = constraint satisfaction solved by hand.
5. **Multi-model orchestration lacks a state model** — Chain Claude → vision model → code model with no unified state graph.

**Second-chance wishes:**
- Streaming-first primitives where partial values are first-class
- Tool call lifecycle as reactive state machine (= callbag-recharge's `producer` with `resubscribable`)
- Context windows as reactive derived store with token budget constraints
- Append-only collections with branching (conversation trees, not arrays)

### 4. Infrastructure / DevOps

**Data types:** Configuration (YAML/HCL), desired vs actual state, observability (metrics/traces/logs), pipeline state, secrets, Terraform state.

**Must-have properties:**
- Declarative with diff semantics, mergeable, schema-validated with gradual typing, dependency-ordered, idempotent, secret-aware

**Pain points:**
1. **YAML is the wrong tool** — No variables, loops, conditionals, type system. Helm templates are unreadable.
2. **Terraform state is a single point of failure** — Mutable JSON blob, state drift, secrets in plaintext.
3. **Observability data is siloed** — Metrics, traces, logs in different systems with different query languages.
4. **Configuration drift is invisible** — Desired state (Git) and actual state diverge silently.

**Second-chance wishes:**
- Typed, programmable configuration language with merge/override/schema support
- State diffing as standard operation on any data structure
- Unified observability with single data model
- Desired/actual state as reactive pair (= derived store comparing two sources)

### 5. Real-time / IoT

**Must-have properties:**
- Temporal ordering guarantees, backpressure, windowed aggregation, offline-first with sync, compact representation, lossy degradation

**Second-chance wishes:**
- Backpressure in the data primitive, not the transport layer (= callbag's pull model)
- Offline-first sync as composable middleware, not database feature
- Time as first-class dimension
- Adaptive resolution (high-res recent, downsampled historical)

### 6. Data Engineering / Analytics

**Must-have properties:**
- Schema evolution, partitioning/pruning, time travel/versioning, transactional guarantees, incremental computation, lineage as metadata

**Pain points:**
1. The "two-language problem" (SQL lacks abstraction, Python lacks optimization)
2. Schema evolution breaks pipelines silently (rename a column = downstream breaks)
3. Incremental processing is fragile (watermarks, unique keys, timestamps)
4. Data quality is bolted on (assertions after the data is written)
5. Lineage tracking is incomplete (column-level lineage is rare)

**Second-chance wishes:**
- Change tracking built into every dataset (CDC generalized)
- Schema contracts as first-class concept
- Data quality as constraint on the structure, not external assertion
- Automatic column-level lineage

### Cross-Domain Universal Demands

**Five properties emerge as universal, regardless of domain:**

1. **Reactive by default** — Every domain needs "when X changes, Y updates." Currently bolted on everywhere.
2. **Streaming and complete values are the same thing** — A "complete" value is just a stream that emitted once and completed. The distinction is artificial.
3. **Lazy evaluation with push notification** — Push dirty, pull value. Callbag-recharge's two-phase push, independently demanded by every domain.
4. **Explicit dependency graphs** — Implicit tracking is convenient but fragile. Every domain at scale converges on explicit deps.
5. **Data must know its own metadata** — Timestamps, provenance, finality status, token counts, schema version. First-class, not in a separate system.

---

## Architectural Patterns and Design: Security & Performance

### Security Deep-Dive

#### Data-Level Access Control

Most data structures have NO built-in access control because they were designed as pure computational abstractions within a single trust domain. Security was delegated to OS/runtime below or application above.

**The ambient authority problem:** Most environments grant access based on *who the code is*, not *what references it holds*. Any code with a database handle can do anything that handle permits.

**Three approaches compared:**

| Approach | Pros | Cons | For our design |
|---|---|---|---|
| **ACLs** | Intuitive, auditable per resource | Scales poorly (N×M), needs central identity registry | No — requires central authority |
| **RBAC** | Reduces to N+M complexity | Role explosion, static, no contextual constraints | No — too rigid |
| **Object Capabilities** | No ambient authority, POLA by construction, composable, attenuatable | Revocation is hard, needs language discipline | **Yes — matches callbag protocol** |

**Key insight:** The callbag protocol already embodies a capability model. `sink(0, talkback)` hands the sink a capability (the talkback function). It cannot forge a new one. This IS ocap at the protocol level.

**UCAN tokens** are the closest existing mechanism to "authorization embedded in data" — DID-based delegation chains in JWTs, offline-first, attenuatable. Main weakness: revocation.

**Macaroons** add contextual caveats via HMAC chains — elegant but require online verification.

#### Content Integrity & Verifiability

- **Content addressing (CID):** Immutability by construction, dedup, verifiability, location independence. Challenge: mutability requires "mutable pointer to immutable data" (IPNS, Git refs, our Store pattern).
- **Merkle proofs:** Prove membership of a datum in O(log n) hashes. A Merkle-structured node gets selective disclosure for free.
- **Zero-knowledge proofs:** Prove statements about data without revealing it. Practical for simple predicates today; general-purpose ZK not yet practical.
- **Signed data structures:** Embed signatures in the structure itself. Sign the CID rather than the content for efficiency.

#### Privacy by Design

- **Transport vs data-level encryption:** TLS doesn't survive storage/replication. Field-level encryption does.
- **Homomorphic encryption:** FHE still 10,000-1,000,000x slower. Not practical for general operations. Design for encrypted-at-rest with selective decryption instead.
- **GDPR vs immutability:** Crypto-shredding (encrypt PII with per-user key, delete key = "delete" data). Requires separating content from encryption envelope.

#### Cross-Trust-Boundary Data

- **Serialization as attack surface:** Type confusion, object injection, gadget chains, resource exhaustion.
- **Prototype pollution:** Root cause is mixing data namespace with control namespace. Universal data structure must strictly separate them.
- **Expansion attacks ("billion laughs"):** Any format with references/substitution can create exponential expansion. Must define max nesting, max expansion, no recursive refs.

### Performance Deep-Dive

#### Memory Layout & Cache Efficiency

Cache miss to main memory is 60-100x slower than L1 hit. Layout matters enormously.

- **Row (AoS):** All fields of one record contiguous. Good for point lookups, bad for scans.
- **Columnar (SoA):** All values of one field contiguous. Good for analytics, SIMD, compression. Bad for record reconstruction.
- **Hybrid (PAX):** Within a page, columnar. Across pages, row ranges. Best of both.

**Design implication:** Universal node should support *layout-polymorphism* — same logical data, multiple physical layouts chosen by access pattern.

#### Zero-Copy & Partial Reads

Most formats (JSON, Protobuf, MessagePack) interleave schema with data. Finding field N requires parsing fields 1 through N-1.

**Solution:** Offset table / index enabling O(1) field access. FlatBuffers, Arrow, and BSON do this. A universal format must include this.

#### Structural Sharing for Immutability

- **HAMT:** 32-way trie, O(7) for typical sizes, only path from root to modified leaf copied.
- **RRB-Tree:** Relaxed radix balanced, efficient concat + slice.
- **Immer's proxy:** Write "mutation" code, get immutable updates via Proxy traps. 2-5x slower than hand-written.

**Why it matters for reactive systems:** Without structural sharing, `===` always fails after any update, defeating memoization and making every derived store recompute.

**Content-addressed nodes get efficient diffing for free:** Diff = set of subtree roots with different CIDs.

#### Streaming & Incremental Processing

- **Self-adjusting computation:** Record dependency graph, re-execute only affected subcomputations. O(changed) not O(total).
- **Differential dataflow:** Propagate differences (additions/deletions) through operators.
- **Callbag-recharge's model:** DIRTY marks what *might* change; value propagation evaluates what *actually* changed. This IS incremental computation.

#### Compression & Wire Efficiency

- **Schema-aware compression achieves 5-20x** (vs 2-5x for general-purpose). Dictionary encoding, RLE, bit-packing, delta encoding, frame-of-reference.
- **Delta-of-delta (Gorilla):** 1.37 bytes per time-series data point.
- **Bandwidth still matters:** Mobile (~30 Mbps median), serverless cold starts, egress costs ($0.01-0.12/GB), edge memory limits, battery life.

### Security + Performance Synthesis: Design Principles

| # | Principle | Detail |
|---|---|---|
| 1 | **Capability-based access by default** | Access requires a capability reference, not knowledge of a key |
| 2 | **Content-addressed for integrity** | Every node has a CID. Verification is local and offline |
| 3 | **Field-level encryption** | Encrypted-at-rest, crypto-shredding for GDPR |
| 4 | **Strict data/control separation** | No prototype pollution, no injection by construction |
| 5 | **Expansion-bounded** | Max nesting depth and expansion ratio are structural properties |
| 6 | **Layout-polymorphic** | Same logical structure, multiple physical layouts |
| 7 | **Zero-copy with offset table** | O(1) field access without full deser |
| 8 | **Structurally shared** | Immutable updates share unchanged subtrees |
| 9 | **Streaming-capable** | Partial parsing, incremental processing, demand-driven |
| 10 | **Schema-aware compression** | Type-specific encoding per field |

**The fundamental tension:** Security adds overhead, performance demands minimal overhead. **Resolution: architectural separation.** Security metadata (capabilities, signatures, encryption) stored alongside but separate from hot-path data, enabling the common case (authorized, verified access) to be fast.

---

## Implementation Approaches: First-Principles Node Design

### What IS Data, Fundamentally?

Data is encoded information existing in three modes:
1. **Data-at-rest** — A snapshot on disk. No inherent notion of time or change.
2. **Data-in-motion** — A value traversing a boundary (network packet, callbag DATA signal). Transient.
3. **Data-in-use** — A value in memory, actively being read/transformed. May be stale or mid-computation.

Most systems treat these as fundamentally different (databases vs message queues vs caches), requiring explicit translation at each boundary. This is the root cause of enormous accidental complexity.

**The key insight:** A well-designed node should make these three modes *projections of the same structure*:
- A node at rest = a node with no active subscribers
- A node in motion = a node whose value is being relayed through an edge
- A node in use = a node with at least one subscriber

This is exactly what callbag-recharge already does at the edge level. The node design should preserve this property.

### Irreducible Properties: The Seven Pillars

#### 1. Identity — How is this data addressed?

| Strategy | Collision | Ordering | Verifiability | Human-readable | Dedup |
|---|---|---|---|---|---|
| UUID v4 | ~zero | none | none | no | no |
| UUID v7 | ~zero | temporal | none | no | no |
| Content hash (CID) | impossible | none | built-in | no | automatic |
| Path-based | by convention | hierarchical | none | yes | no |

**Design decision: Two identity layers:**
- **`id`** — Stable, mutable identity (UUID v7, temporal ordering). Does not change when value changes. What other nodes reference.
- **`cid`** — Content identifier derived from value + schema. Changes with every mutation. Enables verification, dedup, caching.

The `id` is analogous to callbag-recharge's Store reference (object identity). The `cid` is analogous to the equality check (`equals` option).

#### 2. Schema / Type — What shape does this data have?

- **Structural typing at the data layer** (nominal types are a code-level concern)
- **Self-describing** (schema travels with data, or is content-addressed and retrievable)
- **Forward-compatible evolution** (adding fields safe, removing requires migration)
- **Schema-on-write by default** with escape hatch for untyped

Each node carries a `schema` reference (content-addressed schema ID). The schema is itself a node (self-hosting).

#### 3. Versioning / Time — How does this data change?

Two fundamental models:
1. **Snapshots:** Each mutation = new immutable snapshot. O(1) time travel, difficult merge.
2. **Deltas (event log):** Each mutation = an operation. Natural merge (CRDTs), O(n) replay.

**Key insight:** Callbag-recharge's two-phase push is already a delta-then-snapshot model. DIRTY = delta ("something changed"), DATA = new snapshot.

**Design decision:** Node stores:
- **`value`** — Current snapshot
- **`version`** — Monotonically increasing counter (Lamport-like)
- **`prev`** — Optional CID reference to previous version (history traversal)

The `version` maps directly to callbag-recharge's dirty/settled/resolved cycle.

#### 4. Access Control / Capabilities — Who can do what?

The capability model has a deep advantage: it composes. A capability can be attenuated and delegated without a central authority. This is exactly how a distributed reactive graph should work.

**Connection to callbag-recharge:** `sink(0, talkback)` hands the sink a capability — the talkback function. This IS ocap at the protocol level.

**Design decision:** Each node has a `caps` field — capability tokens for `read`, `write`, `admin`. For in-process use: simplified to a policy object. For distributed: UCAN-style JWT tokens.

#### 5. Relationships / Links — How does this connect?

Three relationship types:
- **Upstream dependencies** — inputs (computation graph, handled by callbag edges)
- **Downstream dependents** — subscribers (emergent from subscription at runtime)
- **Lateral references** — domain links (user → profile)

**Design decision:**
- **`deps`** — Declared upstream deps. Maps to callbag-recharge's explicit deps arrays. `id` references (stable).
- **`refs`** — Optional lateral links. CID or id references.

Downstream is handled by callbag-recharge's output slot model at runtime. Not stored.

#### 6. Encoding / Representation — How stored/transmitted?

In-memory representation and wire/storage representation should be decoupled.

**Design decision:** Pluggable codecs:
- Default: **DAG-CBOR** (IPLD-compatible, self-describing, compact, CID links native, deterministic mode)
- Debug: JSON
- Performance-critical: Custom codecs

Minimal viable: `JSON.stringify`/`JSON.parse`. Codec interface is the extension point.

##### DAG-CBOR Deep Dive

DAG-CBOR = CBOR (Concise Binary Object Representation) + DAG links (CIDs as native type).

- CBOR is an IETF-standard binary format (RFC 8949) — think "binary JSON." Same data model (objects, arrays, strings, numbers, booleans, null) but encoded as compact bytes instead of text.
- DAG prefix means it adds CID links as a native type (CBOR tag 42), so node references are first-class, not just opaque strings.
- Deterministic encoding — same data always produces the same bytes. This is critical for content addressing (CID = hash of bytes). JSON doesn't guarantee key ordering, so `{"a":1,"b":2}` and `{"b":2,"a":1}` produce different hashes.

**Size Comparison**

For a typical node `{ id: "abc-123", value: 42, version: 5, deps: [] }`:

| Format | Size | Why |
|---|---|---|
| JSON | ~55 bytes | Keys repeated as strings, numbers as text, quotes everywhere |
| CBOR/DAG-CBOR | ~30 bytes | Keys as short bytes, numbers as varints, no quotes |
| MessagePack | ~32 bytes | Similar to CBOR but no CID support, no deterministic mode |
| Protobuf | ~20 bytes | Smallest, but needs schema at both ends, not self-describing |

Roughly 40-50% smaller than JSON for typical structured data. For arrays of nodes (graph snapshots), the savings compound because CBOR doesn't repeat key names the way JSON does if you use arrays-of-arrays instead of arrays-of-objects.

**Practical Codec Progression**

For the `storage.write` example, the practical progression:

1. **V0 (just ship it):** `JSON.stringify` — works everywhere, debuggable, good enough for < 10K nodes
2. **V1 (size matters):** CBOR via `@ipld/dag-cbor` npm package — ~40-50% smaller, deterministic (needed for CID computation anyway), still self-describing
3. **V1.5 (speed matters):** CBOR + zstd compression — another 2-5x on top. Zstd is available in Node (`node:zlib`) and browsers (via wasm)

The reason DAG-CBOR is the recommended default over MessagePack or Protobuf: you need deterministic encoding for CID computation anyway, and IPLD tooling already speaks DAG-CBOR natively. One codec serves both "serialize for storage" and "hash for content addressing."

#### 7. Metadata / Observability — What else?

- **Intrinsic** (part of content hash): `createdAt`
- **Extrinsic** (not part of hash): `updatedAt`, `status`, `provenance`, `tags`

Connection: callbag-recharge's Inspector already provides extrinsic metadata via WeakMaps (zero intrusion). This is the right pattern.

### The Universal Node Interface

```typescript
type CID = string;      // multibase-encoded multihash
type NodeId = string;    // UUID v7 by default
type NodeRef = NodeId | CID;
type CapLevel = "read" | "write" | "admin";
type SchemaRef = CID;

/**
 * The Universal Node.
 * DATA CONTAINER at each vertex of the reactive graph.
 * callbag-recharge handles the EDGES.
 * This handles the VERTICES.
 */
interface UniversalNode<T = unknown> {
  // === Identity ===
  readonly id: NodeId;         // Stable. Assigned once. Never changes.
  readonly cid: CID;           // Content ID. Derived from (value, schema, deps, refs). Changes on mutation.

  // === Value ===
  readonly value: T;           // Current data payload.

  // === Schema ===
  readonly schema?: SchemaRef; // Content-addressed schema reference.

  // === Versioning ===
  readonly version: number;    // Monotonic counter. Increments on each value change.
  readonly prev: CID | null;   // CID of previous version. History chain.

  // === Relationships ===
  readonly deps: readonly NodeId[];   // Upstream (computation graph). Stable id refs.
  readonly refs: readonly NodeRef[];  // Lateral (data graph). CID or id refs.

  // === Access ===
  readonly caps?: Record<CapLevel, boolean>; // Capability policy. Omitted = unrestricted.

  // === Metadata ===
  readonly createdAt: number;                // Creation timestamp. Intrinsic.
  readonly meta?: Record<string, unknown>;   // Extrinsic metadata. NOT part of CID.
}
```

### How It Pairs with callbag-recharge

```typescript
interface Store<T> {
  // === Reactive interface (callbag-recharge) ===
  get(): T;                    // Read current value
  set(value: T): void;        // Mutate (state nodes only)
  source(): Source<T>;         // Subscribe via callbag protocol

  // === Node interface (universal node) ===
  node(): UniversalNode<T>;   // Access the underlying snapshot
  id: NodeId;                 // Shorthand
  cid: CID;                   // Current content ID
}
```

**The key separation:**
- `Store` = **live, reactive wrapper** (mutable reference, subscriptions, operators)
- `UniversalNode` = **serializable, verifiable snapshot** (immutable data, content-addressed)

**You can:**
- **Serialize:** `JSON.stringify(store.node())` — persist, transmit, cache
- **Hydrate:** `state(node.value, { id: node.id, schema: node.schema })` — restore
- **Verify:** `computeCID(node) === node.cid` — integrity check
- **Diff:** `diff(nodeV1, nodeV2)` — change detection via CID comparison

**Hot path stays lean:** The reactive runtime only touches `value` and `version`. Full node structure available when needed (serialization, debugging, distribution).

### Two Overlapping Graph Structures

1. **Computation graph** (callbag edges): `state → derived → derived → effect`. Wired by callbag protocol. `deps` declares upstream nodes.
2. **Data graph** (node refs): `user → profile`, `order → [items]`. Domain relationships. Traversed by app logic.

The graph is emergent — no separate "graph" object. Each node knows its deps and refs. Downstream discovered via subscription.

### Inspirations

| System | What we take |
|---|---|
| **IPLD** | Content addressing (CID), self-describing data, DAG-CBOR encoding |
| **CRDTs** | Version/ordering metadata enables conflict-free merging |
| **UCAN** | Capability-based access. Possession = permission. No central authority |
| **Event Sourcing** | `prev` chain IS a snapshot event log |
| **Git** | Content-addressed objects + mutable refs = our UniversalNode + Store |
| **Datomic** | "Database is a value." UniversalNode is a value, Store is the mutable reference |
| **Cap'n Proto** | Capabilities as first-class in serialization |

### Phased Implementation Roadmap

**Phase 1 — Minimal Viable (V0):**
```typescript
interface NodeV0<T = unknown> {
  readonly id: NodeId;       // UUID v7
  readonly value: T;
  readonly version: number;  // Simple counter
  readonly deps: readonly NodeId[];
}
```
This is what callbag-recharge already has implicitly — object identity, current value, dirty/resolved cycle, explicit deps. Making it explicit and serializable is the first step.

**Phase 2 — Content addressing + history:**
```typescript
interface NodeV1<T = unknown> extends NodeV0<T> {
  readonly cid: CID;         // Computed from (value, schema, deps)
  readonly prev: CID | null; // History chain
  readonly schema?: SchemaRef;
}
```
Enables verification, dedup, time-travel debugging, persistence.

**Phase 3 — Access + relationships + full vision:**
```typescript
// Full UniversalNode interface
```
Enables distribution, multi-user, cross-boundary reactive graphs.

### Key Design Properties

1. **Immutable snapshots, mutable references** — `UniversalNode` is frozen. `Store` is the reactive wrapper. Can hash, cache, transmit, verify without worrying about mutation.
2. **Self-verifying** — CID derived from content. Verify independently. No trust required.
3. **Incrementally adoptable** — V0 is "add an id and version to what you already have."
4. **Encoding-agnostic** — TypeScript interface defines semantics. Wire format is pluggable.
5. **Runtime-agnostic** — Nothing tied to callbag-recharge specifically. Could be nodes for any reactive system.
6. **Graph-native** — Deps and refs make it inherently a graph. No separate graph database needed.

---

## Technical Research Recommendations

### Implementation Roadmap

**Phase 1 — NodeV0 + Serialization (weeks)**
- Add `id` (UUID v7) and `version` (counter) to existing stores
- Implement `store.node()` → serializable snapshot
- Implement `state(value, { id })` for hydration from snapshots
- Zero breaking changes — additive to existing API

**Phase 2 — Content Addressing (weeks)**
- Implement CID computation (BLAKE3 or SHA-256 + multicodec)
- Add `cid` and `prev` fields
- Implement DAG-CBOR codec for IPLD compatibility
- Implement `diff(nodeA, nodeB)` via CID tree comparison
- Enable persistence: `serialize(graph)` / `hydrate(graph)`

**Phase 3 — Capability Access (weeks)**
- Add `caps` policy to nodes
- Implement capability-gated `get()`/`set()` wrappers
- UCAN token validation for distributed scenarios
- Field-level encryption support

**Phase 4 — Distribution (ongoing)**
- Cross-process/cross-network reactive graphs via CID-based sync
- CRDT-inspired merge semantics for multi-writer scenarios
- WebSocket/WebRTC transport for peer-to-peer reactive graphs

### Technology Stack Recommendations

| Layer | Recommendation | Why |
|---|---|---|
| **Identity** | UUID v7 (id) + BLAKE3/SHA-256 (CID) | Temporal ordering + fast content addressing |
| **Encoding** | DAG-CBOR (primary), JSON (debug) | IPLD compat, deterministic, COSE signing support |
| **Schema** | TypeBox or custom structural schema | TypeScript-native, content-addressable |
| **Capabilities** | UCAN (distributed) / policy object (in-process) | Matches callbag's ocap model |
| **Structural sharing** | HAMT for maps, RRB-tree for arrays | Efficient immutable updates with CID-based diffing |

### Success Metrics

- **Adoption:** NodeV0 adds < 5% overhead to existing callbag-recharge operations
- **Serialization:** Full graph snapshot/restore in < 10ms for typical app state
- **Verification:** CID computation < 1ms for typical node
- **Interop:** DAG-CBOR output consumable by IPLD tooling
- **Bundle size:** Node layer adds < 5KB to core bundle (gzipped)

---

## Technical Research Conclusion

### Summary of Key Findings

1. **Every domain converges on the same 5 properties:** reactive, streaming-native, lazy+push, explicit deps, self-describing metadata. Callbag-recharge already provides 4 of 5 at the edge level. The node design completes the picture.

2. **The "mutable pointer to immutable data" pattern is universal:** Git (refs → commits), IPFS (IPNS → CID), Datomic (reference → value), our design (Store → UniversalNode). This is the correct architecture.

3. **Content addressing is the missing foundation:** Integrity, dedup, caching, diffing, and verification all fall out for free once nodes are content-addressed. The cost (hashing) is amortized by the benefits.

4. **Capability-based access matches the callbag protocol:** The protocol already hands out capabilities (talkback functions). Extending this to the data level is natural, not bolted on.

5. **The gap in the market is real:** No existing format handles structured data + binary + vectors + capabilities + streaming + reactivity. This is the unique positioning.

### Strategic Impact

If callbag-recharge implements the UniversalNode design:
- **Web:** Serializable, hydration-aware, framework-agnostic state that works across SSR boundaries
- **Web3:** Content-addressed, capability-secured nodes that speak IPLD natively
- **AI:** Streaming-native, append-only-with-branching state for LLM conversations and agent memory
- **Infrastructure:** Diffable, versionable, mergeable configuration nodes with schema contracts

The library evolves from "state management + operators" to "the universal reactive data graph" — nodes (UniversalNode) + edges (callbag protocol) + operators (extras) as a complete system.

### Next Steps

1. Validate NodeV0 design against existing callbag-recharge test suite
2. Prototype CID computation and benchmark overhead
3. Build DAG-CBOR codec and verify IPLD interop
4. Design the `store.node()` API surface
5. Write the `llms.txt` section for the node layer

---

**Technical Research Completion Date:** 2026-03-17
**Research Period:** Comprehensive first-principles analysis
**Source Verification:** Based on deep analysis of 30+ data structures/formats, 6 domains, security and performance fundamentals
**Technical Confidence Level:** High — grounded in established computer science foundations, real-world production systems, and first-principles reasoning

_This research serves as the architectural foundation for the UniversalNode design — the "vertices" that pair with callbag-recharge's "edges" to form a universal reactive data graph._
