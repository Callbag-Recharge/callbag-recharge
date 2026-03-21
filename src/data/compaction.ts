// ---------------------------------------------------------------------------
// compaction — log compaction for reactiveLog
// ---------------------------------------------------------------------------
// Retains only the latest entry per key, discarding older entries.
// Composable — doesn't modify ReactiveLog's interface. Attaches to a log
// and provides manual + auto-triggered compaction.
//
// Usage:
//   const log = reactiveLog<{ id: string; value: number }>();
//   const c = compaction(log, entry => entry.id, { threshold: 100 });
//   log.append({ id: "a", value: 1 });
//   log.append({ id: "a", value: 2 });
//   c.compact(); // keeps only { id: "a", value: 2 }
// ---------------------------------------------------------------------------

import { subscribe } from "../core/subscribe";
import type { ReactiveLog } from "./types";

export interface CompactionOptions {
	/** Auto-compact when entry count reaches this threshold. 0 = manual only (default). */
	threshold?: number;
}

export interface CompactionResult<_V> {
	/** Manually trigger compaction. Returns number of entries removed. */
	compact(): number;
	/** Stop auto-compaction (unsubscribe from log events). */
	destroy(): void;
}

/**
 * Composable log compaction — retains only the latest entry per key.
 *
 * @param log - The reactiveLog to compact.
 * @param keyFn - Function that extracts a dedup key from each entry value.
 * @param opts - Optional configuration.
 *
 * @returns `CompactionResult<V>` — `compact()` for manual trigger, `destroy()` to stop auto-compaction.
 *
 * @remarks **Composable:** Does not modify the ReactiveLog interface. Attaches externally and operates on the log's public API.
 * @remarks **Compaction semantics:** For each key, only the entry with the highest sequence number is retained. All older entries for that key are discarded.
 * @remarks **Implementation:** Reads all entries via `toArray()`, deduplicates, then `clear()` + `appendMany()` to rebuild. Sequence numbers are reassigned (compaction is a structural rewrite).
 * @remarks **Auto-trigger:** Set `threshold` to auto-compact when entry count reaches the threshold. Checked on every append event.
 *
 * @example
 * ```ts
 * import { reactiveLog } from 'callbag-recharge/data';
 * import { compaction } from 'callbag-recharge/data';
 *
 * const log = reactiveLog<{ id: string; v: number }>();
 * const c = compaction(log, e => e.id);
 * log.append({ id: "a", v: 1 });
 * log.append({ id: "b", v: 2 });
 * log.append({ id: "a", v: 3 });
 * c.compact(); // removes first "a" entry, keeps { id: "a", v: 3 } and { id: "b", v: 2 }
 * ```
 *
 * @category data
 */
export function compaction<V>(
	log: ReactiveLog<V>,
	keyFn: (value: V) => string,
	opts?: CompactionOptions,
): CompactionResult<V> {
	const threshold = opts?.threshold ?? 0;
	let unsub: (() => void) | null = null;
	let compacting = false;

	function compact(): number {
		if (compacting) return 0;
		const entries = log.toArray();
		if (entries.length === 0) return 0;

		// Keep only the latest entry per key (last occurrence wins)
		const seen = new Map<string, V>();
		const order: string[] = [];
		for (const entry of entries) {
			const key = keyFn(entry.value);
			if (!seen.has(key)) {
				order.push(key);
			}
			seen.set(key, entry.value);
		}

		const compacted = order.map((key) => seen.get(key)!);
		const removed = entries.length - compacted.length;
		if (removed === 0) return 0;

		// Rebuild: clear + appendMany in one operation
		compacting = true;
		try {
			log.clear();
			log.appendMany(compacted);
		} finally {
			compacting = false;
		}

		return removed;
	}

	// Auto-compaction via event subscription
	if (threshold > 0) {
		unsub = subscribe(log.events, (event) => {
			if (event?.type === "append" && log.length >= threshold) {
				compact();
			}
		});
	}

	return {
		compact,
		destroy(): void {
			unsub?.();
			unsub = null;
		},
	};
}
