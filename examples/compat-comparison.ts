/**
 * Compat Comparison — Same counter in 4 state management APIs
 *
 * Demonstrates: callbag-recharge native, Jotai compat, Zustand compat,
 * TC39 Signals compat — all backed by the same reactive engine.
 */

import { derived, state } from "callbag-recharge";
import { atom } from "callbag-recharge/compat/jotai";
import { Signal } from "callbag-recharge/compat/signals";
import { create } from "callbag-recharge/compat/zustand";

// #region display

// ── 1. callbag-recharge (native) ─────────────────────────────

export const nativeCount = state(0, { name: "native.count" });
export const nativeDoubled = derived([nativeCount], () => nativeCount.get() * 2, {
	name: "native.doubled",
});

export function nativeIncrement() {
	nativeCount.update((n) => n + 1);
}
export function nativeDecrement() {
	nativeCount.update((n) => n - 1);
}
export function nativeReset() {
	nativeCount.set(0);
}

// ── 2. Jotai compat ─────────────────────────────────────────

export const jotaiCount = atom(0);
export const jotaiDoubled = atom((get) => get(jotaiCount) * 2);

export function jotaiIncrement() {
	jotaiCount.update((n) => n + 1);
}
export function jotaiDecrement() {
	jotaiCount.update((n) => n - 1);
}
export function jotaiReset() {
	jotaiCount.set(0);
}

// ── 3. Zustand compat ───────────────────────────────────────

export const zustandStore = create<{
	count: number;
	doubled: number;
	increment: () => void;
	decrement: () => void;
	reset: () => void;
}>((set, _get) => ({
	count: 0,
	doubled: 0,
	increment: () => set((s) => ({ count: s.count + 1, doubled: (s.count + 1) * 2 })),
	decrement: () => set((s) => ({ count: s.count - 1, doubled: (s.count - 1) * 2 })),
	reset: () => set({ count: 0, doubled: 0 }),
}));

// ── 4. TC39 Signals compat ──────────────────────────────────

export const signalCount = new Signal.State(0);
export const signalDoubled = new Signal.Computed(() => signalCount.get() * 2, [signalCount]);

export function signalIncrement() {
	signalCount.set(signalCount.get() + 1);
}
export function signalDecrement() {
	signalCount.set(signalCount.get() - 1);
}
export function signalReset() {
	signalCount.set(0);
}

// #endregion display
