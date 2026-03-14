// ---------------------------------------------------------------------------
// subscribe(store, cb) — listen to value changes
// ---------------------------------------------------------------------------
// Pure callbag sink. Receives type 1 DATA only — no DIRTY awareness.
// Type 3 signals are ignored (subscribe doesn't participate in state mgmt).
// ---------------------------------------------------------------------------

import { beginDeferredStart, END, endDeferredStart, START } from "./protocol";
import type { Store } from "./types";

export function subscribe<T>(
	store: Store<T>,
	cb: (value: T, prev: T | undefined) => void,
): () => void {
	let talkback: ((type: number) => void) | null = null;

	beginDeferredStart();

	store.source(START, (type: number, data: any) => {
		if (type === START) talkback = data;
		if (type === END) {
			talkback = null;
			return;
		}
		// Equality check is intentional: suppresses duplicate emissions (e.g. a
		// state store that set() was called on with an equal value, or a batch that
		// coalesced multiple sets back to the original value).
		if (type === 1 /* DATA */) {
			const next = data as T;
			if (!Object.is(next, prev)) {
				const p = prev;
				prev = next;
				cb(next, p);
			}
		}
	});

	// Read initial value — sets prev baseline
	let prev: T | undefined = store.get();

	endDeferredStart();

	return () => talkback?.(END);
}
