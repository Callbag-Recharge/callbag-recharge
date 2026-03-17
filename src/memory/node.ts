// ---------------------------------------------------------------------------
// Phase 1: MemoryNode — reactive unit of memory
// ---------------------------------------------------------------------------
// A MemoryNode wraps content + metadata in reactive stores.
// Content is a WritableStore<T>, metadata is a WritableStore<MemoryMeta>.
// Score is a derived store that recomputes when metadata changes.
//
// Design decisions:
// - Meta is a single WritableStore<MemoryMeta> (not individual fields) to
//   minimize store count per node. Meta mutations use update() for atomicity.
// - Score is derived from meta — push-based, auto-invalidates on any meta change.
// - touch() is the primary access pattern for agents reading memories.
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store, WritableStore } from "../core/types";
import { computeScore } from "./decay";
import type {
	MemoryMeta,
	MemoryNode as MemoryNodeInterface,
	MemoryNodeOptions,
	ScoreWeights,
} from "./types";

let nodeCounter = 0;

function generateId(): string {
	return `mem-${++nodeCounter}-${Date.now().toString(36)}`;
}

export function memoryNode<T>(initialContent: T, opts?: MemoryNodeOptions): MemoryNodeInterface<T> {
	const id = opts?.id ?? generateId();
	const now = Date.now();

	const initialMeta: MemoryMeta = {
		id,
		createdAt: now,
		updatedAt: now,
		accessedAt: now,
		accessCount: 0,
		importance: opts?.importance ?? 0.5,
		tags: new Set(opts?.tags),
	};

	const _content: WritableStore<T> = state<T>(initialContent, {
		name: `mem:${id}:content`,
	});
	const _meta: WritableStore<MemoryMeta> = state<MemoryMeta>(initialMeta, {
		name: `mem:${id}:meta`,
		// Always emit on meta changes (Set comparison would fail with Object.is)
		equals: () => false,
	});

	// Default score weights — can be overridden per-call
	const defaultWeights: ScoreWeights = {};

	const _scoreStore: Store<number> = derived(
		[_meta],
		() => computeScore(_meta.get(), defaultWeights),
		{ name: `mem:${id}:score` },
	);

	const node: MemoryNodeInterface<T> = {
		id,
		content: _content,
		meta: _meta as Store<MemoryMeta>,
		scoreStore: _scoreStore,

		touch(): void {
			const now = Date.now();
			_meta.update((m) => ({
				...m,
				accessedAt: now,
				accessCount: m.accessCount + 1,
			}));
		},

		tag(...tags: string[]): void {
			_meta.update((m) => {
				const next = new Set(m.tags);
				for (const t of tags) next.add(t);
				return { ...m, tags: next, updatedAt: Date.now() };
			});
		},

		untag(...tags: string[]): void {
			_meta.update((m) => {
				const next = new Set(m.tags);
				for (const t of tags) next.delete(t);
				return { ...m, tags: next, updatedAt: Date.now() };
			});
		},

		setImportance(value: number): void {
			_meta.update((m) => ({
				...m,
				importance: Math.max(0, Math.min(1, value)),
				updatedAt: Date.now(),
			}));
		},

		update(value: T): void {
			batch(() => {
				_content.set(value);
				_meta.update((m) => ({ ...m, updatedAt: Date.now() }));
			});
		},

		score(weights?: ScoreWeights): number {
			return computeScore(_meta.get(), weights ?? defaultWeights);
		},

		destroy(): void {
			teardown(_content);
			teardown(_meta);
		},
	};

	return node;
}
