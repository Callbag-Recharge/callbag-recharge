// ---------------------------------------------------------------------------
// tokenTracker — token/cost tracking operator
// ---------------------------------------------------------------------------
// Pipe-native operator that tracks token consumption per stream value.
// Wraps a stream with observable metadata: prompt tokens, completion tokens,
// total tokens, cost, and value count. Tier 2 operator built on producer().
//
// Usage:
//   const tracked = pipe(llmStream, tokenTracker(v => v.usage));
//   effect([tracked.tokens], () => {
//     const t = tracked.tokens.get();
//     console.log(`${t.totalTokens} tokens, $${t.cost}`);
//   });
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store, StoreOperator } from "../core/types";

export interface TokenUsage {
	/** Number of prompt/input tokens. */
	promptTokens?: number;
	/** Number of completion/output tokens. */
	completionTokens?: number;
	/** Total tokens (prompt + completion). Computed if not provided. */
	totalTokens?: number;
	/** Cost in dollars. */
	cost?: number;
}

export interface TokenMeta {
	/** Accumulated prompt tokens. */
	promptTokens: number;
	/** Accumulated completion tokens. */
	completionTokens: number;
	/** Accumulated total tokens. */
	totalTokens: number;
	/** Accumulated cost. */
	cost: number;
	/** Number of values processed. */
	count: number;
}

export interface TokenTrackedStore<A> extends Store<A | undefined> {
	/** Reactive token usage metadata. */
	tokens: Store<TokenMeta>;
}

const EMPTY_META: TokenMeta = Object.freeze({
	promptTokens: 0,
	completionTokens: 0,
	totalTokens: 0,
	cost: 0,
	count: 0,
});

/**
 * Wraps a stream with reactive token/cost tracking metadata (Tier 2).
 *
 * @param countTokens - Function that extracts token usage from each emitted value.
 * @param opts - Optional configuration.
 *
 * @returns `StoreOperator<A, A>` — pipe-compatible. The returned store has a `tokens` property (`Store<TokenMeta>`).
 *
 * @returnsTable get() | () => A \| undefined | Last forwarded value.
 * tokens | Store\<TokenMeta\> | Reactive metadata: promptTokens, completionTokens, totalTokens, cost, count.
 * source | callbag | Underlying callbag source for subscriptions.
 *
 * @remarks **Tier 2:** Cycle boundary — each forwarded value starts a new DIRTY+value cycle.
 * @remarks **Accumulative:** Token counts and cost accumulate across all values. Resets on reconnect.
 * @remarks **Flexible extraction:** `countTokens` can return partial usage — missing fields default to 0.
 *
 * @example
 * ```ts
 * import { state, pipe, effect } from 'callbag-recharge';
 * import { tokenTracker } from 'callbag-recharge/orchestrate';
 *
 * const llmOutput = state({ text: 'Hello', usage: { promptTokens: 10, completionTokens: 5 } });
 * const tracked = pipe(llmOutput, tokenTracker(v => v.usage));
 * effect([tracked.tokens], () => {
 *   const t = tracked.tokens.get();
 *   console.log(`${t.totalTokens} tokens`); // "15 tokens"
 * });
 * ```
 *
 * @seeAlso [track](./track) — lifecycle tracking, [fromLLM](/api/fromLLM) — LLM adapter
 *
 * @category orchestrate
 */
export function tokenTracker<A>(
	countTokens: (value: A) => TokenUsage,
	opts?: { name?: string },
): StoreOperator<A, A> {
	return (input: Store<A>) => {
		const name = opts?.name ?? "tokenTracker";

		/** Coerce NaN/Infinity/undefined to 0 */
		const sanitize = (v: number | undefined): number => {
			if (v === undefined || v === null || !Number.isFinite(v)) return 0;
			return v;
		};

		const tokens = state<TokenMeta>(
			{ ...EMPTY_META },
			{
				name: `${name}:tokens`,
				equals: () => false, // always emit on update
			},
		);

		const store = producer<A>(
			({ emit, error, complete }) => {
				let promptTokens = 0;
				let completionTokens = 0;
				let totalTokens = 0;
				let cost = 0;
				let count = 0;

				// Reset meta on connection
				tokens.set({ ...EMPTY_META });

				const sub = subscribe(
					input,
					(v) => {
						try {
							const usage = countTokens(v);
							const pt = sanitize(usage.promptTokens);
							const ct = sanitize(usage.completionTokens);
							const tt = sanitize(usage.totalTokens) || pt + ct;
							const c = sanitize(usage.cost);

							promptTokens += pt;
							completionTokens += ct;
							totalTokens += tt;
							cost += c;
							count++;

							tokens.set({
								promptTokens,
								completionTokens,
								totalTokens,
								cost,
								count,
							});
						} catch {
							// countTokens threw — still forward the value
							count++;
							tokens.set({
								promptTokens,
								completionTokens,
								totalTokens,
								cost,
								count,
							});
						}
						emit(v);
					},
					{
						onEnd: (err) => {
							if (err !== undefined) error(err);
							else complete();
						},
					},
				);

				return () => {
					sub.unsubscribe();
				};
			},
			{ initial: input.get() },
		);

		Inspector.register(store, { kind: "tokenTracker", name });

		// Attach tokens as observable metadata
		(store as any).tokens = tokens;

		return store as Store<A> as any;
	};
}
