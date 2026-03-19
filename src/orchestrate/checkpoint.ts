// ---------------------------------------------------------------------------
// checkpoint — durable step boundary
// ---------------------------------------------------------------------------
// Persists values on emit, skips to saved state on recovery. Pluggable
// adapter for storage backend (memory, localStorage, file, etc.).
//
// Usage:
//   const adapter = memoryAdapter();
//   const durable = pipe(source, checkpoint("step-1", adapter));
//   // On re-subscribe: if adapter has saved value for "step-1",
//   // that value is emitted immediately and upstream values before it are skipped.
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";

export interface CheckpointAdapter {
	/** Save a value for the given checkpoint id. May be sync or async. */
	save(id: string, value: unknown): void | Promise<void>;
	/** Load a previously saved value. Returns undefined if none exists. */
	load(id: string): unknown | undefined | Promise<unknown | undefined>;
	/** Clear a saved checkpoint. */
	clear(id: string): void | Promise<void>;
}

export interface CheckpointMeta {
	/** Whether this checkpoint has a saved value. */
	recovered: boolean;
	/** Number of values persisted through this checkpoint. */
	persistCount: number;
	/** The checkpoint id. */
	id: string;
}

export interface CheckpointedStore<A> extends Store<A | undefined> {
	/** Observable checkpoint metadata. */
	meta: Store<CheckpointMeta>;
	/** Clear the saved checkpoint value. */
	clear(): void;
}

/** Safely handle a potentially async adapter operation (fire-and-forget). */
function safeAsync(result: void | Promise<void>) {
	if (result instanceof Promise) {
		result.catch(() => {});
	}
}

/**
 * Durable step boundary. Persists values on emit, recovers saved state on re-subscribe (Tier 2).
 *
 * @param id - Unique checkpoint identifier for persistence.
 * @param adapter - Storage adapter implementing save/load/clear.
 * @param opts - Optional configuration.
 *
 * @returns `StoreOperator<A, A>` — pipe-compatible. The returned store has a `meta` property and `clear()` method.
 *
 * @returnsTable get() | () => A \| undefined | Last checkpointed value.
 * meta | Store\<CheckpointMeta\> | Reactive metadata: recovered, persistCount, id.
 * clear() | () => void | Clear the saved checkpoint value.
 * source | callbag | Underlying callbag source for subscriptions.
 *
 * @remarks **Tier 2:** Cycle boundary — each persisted value starts a new DIRTY+value cycle.
 * @remarks **Recovery:** On subscribe, loads saved value from adapter. If found, emits it immediately before forwarding upstream values.
 * @remarks **Async load buffering:** Upstream values during async load are buffered and replayed after recovery.
 * @remarks **Pluggable:** Any adapter implementing `{ save, load, clear }` works. Ships with `memoryAdapter()`.
 *
 * @example
 * ```ts
 * import { state, pipe, subscribe } from 'callbag-recharge';
 * import { checkpoint, memoryAdapter } from 'callbag-recharge/orchestrate';
 *
 * const adapter = memoryAdapter();
 * const source = state(0);
 * const durable = pipe(source, checkpoint("step-1", adapter));
 * subscribe(durable, v => console.log(v));
 * source.set(42); // persisted to adapter under "step-1"
 * // On next subscribe: 42 is emitted immediately from adapter
 * ```
 *
 * @seeAlso [track](./track) — lifecycle metadata, [pipeline](./pipeline) — workflow builder
 *
 * @category orchestrate
 */
export function checkpoint<A>(
	id: string,
	adapter: CheckpointAdapter,
	opts?: { name?: string },
): (input: Store<A>) => CheckpointedStore<A> {
	return (input: Store<A>): CheckpointedStore<A> => {
		const baseName = opts?.name ?? `checkpoint:${id}`;

		const meta = state<CheckpointMeta>(
			{ recovered: false, persistCount: 0, id },
			{ name: `${baseName}:meta`, equals: () => false },
		);

		const store = producer<A>(
			({ emit, error, complete }) => {
				let persistCount = 0;
				let active = true;
				let loadResolved = false;
				const buffer: A[] = [];
				let upstreamEnded: { err: unknown } | null = null;

				// Subscribe to upstream immediately — buffer during async load
				const unsub = subscribe(
					input,
					(v) => {
						if (!loadResolved) {
							buffer.push(v);
							return;
						}
						persistCount++;
						meta.set({ recovered: meta.get().recovered, persistCount, id });
						safeAsync(adapter.save(id, v));
						emit(v);
					},
					{
						onEnd: (err) => {
							if (!loadResolved) {
								upstreamEnded = { err };
								return;
							}
							if (err !== undefined) error(err);
							else complete();
						},
					},
				);

				function finishLoad(recovered: boolean) {
					if (!active) return;
					loadResolved = true;
					meta.set({ recovered, persistCount, id });

					// Replay buffered upstream values
					for (const v of buffer) {
						if (!active) break;
						persistCount++;
						meta.set({ recovered, persistCount, id });
						safeAsync(adapter.save(id, v));
						emit(v);
					}
					buffer.length = 0;

					// Forward any upstream end that arrived during load
					if (upstreamEnded) {
						if (upstreamEnded.err !== undefined) error(upstreamEnded.err);
						else complete();
					}
				}

				// Recovery: try to load saved value
				const loaded = adapter.load(id);

				if (loaded instanceof Promise) {
					loaded.then(
						(saved) => {
							if (!active) return;
							if (saved !== undefined) {
								emit(saved as A);
								finishLoad(true);
							} else {
								finishLoad(false);
							}
						},
						() => {
							if (!active) return;
							finishLoad(false);
						},
					);
				} else {
					if (loaded !== undefined) {
						emit(loaded as A);
						finishLoad(true);
					} else {
						finishLoad(false);
					}
				}

				return () => {
					active = false;
					buffer.length = 0;
					unsub();
				};
			},
			{ name: baseName, kind: "checkpoint" },
		);

		Inspector.register(store, { kind: "checkpoint" });

		const checkpointed = store as unknown as CheckpointedStore<A>;
		Object.defineProperties(checkpointed, {
			meta: { value: meta, enumerable: true },
			clear: {
				value() {
					// Always clear directly — works whether producer is active or not
					safeAsync(adapter.clear(id));
				},
				enumerable: true,
			},
		});

		return checkpointed;
	};
}

// ---------------------------------------------------------------------------
// Built-in adapters
// ---------------------------------------------------------------------------

/**
 * In-memory checkpoint adapter. Data lives in a Map and is lost on process exit.
 * Useful for testing and development.
 */
export function memoryAdapter(): CheckpointAdapter {
	const store = new Map<string, unknown>();
	return {
		save(id, value) {
			store.set(id, value);
		},
		load(id) {
			return store.has(id) ? store.get(id) : undefined;
		},
		clear(id) {
			store.delete(id);
		},
	};
}
