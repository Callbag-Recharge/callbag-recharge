// ---------------------------------------------------------------------------
// Wire protocol — message types for worker bridge communication
// ---------------------------------------------------------------------------
// Only settled values cross the wire. DIRTY/RESOLVED stays local to each
// side's reactive graph. Lifecycle signals serialize as string names since
// Symbols can't survive structured clone.
// ---------------------------------------------------------------------------

import type { LifecycleSignal } from "../core/protocol";
import { PAUSE, RESET, RESUME, TEARDOWN } from "../core/protocol";

// ---------------------------------------------------------------------------
// Wire message types
// ---------------------------------------------------------------------------

/** Value update — one store changed */
export interface ValueMessage {
	t: "v";
	s: string;
	d: any;
}

/** Lifecycle signal — serialized symbol name */
export interface SignalMessage {
	t: "s";
	s: string;
	sig: string;
}

/** Ready — worker declares its exported stores with initial values */
export interface ReadyMessage {
	t: "r";
	stores: Record<string, any>;
}

/** Init — main sends initial values of its exposed stores */
export interface InitMessage {
	t: "i";
	stores: Record<string, any>;
}

/** Batch value update — multiple stores changed in one reactive cycle */
export interface BatchMessage {
	t: "b";
	u: Record<string, any>;
}

export type BridgeMessage =
	| ValueMessage
	| SignalMessage
	| ReadyMessage
	| InitMessage
	| BatchMessage;

// ---------------------------------------------------------------------------
// Signal serialization — Symbol ↔ string for structured clone
// ---------------------------------------------------------------------------

const signalToNameMap = new Map<LifecycleSignal, string>([
	[RESET, "RESET"],
	[PAUSE, "PAUSE"],
	[RESUME, "RESUME"],
	[TEARDOWN, "TEARDOWN"],
]);

const nameToSignalMap = new Map<string, LifecycleSignal>([
	["RESET", RESET],
	["PAUSE", PAUSE],
	["RESUME", RESUME],
	["TEARDOWN", TEARDOWN],
]);

export function signalToName(s: LifecycleSignal): string {
	return signalToNameMap.get(s) ?? "UNKNOWN";
}

export function nameToSignal(name: string): LifecycleSignal | undefined {
	return nameToSignalMap.get(name);
}
