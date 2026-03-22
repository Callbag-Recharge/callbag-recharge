// Worker bridge — reactive cross-thread communication
export type { WorkerBridge, WorkerBridgeOptions } from "./bridge";
export { workerBridge } from "./bridge";
export type {
	BatchMessage,
	BridgeMessage,
	InitMessage,
	ReadyMessage,
	SignalMessage,
	ValueMessage,
} from "./protocol";
export { nameToSignal, signalToName } from "./protocol";
export type { WorkerSelfHandle, WorkerSelfOptions } from "./self";
export { workerSelf } from "./self";
export type { WorkerTransport } from "./transport";
export { createTransport } from "./transport";
