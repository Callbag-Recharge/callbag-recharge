// ---------------------------------------------------------------------------
// callbag-recharge — reactive stores connected by callbag protocol
// ---------------------------------------------------------------------------

export { derived } from "./core/derived";
export { effect } from "./core/effect";
export type { ObserveResult } from "./core/inspector";
// Observability
export { Inspector } from "./core/inspector";
// General-purpose transform primitive
export { operator } from "./core/operator";
// Operators & piping
export { pipe } from "./core/pipe";
// General-purpose source primitive
export { producer } from "./core/producer";
export type { NodeStatus } from "./core/protocol";
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
	RESOLVED,
	START,
	STATE,
	teardown,
} from "./core/protocol";
// Core primitives
export { state } from "./core/state";

// Types
export type {
	Actions,
	ProducerStore,
	Store,
	StoreOperator,
	StoreOptions,
	WritableStore,
} from "./core/types";
