import { producer } from "../producer";
import type { ProducerStore } from "../types";

/**
 * Creates a source that synchronously emits each provided value, then completes.
 *
 * Stateful: maintains last emitted value via producer. get() returns the last
 * value after start (the final argument), or undefined before subscription.
 *
 * v3: Tier 2 Producer — event source, no upstream deps. Each emit() sends
 * DIRTY on type 3 then the value on type 1, synchronously. Completes with END.
 */
export function of<T>(...values: T[]): ProducerStore<T> {
	return producer<T>(({ emit, complete }) => {
		for (const value of values) {
			emit(value);
		}
		complete();
		return undefined;
	});
}
