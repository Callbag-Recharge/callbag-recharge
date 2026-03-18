import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

/**
 * Fails immediately with `err` as the END error payload (Tier 2).
 *
 * @param err - Error value to propagate.
 *
 * @returns `ProducerStore<T>`
 *
 * @category extra
 */
export function throwError<T = never>(err: unknown): ProducerStore<T> {
	return producer<T>(({ error }) => {
		error(err);
		return undefined;
	});
}
