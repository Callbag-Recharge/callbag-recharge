// ---------------------------------------------------------------------------
// withMeta — reactive companion stores projecting protocol events
// ---------------------------------------------------------------------------
// Creates independently-subscribable companion stores for any source:
// emission count, last value, ended, and error. All derived from a single
// external subscription — no hot-path intrusion.
//
// Usage:
//   const meta = withMeta(myStore);
//   meta.count.get()     // 0
//   myState.set(5);
//   meta.count.get()     // 1
//   meta.lastValue.get() // 5
//   meta.dispose();
// ---------------------------------------------------------------------------

import { DATA, END, START } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";

export interface MetaResult<T> {
	/** Emission count (increments on each DATA). */
	count: Store<number>;
	/** Last emitted value (independently subscribable). */
	lastValue: Store<T | undefined>;
	/** Whether the store has ended (completed or errored). */
	ended: Store<boolean>;
	/** Error payload if ended with error, undefined otherwise. */
	error: Store<unknown>;
	/** Dispose the subscription powering these companion stores. */
	dispose: () => void;
}

/**
 * Creates reactive companion stores that project protocol events from a source.
 * All companions update via a single external subscription — zero intrusion.
 *
 * @param store - Any Store to observe.
 * @param opts - Optional configuration.
 *
 * @returns `MetaResult<T>` — companion stores + dispose.
 *
 * @example
 * ```ts
 * import { withMeta } from 'callbag-recharge/utils';
 *
 * const meta = withMeta(myStore);
 * effect([meta.count], () => console.log('emissions:', meta.count.get()));
 * ```
 *
 * @category utils
 */
export function withMeta<T>(store: Store<T>, opts?: { name?: string }): MetaResult<T> {
	const prefix = opts?.name ?? "meta";
	const _count = state(0, { name: `${prefix}.count` });
	const _lastValue = state<T | undefined>(undefined, { name: `${prefix}.lastValue` });
	const _ended = state(false, { name: `${prefix}.ended` });
	const _error = state<unknown>(undefined, { name: `${prefix}.error` });

	let talkback: ((type: number) => void) | null = null;

	store.source(START, (type: number, data: any) => {
		if (type === START) {
			talkback = data;
			return;
		}
		if (type === DATA) {
			_count.update((n) => n + 1);
			_lastValue.set(data);
		} else if (type === END) {
			_ended.set(true);
			if (data !== undefined) _error.set(data);
			talkback = null;
		}
	});

	return {
		count: _count as Store<number>,
		lastValue: _lastValue as Store<T | undefined>,
		ended: _ended as Store<boolean>,
		error: _error as Store<unknown>,
		dispose: () => talkback?.(END),
	};
}
