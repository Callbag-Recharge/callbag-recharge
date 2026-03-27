// ---------------------------------------------------------------------------
// agentMemory v2 — Mem0-equivalent reactive agentic memory (SA-4)
// ---------------------------------------------------------------------------
// Upgraded from inline processing to composing jobQueue + topic.
// Extraction runs through a concurrency-1 queue (SA-4a, solves SA-4g).
// Embedding runs through a concurrency-N queue (SA-4b).
// Mutations broadcast to a MemoryEvent topic (SA-4c).
// Optional knowledgeGraph integration via parallel extraction queue (SA-4d).
// topicBridge-ready via inner.events (SA-4e).
//
// Built on: jobQueue (messaging/), jobFlow (messaging/), topic (messaging/),
// collection (memory/), vectorIndex (memory/), fromLLM (ai/),
// subscribe (core/), rawFromAny + rawSubscribe (raw/)
// ---------------------------------------------------------------------------

import { state } from "../../core/state";
import { subscribe } from "../../core/subscribe";
import { collection } from "../../memory/collection";
import { vectorIndex as createVectorIndex } from "../../memory/vectorIndex";
import { jobQueue } from "../../messaging/jobQueue";
import { topic } from "../../messaging/topic";
import { topicBridge } from "../../messaging/topicBridge";
import { rawFromAny } from "../../raw/fromAny";
import { rawSubscribe } from "../../raw/subscribe";
import { checkDedup } from "./dedup";
import { buildExtractionMessages, parseFacts } from "./extraction";
import { buildGraphExtractionMessages, parseGraphExtraction } from "./graphExtraction";
import { autoPersist } from "./persistence";
import type {
	AgentMemoryAddOperation,
	AgentMemoryAddOptions,
	AgentMemoryOperationStatus,
	AgentMemoryOptions,
	AgentMemoryResult,
	AgentMemoryScope,
	AgentMemorySearchOperation,
	AgentMemorySearchOptions,
	AgentMemorySearchResult,
	EmbedJob,
	EmbedResult,
	ExtractedFact,
	ExtractionJob,
	ExtractionResult,
	GraphExtractionJob,
	GraphExtractionResult,
	MemoryEvent,
} from "./types";

const SCOPE_PREFIX = "scope:";

function scopeTags(scope?: AgentMemoryScope): string[] {
	if (!scope) return [];
	const tags: string[] = [];
	if (scope.userId) tags.push(`${SCOPE_PREFIX}user:${scope.userId}`);
	if (scope.agentId) tags.push(`${SCOPE_PREFIX}agent:${scope.agentId}`);
	if (scope.tags) {
		for (const t of scope.tags) tags.push(`${SCOPE_PREFIX}${t}`);
	}
	return tags;
}

function matchesScope(nodeTags: Set<string>, requiredTags: string[]): boolean {
	for (const t of requiredTags) {
		if (!nodeTags.has(t)) return false;
	}
	return true;
}

/**
 * Creates a reactive agentic memory — a Mem0-equivalent drop-in memory layer.
 *
 * v2 (SA-4): extraction and embedding routed through jobQueues for retry,
 * stall detection, DLQ, and concurrency control. Mutations broadcast via
 * a MemoryEvent topic. Optional knowledgeGraph integration.
 *
 * @param opts - Configuration: LLM, embedding function, persistence, thresholds.
 *
 * @returns `AgentMemoryResult` — add/search operation handles, CRUD methods,
 *   size store, and underlying queues/topic.
 *
 * @remarks **jobQueue-backed extraction (SA-4a):** `add()` enqueues an extraction
 *   job. Concurrency 1 serializes LLM calls (solves SA-4g shared LLM race).
 * @remarks **jobQueue-backed embedding (SA-4b):** Extracted facts fan out into
 *   a concurrency-N embedding queue via jobFlow.
 * @remarks **MemoryEvent topic (SA-4c):** All mutations (add/update/delete)
 *   publish to `inner.events` for cross-agent broadcasting via topicBridge (SA-4e).
 * @remarks **knowledgeGraph (SA-4d):** When `knowledgeGraph` option is set,
 *   a parallel extraction queue extracts entities and relations.
 * @remarks **Configurable overfetch (SA-4h):** `searchOverfetch` option controls
 *   the multiplier for scope-filtered search results.
 * @remarks **Cancellable embed (SA-4i):** `EmbedFn` accepts optional AbortSignal.
 * @remarks **Per-operation handles (SA-4j):** `add()`/`search()` return isolated
 *   operation stores (`status`, `error`, results/extracted data, cancellation).
 *
 * @example
 * ```ts
 * import { agentMemory, fromLLM, indexedDBAdapter } from 'callbag-recharge/ai';
 *
 * const mem = agentMemory({
 *   llm: fromLLM({ provider: 'openai', apiKey: 'sk-...', model: 'gpt-4o-mini' }),
 *   embed: async (text) => embedder(text),
 *   dimensions: 384,
 *   adapter: indexedDBAdapter(),
 *   embeddingConcurrency: 8,
 * });
 *
 * mem.add([
 *   { role: 'user', content: 'I love TypeScript and hate Java' },
 * ], { userId: 'alice' });
 *
 * // After extraction completes:
 * const searchOp = mem.search('what languages?', { userId: 'alice' });
 * // searchOp.results.get() → [{ node: ..., score: 0.92 }]
 * ```
 *
 * @category ai
 */
export function agentMemory(opts: AgentMemoryOptions): AgentMemoryResult {
	const name = opts.name ?? "agentMemory";
	const maxSize = opts.maxSize ?? 10000;
	const dedupThreshold = opts.dedupThreshold ?? 0.85;
	const llm = opts.llm;
	const embed = opts.embed;
	const searchOverfetch = opts.searchOverfetch ?? 2;
	const embeddingConcurrency = opts.embeddingConcurrency ?? 4;
	const extractionRetry = opts.extractionRetry ?? { maxRetries: 3 };
	const kg = opts.knowledgeGraph;
	if (kg && !opts.graphLlm) {
		throw new Error("agentMemory: graphLlm is required when knowledgeGraph is provided");
	}
	const graphLlm = opts.graphLlm;

	// Core data structures
	const col = collection<string>({ maxSize, weights: opts.weights });
	const vi = createVectorIndex({ dimensions: opts.dimensions });
	const _embeddings = new Map<string, Float32Array | number[]>();

	// Persistence
	const _persist = opts.adapter ? autoPersist(col, vi, _embeddings, opts.adapter, name) : null;
	_persist?.restore();

	// Track active operations for cancellation
	let _batchSeq = 0;
	let _opSeq = 0;

	// -----------------------------------------------------------------------
	// SA-4c: Memory event topic
	// -----------------------------------------------------------------------
	const _events = topic<MemoryEvent>(`${name}:events`);
	const _sharedBridge = opts.shared
		? topicBridge(
				opts.shared.transport,
				{
					[opts.shared.topicName ?? `${name}:events`]: {
						topic: _events,
						filter: opts.shared.filter as any,
					},
				} as any,
				{ name: opts.shared.bridgeName ?? `${name}:shared` },
			)
		: undefined;

	function _publishEvent(
		type: MemoryEvent["type"],
		id: string,
		content?: string,
		scopeTagsArr?: string[],
	): void {
		_events.publish({
			type,
			id,
			content,
			scopeTags: scopeTagsArr,
			timestamp: Date.now(),
		});
	}

	// -----------------------------------------------------------------------
	// SA-4a: Extraction job queue (concurrency 1 — serializes LLM, SA-4g)
	// -----------------------------------------------------------------------
	const _extractionQueue = jobQueue<ExtractionJob, ExtractionResult>(
		`${name}:extract`,
		(signal, job) => {
			return new Promise<ExtractionResult>((resolve, reject) => {
				if (signal.aborted) {
					reject(new DOMException("Aborted", "AbortError"));
					return;
				}

				const extractionMessages = buildExtractionMessages(job.messages, opts.extractionPrompt);
				llm.generate(extractionMessages);

				const sub = subscribe(llm.status, (status) => {
					if (signal.aborted) {
						sub.unsubscribe();
						reject(new DOMException("Aborted", "AbortError"));
						return;
					}

					if (status === "completed") {
						sub.unsubscribe();
						const output = llm.get();
						resolve({
							facts: parseFacts(output),
							scopeTags: job.scopeTags,
							batchId: job.batchId,
						});
					} else if (status === "errored") {
						sub.unsubscribe();
						reject(llm.error.get());
					}
				});

				signal.addEventListener(
					"abort",
					() => {
						sub.unsubscribe();
						llm.abort();
					},
					{ once: true },
				);
			});
		},
		{ concurrency: 1, retry: extractionRetry },
	);

	// -----------------------------------------------------------------------
	// SA-4b: Embedding job queue (concurrency N)
	// -----------------------------------------------------------------------
	const _embeddingQueue = jobQueue<EmbedJob, EmbedResult>(
		`${name}:embed`,
		(signal, job) => {
			return new Promise<EmbedResult>((resolve, reject) => {
				if (signal.aborted) {
					reject(new DOMException("Aborted", "AbortError"));
					return;
				}

				rawSubscribe(
					rawFromAny(embed(job.fact.content, signal)),
					(embedding: Float32Array | number[]) => {
						resolve({
							fact: job.fact,
							embedding,
							scopeTags: job.scopeTags,
							batchId: job.batchId,
							targetId: job.targetId,
						});
					},
					{
						onEnd: (err?: unknown) => {
							if (err !== undefined) reject(err);
						},
					},
				);

				signal.addEventListener(
					"abort",
					() => {
						reject(new DOMException("Aborted", "AbortError"));
					},
					{ once: true },
				);
			});
		},
		{ concurrency: embeddingConcurrency },
	);

	// -----------------------------------------------------------------------
	// SA-4d: Graph extraction job queue (optional, concurrency 1)
	// -----------------------------------------------------------------------
	const _graphQueue = kg
		? jobQueue<GraphExtractionJob, GraphExtractionResult>(
				`${name}:graph`,
				(signal, job) => {
					return new Promise<GraphExtractionResult>((resolve, reject) => {
						if (signal.aborted) {
							reject(new DOMException("Aborted", "AbortError"));
							return;
						}

						const msgs = buildGraphExtractionMessages(job.messages, opts.graphExtractionPrompt);
						graphLlm?.generate(msgs);

						const sub = subscribe(graphLlm!.status, (status) => {
							if (signal.aborted) {
								sub.unsubscribe();
								reject(new DOMException("Aborted", "AbortError"));
								return;
							}

							if (status === "completed") {
								sub.unsubscribe();
								const output = graphLlm!.get();
								resolve(parseGraphExtraction(output));
							} else if (status === "errored") {
								sub.unsubscribe();
								reject(graphLlm!.error.get());
							}
						});

						signal.addEventListener(
							"abort",
							() => {
								sub.unsubscribe();
								graphLlm?.abort();
							},
							{ once: true },
						);
					});
				},
				{ concurrency: 1, retry: { maxRetries: 0 } },
			)
		: undefined;

	// -----------------------------------------------------------------------
	// Wire embedding completion → store + dedup + event publish
	// -----------------------------------------------------------------------
	interface AddOpState {
		op: AgentMemoryAddOperation;
		status: ReturnType<typeof state<AgentMemoryOperationStatus>>;
		error: ReturnType<typeof state<unknown | undefined>>;
		endedAt: ReturnType<typeof state<number | undefined>>;
		extracted: ReturnType<typeof state<ExtractedFact[]>>;
		storedIds: ReturnType<typeof state<string[]>>;
		expected: number;
		pending: number;
		failed: boolean;
		touchedIds: Set<string>;
	}
	const _addOpsByBatch = new Map<number, AddOpState>();
	const _searchAborts = new Map<string, AbortController>();
	const _activeOpIds = new Set<string>();

	function _reserveOpId(baseId: string, kind: "add" | "search"): string {
		const base = baseId.trim() || `${kind}-${++_opSeq}`;
		if (!_activeOpIds.has(base)) {
			_activeOpIds.add(base);
			return base;
		}
		let n = 2;
		let candidate = `${base}#${n}`;
		while (_activeOpIds.has(candidate)) {
			n++;
			candidate = `${base}#${n}`;
		}
		_activeOpIds.add(candidate);
		return candidate;
	}

	function _releaseOpId(opId: string): void {
		_activeOpIds.delete(opId);
	}

	function _createOpBase(opId: string): {
		status: ReturnType<typeof state<AgentMemoryOperationStatus>>;
		error: ReturnType<typeof state<unknown | undefined>>;
		endedAt: ReturnType<typeof state<number | undefined>>;
	} {
		return {
			status: state<AgentMemoryOperationStatus>("queued", { name: `${name}.op:${opId}.status` }),
			error: state<unknown | undefined>(undefined, { name: `${name}.op:${opId}.error` }),
			endedAt: state<number | undefined>(undefined, { name: `${name}.op:${opId}.endedAt` }),
		};
	}

	_embeddingQueue.on("completed", (job) => {
		const { fact, embedding, scopeTags: tags, batchId, targetId } = job.result as EmbedResult;

		if (targetId) {
			const existing = col.get(targetId);
			if (existing) {
				vi.add(targetId, embedding);
				_embeddings.set(targetId, embedding);
			}
		} else {
			const dedup = checkDedup(vi, embedding, dedupThreshold);

			if (dedup.isDuplicate && dedup.existingId) {
				// Update existing memory
				const existing = col.get(dedup.existingId);
				if (existing) {
					existing.update(fact.content);
					existing.setImportance(Math.max(existing.meta.get().importance, fact.importance));
					for (const t of fact.tags) existing.tag(t);
					for (const t of tags) existing.tag(t);
					_publishEvent("update", dedup.existingId, fact.content, tags);
				}
				vi.add(dedup.existingId, embedding);
				_embeddings.set(dedup.existingId, embedding);
				const opState = _addOpsByBatch.get(batchId);
				if (opState) opState.touchedIds.add(dedup.existingId);
			} else {
				// Add new memory
				const allTags = [...fact.tags, ...tags];
				const node = col.add(fact.content, {
					importance: fact.importance,
					tags: allTags,
				});
				if (node) {
					vi.add(node.id, embedding);
					_embeddings.set(node.id, embedding);
					_publishEvent("add", node.id, fact.content, tags);
					const opState = _addOpsByBatch.get(batchId);
					if (opState) opState.touchedIds.add(node.id);
				}
			}
		}

		const batchState = _addOpsByBatch.get(batchId);
		if (!batchState) return;
		batchState.pending++;
		if (batchState.pending >= batchState.expected) {
			_settleAdd(batchId);
		}
	});

	_embeddingQueue.on("failed", (job) => {
		const batchId = (job.data as EmbedJob).batchId;
		const batchState = _addOpsByBatch.get(batchId);
		if (batchState) {
			batchState.pending++;
			batchState.failed = true;
			if (batchState.pending >= batchState.expected) {
				_settleAdd(batchId);
			}
		}
		if (batchState) {
			batchState.error.set(job.error);
			batchState.status.set("errored");
			batchState.endedAt.set(Date.now());
			_releaseOpId(batchState.op.id);
		}
	});

	function _settleAdd(batchId: number): void {
		const batchState = _addOpsByBatch.get(batchId);
		if (!batchState) return;
		const ids = [...batchState.touchedIds];
		batchState.storedIds.set(ids);
		if (!batchState.failed && batchState.status.get() !== "cancelled") {
			batchState.status.set("completed");
		}
		if (batchState.endedAt.get() === undefined) {
			batchState.endedAt.set(Date.now());
		}
		_releaseOpId(batchState.op.id);
		_addOpsByBatch.delete(batchId);
	}

	// -----------------------------------------------------------------------
	// Wire extraction completion → update status + track facts
	// -----------------------------------------------------------------------
	_extractionQueue.on("completed", (job) => {
		const { facts, scopeTags: tags, batchId } = job.result as ExtractionResult;
		const addState = _addOpsByBatch.get(batchId);
		if (!addState) return;

		if (facts.length === 0) {
			addState.extracted.set([]);
			addState.storedIds.set([]);
			addState.status.set("completed");
			addState.endedAt.set(Date.now());
			_releaseOpId(addState.op.id);
			_addOpsByBatch.delete(batchId);
			return;
		}

		addState.extracted.set(facts);
		addState.status.set("active");
		addState.expected = facts.length;
		addState.pending = 0;
		addState.failed = false;
		for (const fact of facts) {
			_embeddingQueue.add({ fact, scopeTags: tags, batchId });
		}
	});

	_extractionQueue.on("failed", (job) => {
		const data = job.data as ExtractionJob;
		const addState = _addOpsByBatch.get(data.batchId);
		if (!addState) return;
		if (addState.status.get() === "cancelled") {
			if (addState.endedAt.get() === undefined) {
				addState.endedAt.set(Date.now());
			}
			_releaseOpId(addState.op.id);
			_addOpsByBatch.delete(data.batchId);
			return;
		}
		addState.error.set(job.error);
		addState.status.set("errored");
		addState.endedAt.set(Date.now());
		_releaseOpId(addState.op.id);
		_addOpsByBatch.delete(data.batchId);
	});

	// -----------------------------------------------------------------------
	// SA-4d: Wire graph extraction completion → knowledgeGraph
	// -----------------------------------------------------------------------
	if (_graphQueue && kg) {
		const knowledgeGraph = kg;
		// Map entity name → entity ID for relation wiring
		_graphQueue.on("completed", (job) => {
			const result = job.result as GraphExtractionResult;
			const entityIds = new Map<string, string>();

			for (const entity of result.entities) {
				// Check if entity already exists (by name tag)
				const existing = knowledgeGraph.collection.byTag(`entity:${entity.name}`);
				if (existing.length > 0) {
					entityIds.set(entity.name, existing[0].id);
					existing[0].update(entity.content);
				} else {
					const node = knowledgeGraph.addEntity(entity.content, {
						tags: [`entity:${entity.name}`, `type:${entity.type}`, ...entity.tags],
					});
					if (node) {
						entityIds.set(entity.name, node.id);
					}
				}
			}

			for (const rel of result.relations) {
				const sourceId = entityIds.get(rel.source);
				const targetId = entityIds.get(rel.target);
				if (sourceId && targetId) {
					knowledgeGraph.addRelation(sourceId, targetId, rel.type, {
						weight: rel.weight,
					});
				}
			}
		});
		_graphQueue.on("failed", (job) => {
			// Graph extraction failures should not fail add/search operations.
			// Surface via console for now until graph-specific op handles are added.
			console.error(job.error);
		});
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	function add(
		messages: Array<{ role: string; content: string }>,
		scope?: AgentMemoryScope,
		opts?: AgentMemoryAddOptions,
	): AgentMemoryAddOperation {
		const tags = scopeTags(scope);
		const batchId = ++_batchSeq;
		const opId = _reserveOpId(opts?.opId ?? `add-${++_opSeq}`, "add");
		const startedAt = Date.now();
		const base = _createOpBase(opId);

		let seq = -1;
		const extracted = state<ExtractedFact[]>([], { name: `${name}.op:${opId}.extracted` });
		const storedIds = state<string[]>([], { name: `${name}.op:${opId}.storedIds` });
		const op: AgentMemoryAddOperation = {
			id: opId,
			status: base.status,
			error: base.error,
			startedAt,
			endedAt: base.endedAt,
			extracted,
			storedIds,
			cancel: () => {
				if (base.status.get() !== "completed" && base.status.get() !== "errored") {
					base.status.set("cancelled");
					base.endedAt.set(Date.now());
					_releaseOpId(opId);
				}
				if (seq !== -1) _extractionQueue.remove(seq);
			},
		};

		base.status.set("active");
		_addOpsByBatch.set(batchId, {
			op,
			status: base.status,
			error: base.error,
			endedAt: base.endedAt,
			extracted,
			storedIds,
			expected: 0,
			pending: 0,
			failed: false,
			touchedIds: new Set(),
		});
		seq = _extractionQueue.add({ messages, scope, scopeTags: tags, batchId });

		// SA-4d: parallel graph extraction
		if (_graphQueue) {
			_graphQueue.add({ messages, scope });
		}
		return op;
	}

	function search(
		query: string,
		scope?: AgentMemoryScope,
		k = 10,
		opts?: AgentMemorySearchOptions,
	): AgentMemorySearchOperation {
		const opId = _reserveOpId(opts?.opId ?? `search-${++_opSeq}`, "search");
		const startedAt = Date.now();
		const base = _createOpBase(opId);
		const opResults = state<AgentMemorySearchResult[]>([], { name: `${name}.op:${opId}.results` });
		const abort = new AbortController();
		_searchAborts.set(opId, abort);
		const signal = abort.signal;
		const tags = scopeTags(scope);
		base.status.set("active");

		const op: AgentMemorySearchOperation = {
			id: opId,
			status: base.status,
			error: base.error,
			startedAt,
			endedAt: base.endedAt,
			results: opResults,
			cancel: () => {
				abort.abort();
				_searchAborts.delete(opId);
				if (base.status.get() !== "completed" && base.status.get() !== "errored") {
					base.status.set("cancelled");
					base.endedAt.set(Date.now());
					_releaseOpId(opId);
				}
			},
		};

		rawSubscribe(
			rawFromAny(embed(query, signal)),
			(embedding: Float32Array | number[]) => {
				if (signal.aborted) return;

				// SA-4h: configurable overfetch
				const raw = vi.search(embedding, k * searchOverfetch);
				const results: AgentMemorySearchResult[] = [];

				for (const r of raw) {
					if (results.length >= k) break;
					const node = col.get(r.id);
					if (!node) continue;

					// Scope filtering
					if (tags.length > 0 && !matchesScope(node.meta.get().tags, tags)) {
						continue;
					}

					results.push({ node, score: Math.max(0, 1 - r.distance) });
					node.touch();
				}

				opResults.set(results);
				base.status.set("completed");
				base.endedAt.set(Date.now());
				_searchAborts.delete(opId);
				_releaseOpId(opId);
			},
			{
				onEnd: (err?: unknown) => {
					if (err !== undefined && !signal.aborted) {
						base.error.set(err);
						base.status.set("errored");
						base.endedAt.set(Date.now());
						_searchAborts.delete(opId);
						_releaseOpId(opId);
					}
				},
			},
		);
		return op;
	}

	function getAll(scope?: AgentMemoryScope): ReturnType<AgentMemoryResult["getAll"]> {
		const tags = scopeTags(scope);
		if (tags.length === 0) return col.nodes.get();

		// Use the first scope tag for O(1) lookup, then filter rest
		const candidates = col.byTag(tags[0]);
		if (tags.length === 1) return candidates;

		return candidates.filter((node) => matchesScope(node.meta.get().tags, tags));
	}

	function update(id: string, content: string): void {
		const node = col.get(id);
		if (!node) return;

		node.update(content);
		_publishEvent("update", id, content);

		// Re-embed asynchronously via embedding queue
		_embeddingQueue.add({
			fact: { content, importance: node.meta.get().importance, tags: [] },
			scopeTags: [],
			batchId: -1,
			targetId: id,
		});
	}

	function del(id: string): boolean {
		vi.remove(id);
		_embeddings.delete(id);
		const removed = col.remove(id);
		if (removed) {
			_publishEvent("delete", id);
		}
		return removed;
	}

	function destroy(): void {
		for (const abort of _searchAborts.values()) abort.abort();
		_searchAborts.clear();
		_activeOpIds.clear();
		_sharedBridge?.destroy();
		_extractionQueue.destroy();
		_embeddingQueue.destroy();
		_graphQueue?.destroy();
		_events.destroy();
		_persist?.dispose();
		col.destroy();
		vi.destroy();
		_embeddings.clear();
	}

	return {
		add,
		search,
		getAll,
		update,
		delete: del,
		size: col.size,
		inner: {
			collection: col,
			vectorIndex: vi,
			extractionQueue: _extractionQueue,
			embeddingQueue: _embeddingQueue,
			events: _events,
			graphQueue: _graphQueue,
			sharedBridge: _sharedBridge,
		},
		destroy,
	};
}
