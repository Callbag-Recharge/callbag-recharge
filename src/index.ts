// ---------------------------------------------------------------------------
// callbag-recharge — reactive stores connected by callbag protocol
// ---------------------------------------------------------------------------

export { derived } from "./core/derived";
export type { TrackingFn } from "./core/dynamicDerived";
export { dynamicDerived } from "./core/dynamicDerived";
export { effect } from "./core/effect";
export type { ObserveResult, TraceEntry } from "./core/inspector";
// Observability
export { Inspector } from "./core/inspector";
// General-purpose transform primitive
export { operator } from "./core/operator";
// Operators & piping
export { pipe } from "./core/pipe";
// General-purpose source primitive
export { producer } from "./core/producer";
export type { LifecycleSignal, NodeStatus, Subscription } from "./core/protocol";
// Protocol (for advanced use / interop)
export {
	batch,
	beginDeferredStart,
	DATA,
	DIRTY,
	deferEmission,
	deferStart,
	END,
	endDeferredStart,
	isBatching,
	isLifecycleSignal,
	PAUSE,
	RESET,
	RESOLVED,
	RESUME,
	START,
	STATE,
	TEARDOWN,
	teardown,
} from "./core/protocol";
// Core primitives
export { state } from "./core/state";

// Subscribe
export { subscribe } from "./core/subscribe";

// Types
export type {
	Actions,
	ProducerStore,
	Store,
	StoreOperator,
	StoreOptions,
	WritableStore,
} from "./core/types";
