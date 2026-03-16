/**
 * Dirty-dep bitmask — safe for any number of deps.
 *
 * ≤32 deps: stores bitmask as a plain number in `_v` (zero overhead).
 * >32 deps: stores bits in a Uint32Array `_w`, with `_v` tracking the
 *   count of set bits for O(1) emptiness checks.
 *
 * In both cases, `empty()` is a single `_v === 0` comparison — no typeof
 * dispatch, no array scan. Method calls on the class prototype are
 * monomorphic (one hidden class for all instances).
 *
 * Used by derived, effect, merge, combine — anywhere dirty-dep tracking
 * needs per-dep bit flags.
 */

export class Bitmask {
	/** Narrow (≤32): bitmask value. Wide (>32): count of set bits. */
	_v: number;
	/** Uint32Array for >32 deps, null otherwise. */
	_w: Uint32Array | null;

	constructor(size: number) {
		this._v = 0;
		this._w = size > 32 ? new Uint32Array(((size - 1) >>> 5) + 1) : null;
	}

	set(i: number): void {
		const w = this._w;
		if (w === null) {
			this._v |= 1 << i;
		} else {
			const idx = i >>> 5;
			const bit = 1 << (i & 31);
			if (!(w[idx] & bit)) {
				w[idx] |= bit;
				this._v++;
			}
		}
	}

	clear(i: number): void {
		const w = this._w;
		if (w === null) {
			this._v &= ~(1 << i);
		} else {
			const idx = i >>> 5;
			const bit = 1 << (i & 31);
			if (w[idx] & bit) {
				w[idx] &= ~bit;
				this._v--;
			}
		}
	}

	test(i: number): boolean {
		const w = this._w;
		if (w === null) return (this._v & (1 << i)) !== 0;
		return (w[i >>> 5] & (1 << (i & 31))) !== 0;
	}

	/** O(1) in both narrow and wide paths. */
	empty(): boolean {
		return this._v === 0;
	}

	reset(): void {
		this._v = 0;
		this._w?.fill(0);
	}
}
