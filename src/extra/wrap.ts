/**
 * Raw callbag interop wrapper — promotes raw callbag sources and operators
 * to proper Store nodes with output slot, multicast, and STATE forwarding.
 *
 * Two overloads:
 * - wrap<T>(rawSource) → tier 2 store (each DATA starts DIRTY+DATA cycle)
 * - wrap<A, B>(input, rawOp) → tier 1 store (STATE bypasses raw op)
 *
 * Constraint: operator wrapping is synchronous map-only. Filtering or tier 2
 * raw ops must use operator() directly with explicit signal handling.
 */

import { Inspector } from "../core/inspector";
import { operator } from "../core/operator";
import { producer } from "../core/producer";
import { DATA, END, START, STATE } from "../core/protocol";
import type { Store } from "../core/types";

type Callbag = (type: number, payload?: any) => void;

// Overload 1: wrap a raw callbag source → tier 2 store
export function wrap<T>(rawSource: Callbag): Store<T>;

// Overload 2: wrap a raw callbag operator with input → tier 1 store
export function wrap<A, B>(input: Store<A>, rawOp: (source: Callbag) => Callbag): Store<B>;

export function wrap<T>(
	sourceOrInput: Callbag | Store<any>,
	rawOp?: (source: Callbag) => Callbag,
): Store<T> {
	if (rawOp) return wrapOp(sourceOrInput as Store<any>, rawOp);
	return wrapSource(sourceOrInput as Callbag);
}

/**
 * Source wrapping (tier 2): each DATA from the raw source starts a fresh
 * DIRTY+DATA cycle via producer's autoDirty. No STATE from upstream — raw
 * sources don't produce STATE signals.
 */
function wrapSource<T>(rawSource: Callbag): Store<T> {
	const store = producer<T>(({ emit, complete, error }) => {
		let talkback: any;
		rawSource(START, (type: number, data: any) => {
			if (type === START) talkback = data;
			else if (type === DATA) emit(data);
			else if (type === END) {
				if (data !== undefined) error(data);
				else complete();
			}
		});
		return () => {
			talkback?.(END);
		};
	});

	Inspector.register(store, { kind: "wrap" });
	return store;
}

/**
 * Compute initial value by running input.get() through the raw op
 * synchronously. Works for synchronous map-like ops (our constraint).
 */
function computeInitial<A, B>(inputValue: A, rawOp: (source: Callbag) => Callbag): B | undefined {
	let result: B | undefined;
	const oneShot: Callbag = (type: number, payload: any) => {
		if (type !== START) return;
		const sink = payload;
		sink(START, () => {});
		sink(DATA, inputValue);
		sink(END);
	};
	const transformed = rawOp(oneShot);
	transformed(START, (type: number, data: any) => {
		if (type === DATA) result = data as B;
	});
	return result;
}

/**
 * Operator wrapping (tier 1, STATE bypass): wraps a raw callbag map-like
 * operator so it participates in diamond resolution. STATE signals from
 * the input bypass the raw op entirely (routed to signal()), while DATA
 * flows through the raw op for transformation.
 *
 * Uses operator([input], handler) for proper lifecycle — the operator
 * framework manages subscription, talkback, teardown, and output slot.
 * A "pushable bridge" callbag is created inside init and connected to
 * the rawOp; the handler pushes DATA into it.
 */
function wrapOp<A, B>(input: Store<A>, rawOp: (source: Callbag) => Callbag): Store<B> {
	const initialValue = computeInitial<A, B>(input.get() as A, rawOp);

	return operator<B>(
		[input] as Store<unknown>[],
		({ emit, signal, complete, error }) => {
			// Pushable bridge: a callbag source we control. When the raw op
			// subscribes to it, we capture the raw op's sink so we can push
			// DATA into the pipeline on demand.
			let pushToRaw: Callbag | null = null;

			const pushable: Callbag = (type: number, payload: any) => {
				if (type !== START) return;
				const sink = payload;
				pushToRaw = sink;
				// Give the raw op a no-op talkback (we're push-only)
				sink(START, (t: number) => {
					if (t === END) pushToRaw = null;
				});
			};

			// Apply the raw callbag operator to the pushable bridge
			const transformed = rawOp(pushable);
			transformed(START, (type: number, data: any) => {
				if (type === START) {
					/* rawTalkback — not needed, we control the bridge */
				} else if (type === DATA) emit(data as B);
				else if (type === END) {
					if (data !== undefined) error(data);
					else complete();
				}
			});

			return (_dep: number, type: number, data: any) => {
				if (type === STATE) {
					// STATE bypass: route around the raw op, directly to output
					signal(data);
				} else if (type === DATA) {
					// Push DATA through the raw op for transformation
					pushToRaw?.(DATA, data);
				} else if (type === END) {
					if (pushToRaw) {
						// Raw op relays END → complete/error via transformed sink
						pushToRaw(END, data);
					} else {
						// Raw op already terminated — handle directly
						if (data !== undefined) error(data);
						else complete();
					}
				}
			};
		},
		{
			kind: "wrap",
			initial: initialValue,
			getter: () => computeInitial<A, B>(input.get() as A, rawOp) as B,
		},
	);
}
