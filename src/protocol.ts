// ---------------------------------------------------------------------------
// Protocol — DIRTY symbol and two-phase propagation
// ---------------------------------------------------------------------------
// Phase 1: source of change sends DIRTY inline through callbag sinks
//          (synchronous depth-first — returns when all downstream notified)
// Phase 2: source triggers value emission (queued emitters drain)
// Effects run after phase 2 completes (all values settled)
//
// No global depth counter — DIRTY propagation is synchronous, so when the
// inline loop returns to the source, phase 1 is complete. Only `batch()`
// defers phase 2 via `batchDepth`.
// ---------------------------------------------------------------------------

/** Sentinel value pushed via type 1 to indicate invalidation, not data */
export const DIRTY = Symbol("DIRTY");

/** Callbag signal types */
export const START = 0;
export const DATA = 1;
export const END = 2;

// ---------------------------------------------------------------------------
// Two-phase propagation
// ---------------------------------------------------------------------------

let batchDepth = 0;
const pending: Array<() => void> = [];
let flushing = false;

// Phase 2: value emission queue
const pendingValueEmitters: Array<() => void> = [];
let emittingValues = false;

/**
 * Queue a value emission for phase 2.
 */
function queueValueEmission(fn: () => void): void {
	pendingValueEmitters.push(fn);
}

/**
 * Two-phase change: queue value emission, send DIRTY inline, trigger phase 2.
 * The single API for any source of change (state, stream, extras).
 */
export function pushChange(sinks: Set<any>, getValue: () => any): void {
	queueValueEmission(() => {
		const v = getValue();
		for (const sink of sinks) sink(DATA, v);
	});
	// Phase 1: DIRTY propagates synchronously through the graph
	for (const sink of sinks) sink(DATA, DIRTY);
	// When control returns here, all downstream nodes have received DIRTY.
	if (batchDepth === 0 && !emittingValues) runPhase2AndFlush();
}

/**
 * Schedule a callback (effect/subscriber) to run after value propagation.
 * If not inside propagation or value emission, runs immediately.
 */
export function enqueueEffect(run: () => void): void {
	if (batchDepth === 0 && !flushing && !emittingValues) {
		run();
	} else {
		pending.push(run);
	}
}

/**
 * Run phase 2 (drain value emitters) then flush effects.
 */
function runPhase2AndFlush(): void {
	if (emittingValues) return;
	emittingValues = true;
	// Drain value emission queue — new entries may be appended during processing
	for (let i = 0; i < pendingValueEmitters.length; i++) {
		pendingValueEmitters[i]();
	}
	pendingValueEmitters.length = 0;
	emittingValues = false;
	flush();
}

function flush(): void {
	if (flushing) return;
	flushing = true;
	// Process queue — effects may trigger new state changes
	// which enqueue more effects, so loop until empty
	for (let i = 0; i < pending.length; i++) {
		pending[i]();
	}
	pending.length = 0;
	flushing = false;
}

/**
 * Batch multiple state changes — phase 2 and effects run only when the outermost batch ends.
 */
export function batch<T>(fn: () => T): T {
	batchDepth++;
	try {
		return fn();
	} finally {
		batchDepth--;
		if (batchDepth === 0 && !emittingValues) runPhase2AndFlush();
	}
}

// ---------------------------------------------------------------------------
// Connection batching (producer start deferral)
// ---------------------------------------------------------------------------
// During subscribe/effect setup, producer starts are queued so that the
// entire sink chain is wired before any data flows. This prevents
// synchronous producers (e.g. fromIter) from emitting into an incomplete
// pipeline.
// ---------------------------------------------------------------------------

let connectDepth = 0;
const pendingStarts: Array<() => void> = [];

/** Enter a connection phase — producer starts will be queued. */
export function beginDeferredStart(): void {
	connectDepth++;
}

/** Exit a connection phase — if outermost, start all queued producers. */
export function endDeferredStart(): void {
	connectDepth--;
	if (connectDepth === 0) {
		while (pendingStarts.length > 0) {
			const start = pendingStarts.shift();
			if (start) start();
		}
	}
}

/**
 * Start a producer, or queue it if inside a connection phase.
 * Called by stream.source() instead of starting the producer directly.
 */
export function deferStart(start: () => void): void {
	if (connectDepth > 0) {
		pendingStarts.push(start);
	} else {
		start();
	}
}
