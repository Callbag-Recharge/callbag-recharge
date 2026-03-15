/**
 * Side-effect runner. Connects eagerly to deps on creation, runs fn() inline
 * when all dirty deps resolve. Returns a dispose function.
 *
 * Stateless: does not produce a store. No cached value or get().
 *
 * v3: type 3 dirty tracking across deps. Skips execution when all deps sent
 * RESOLVED (no value changed). Effects run as part of the callbag signal
 * flow — no enqueueEffect.
 *
 * Class-based for V8 hidden class optimization and prototype method sharing.
 */

import {
	beginDeferredStart,
	DATA,
	DIRTY,
	END,
	endDeferredStart,
	RESOLVED,
	START,
	STATE,
} from "./protocol";
import type { Store } from "./types";

export class EffectImpl {
	_deps: Store<unknown>[];
	_fn: () => undefined | (() => void);
	_cleanup: (() => void) | undefined;
	_talkbacks: Array<(type: number) => void> = [];
	_disposed = false;
	_dirtyDeps = 0;
	_anyDataReceived = false;

	constructor(deps: Store<unknown>[], fn: () => undefined | (() => void)) {
		this._deps = deps;
		this._fn = fn;

		beginDeferredStart();

		this._run();

		for (let i = 0; i < deps.length; i++) {
			const depBit = 1 << i;
			deps[i].source(START, (type: number, data: any) => {
				if (type === START) {
					this._talkbacks.push(data);
					return;
				}
				if (type === STATE) {
					if (data === DIRTY) {
						if (!this._disposed) {
							if (this._dirtyDeps === 0) this._anyDataReceived = false;
							this._dirtyDeps |= depBit;
						}
					} else if (data === RESOLVED) {
						if (this._dirtyDeps & depBit) {
							this._dirtyDeps &= ~depBit;
							if (this._dirtyDeps === 0 && !this._disposed) {
								if (this._anyDataReceived) this._run();
								// else: all deps RESOLVED, skip
							}
						}
					}
				}
				if (type === DATA) {
					if (this._dirtyDeps & depBit) {
						this._dirtyDeps &= ~depBit;
						this._anyDataReceived = true;
						if (this._dirtyDeps === 0 && !this._disposed) {
							this._run();
						}
					}
				}
			});
		}

		endDeferredStart();
	}

	_run(): void {
		if (this._disposed) return;
		if (this._cleanup) this._cleanup();
		this._cleanup = this._fn();
	}

	dispose(): void {
		if (this._disposed) return;
		this._disposed = true;
		if (this._cleanup) this._cleanup();
		this._cleanup = undefined;
		for (const tb of this._talkbacks) tb(END);
		this._talkbacks.length = 0;
	}
}

export function effect(deps: Store<unknown>[], fn: () => undefined | (() => void)): () => void {
	const impl = new EffectImpl(deps, fn);
	return () => impl.dispose();
}
