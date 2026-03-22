// ---------------------------------------------------------------------------
// fromNodeCallback — raw callbag source for one-shot Node.js event callbacks
// ---------------------------------------------------------------------------
// Wraps the common Node.js pattern of emitter.once("success") / emitter.once("error")
// into a raw callbag source. Emits once on success, sends END with error on failure.
// ---------------------------------------------------------------------------

import type { CallbagSource } from "./subscribe";

/**
 * Creates a raw callbag source from a Node.js-style one-shot callback.
 * The `setup` function receives `resolve` and `reject` callbacks — call
 * one when the operation completes. Returns an optional cleanup function.
 *
 * Unlike `new Promise`, this participates in the callbag protocol:
 * the sink can send END to cancel, which triggers cleanup.
 *
 * @param setup - `(resolve, reject) => cleanup?`
 *
 * @category raw
 */
export function fromNodeCallback<T = void>(
	setup: (resolve: (value: T) => void, reject: (error: unknown) => void) => (() => void) | void,
): CallbagSource {
	return (type: number, sink?: any) => {
		if (type !== 0) return;

		let done = false;
		let teardown: (() => void) | void;

		sink(0, (t: number) => {
			if (t === 2 && !done) {
				done = true;
				teardown?.();
			}
		});

		try {
			teardown = setup(
				(value: T) => {
					if (done) return;
					done = true;
					sink(1, value);
					sink(2);
				},
				(error: unknown) => {
					if (done) return;
					done = true;
					sink(2, error);
				},
			);
		} catch (err) {
			if (!done) {
				done = true;
				sink(2, err);
			}
		}
	};
}
