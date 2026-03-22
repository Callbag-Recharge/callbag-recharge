// ---------------------------------------------------------------------------
// Raw subscribe — pure callbag sink
// ---------------------------------------------------------------------------
// Connects to a raw callbag source function. No Store, no deferred start,
// no prev tracking. This is the lowest-level subscribe in the library.
// Higher layers (core/subscribe) add Store-awareness on top.
// ---------------------------------------------------------------------------

/** A raw callbag source: (type, payload?) => void */
export type CallbagSource = (type: number, payload?: any) => void;

/**
 * Subscribes to a raw callbag source. Calls `cb` on each DATA (type 1)
 * emission. Returns an object with `unsubscribe()` to disconnect.
 *
 * @param source - A raw callbag source function.
 * @param cb - Called with each emitted value.
 * @param opts - Optional `onEnd` when the stream completes or errors.
 *
 * @returns `{ unsubscribe() }` to disconnect from the source.
 *
 * @category raw
 */
export function rawSubscribe<T = any>(
	source: CallbagSource,
	cb: (value: T) => void,
	opts?: { onEnd?: (error?: unknown) => void },
): { unsubscribe(): void } {
	let talkback: ((type: number, data?: any) => void) | null = null;

	source(0 /* START */, (type: number, data: any) => {
		if (type === 0 /* START */) {
			talkback = data;
			return;
		}
		if (type === 2 /* END */) {
			talkback = null;
			opts?.onEnd?.(data);
			return;
		}
		if (type === 1 /* DATA */) {
			cb(data as T);
		}
	});

	return {
		unsubscribe() {
			talkback?.(2 /* END */);
			talkback = null;
		},
	};
}
