import { producer } from "../producer";
import type { ProducerStore } from "../types";

/**
 * Creates a source from DOM events on the given target.
 *
 * Tier 2 Producer: event source, no upstream deps.
 *
 * v3: uses producer() — each event emission automatically sends DIRTY on
 * type 3 before the value on type 1.
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
