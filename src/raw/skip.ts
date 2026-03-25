import type { CallbagSource } from "./subscribe";

/**
 * Raw callbag operator that ignores the first `n` DATA emissions from `source`,
 * then forwards the rest. Operates at the pure callbag protocol level (type 0/1/2)
 * — no Store or STATE (type 3) handling.
 *
 * Intended for use with `firstValueFrom` when you need to wait for the *next*
 * emission from a source that has already emitted an initial value:
 *
 * ```ts
 * await firstValueFrom(rawSkip(1)(store.source));
 * ```
 *
 * For Store-aware skipping (with DIRTY/RESOLVED graph consistency), use
 * `extra/skip` instead.
 *
 * @param n - Number of initial DATA emissions to drop.
 *
 * @returns A function `(source: CallbagSource) => CallbagSource`.
 *
 * @category raw
 */
export function rawSkip(n: number): (source: CallbagSource) => CallbagSource {
	if (!Number.isFinite(n) || n < 0) {
		throw new RangeError("rawSkip: n must be a non-negative finite number");
	}
	return (source: CallbagSource): CallbagSource => {
		return (startType: number, sink: any) => {
			if (startType !== 0) return;
			let emitted = 0;
			let talkback: ((type: number, data?: any) => void) | null = null;

			source(0, (type: number, data: any) => {
				if (type === 0) {
					talkback = data;
					sink(0, (t: number, d?: any) => {
						talkback?.(t, d);
					});
					return;
				}
				if (type === 1) {
					emitted++;
					if (emitted > n) sink(1, data);
					return;
				}
				// type 2 (END) and anything else — forward to sink
				sink(type, data);
			});
		};
	};
}
