import { producer } from "../producer";
import type { ProducerStore } from "../types";

/**
 * Creates a source from DOM events on the given target.
 *
 * Stateful: maintains last event via producer. get() returns the last
 * emitted event, or undefined before first event.
 *
 * v3: Tier 2 Producer — event source, no upstream deps. Each emit sends
 * DIRTY on type 3 before the value on type 1 (autoDirty: true).
 */
export function fromEvent<T extends Event = Event>(
	target: EventTarget,
	eventName: string,
): ProducerStore<T> {
	return producer<T>(({ emit }) => {
		const handler = (e: Event) => emit(e as T);
		target.addEventListener(eventName, handler);
		return () => target.removeEventListener(eventName, handler);
	});
}
