// ---------------------------------------------------------------------------
// subscribe(store, cb) — listen to value changes
// ---------------------------------------------------------------------------
// Connects as a callbag sink. Deferred like effects to avoid glitches.
// Uses beginDeferredStart/endDeferredStart so that stream producers only
// start after the full sink chain is wired (Option A + C).
// ---------------------------------------------------------------------------

import {
	DATA,
	DIRTY,
	END,
	START,
	beginDeferredStart,
	endDeferredStart,
	enqueueEffect,
} from "./protocol";
import type { Store } from "./types";

export function subscribe<T>(
	store: Store<T>,
	cb: (value: T, prev: T | undefined) => void,
): () => void {
	let talkback: ((type: number) => void) | null = null;
	let pending = false;

	beginDeferredStart();

	// Option A: connect sink FIRST, so it receives DIRTY from producers
	store.source(START, (type: number, data: any) => {
		if (type === START) talkback = data;
		if (type === END) {
			talkback = null;
			return;
		}
		if (type === DATA && data === DIRTY) {
			if (!pending) {
				pending = true;
				enqueueEffect(() => {
					pending = false;
					const next = store.get();
					if (!Object.is(next, prev)) {
						const p = prev;
						prev = next;
						cb(next, p);
					}
				});
			}
		}
	});

	// Then read initial value — may trigger connectUpstream → deferStart
	let prev: T = store.get();

	// Option C: start queued producers now that the chain is fully wired
	endDeferredStart();

	return () => talkback?.(END);
}
