// ---------------------------------------------------------------------------
// subscribe(store, cb) — listen to value changes
// ---------------------------------------------------------------------------
// v2: Receives values through callbag sinks (two-phase push)
// - Phase 1 (DIRTY): mark pending
// - Phase 2 (value): capture value, enqueue callback
// ---------------------------------------------------------------------------

import {
	beginDeferredStart,
	DATA,
	DIRTY,
	END,
	endDeferredStart,
	enqueueEffect,
	START,
} from "./protocol";
import type { Store } from "./types";

export function subscribe<T>(
	store: Store<T>,
	cb: (value: T, prev: T | undefined) => void,
): () => void {
	let talkback: ((type: number) => void) | null = null;
	let pending = false;

	beginDeferredStart();

	// Connect sink — receives DIRTY (phase 1) and values (phase 2)
	store.source(START, (type: number, data: any) => {
		if (type === START) talkback = data;
		if (type === END) {
			talkback = null;
			return;
		}
		if (type === DATA) {
			if (data === DIRTY) {
				pending = true;
			} else if (pending) {
				// Phase 2: value arrived
				pending = false;
				const next = data as T;
				enqueueEffect(() => {
					if (!Object.is(next, prev)) {
						const p = prev;
						prev = next;
						cb(next, p);
					}
				});
			}
		}
	});

	// Read initial value
	let prev: T = store.get();

	// Start queued producers now that the chain is fully wired
	endDeferredStart();

	return () => talkback?.(END);
}
