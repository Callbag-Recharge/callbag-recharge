// ---------------------------------------------------------------------------
// Protocol — v3 type 3 control channel
// ---------------------------------------------------------------------------
// Type 3 (STATE) carries control signals: DIRTY, RESOLVED
// Type 1 (DATA) carries only real values — never sentinels
// ---------------------------------------------------------------------------

/** Control signal: "my value is about to change" */
export const DIRTY = Symbol("DIRTY");

/** Control signal: "I was dirty but my value didn't change" */
export const RESOLVED = Symbol("RESOLVED");

export type Signal = typeof DIRTY | typeof RESOLVED;

/** ADOPT protocol — topology handoff signals (v4) */
export const REQUEST_ADOPT = Symbol("REQUEST_ADOPT");
export const GRANT_ADOPT = Symbol("GRANT_ADOPT");

/** Node status — tracks current lifecycle state (v4) */
export type NodeStatus =
	| "DISCONNECTED"
	| "DIRTY"
	| "SETTLED"
	| "RESOLVED"
	| "COMPLETED"
	| "ERRORED";

/** Callbag signal types */
export const START = 0;
export const DATA = 1;
export const END = 2;
export const STATE = 3;

// ---------------------------------------------------------------------------
// Batch — defers type 1 value emissions; type 3 DIRTY propagates immediately
// ---------------------------------------------------------------------------

let batchDepth = 0;
const deferredEmissions: Array<() => void> = [];

// `draining` prevents re-entrant drain when a nested batch() call ends while
// the outer drain loop is already running. Without it, the inner batch's
// finally block would see batchDepth===0 and start a second drain, racing the
// outer loop — potentially double-processing items or clearing the array mid-
// iteration. With draining=true, the inner batch skips its drain; any items it
// pushes are picked up by the outer loop (the `for` condition re-evaluates
// `deferredEmissions.length` on every iteration, so appends during drain are
// naturally included in the same pass).
let draining = false;

export function batch<T>(fn: () => T): T {
	batchDepth++;
	try {
		return fn();
	} finally {
		batchDepth--;
		if (batchDepth === 0 && !draining) {
			draining = true;
			for (let i = 0; i < deferredEmissions.length; i++) {
				deferredEmissions[i]();
			}
			deferredEmissions.length = 0;
			draining = false;
		}
	}
}

export function isBatching(): boolean {
	return batchDepth > 0;
}

export function deferEmission(fn: () => void): void {
	deferredEmissions.push(fn);
}

// ---------------------------------------------------------------------------
// Connection batching (producer start deferral) — unchanged from v2
// ---------------------------------------------------------------------------

let connectDepth = 0;
const pendingStarts: Array<() => void> = [];

export function beginDeferredStart(): void {
	connectDepth++;
}

export function endDeferredStart(): void {
	connectDepth--;
	if (connectDepth === 0) {
		for (let i = 0; i < pendingStarts.length; i++) {
			pendingStarts[i]();
		}
		pendingStarts.length = 0;
	}
}

export function deferStart(start: () => void): void {
	if (connectDepth > 0) {
		pendingStarts.push(start);
	} else {
		start();
	}
}
