import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { state } from "../core/state";
import type { Store, StoreOperator, WritableStore } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Routes upstream values into sub-stores by key function.
 * Output is a store of Map<K, Store<V>> that updates whenever a new group
 * is created or any group receives a value.
 *
 * Tier 2: each new group or value emission starts a new DIRTY+value cycle.
 *
 * Inner stores complete when the upstream completes. Upstream errors
 * propagate to all inner stores and the outer store.
 */
export function groupBy<A, K>(keyFn: (value: A) => K): StoreOperator<A, Map<K, Store<A>>> {
	return (input: Store<A>) => {
		const store = producer<Map<K, Store<A>>>(
			({ emit, error, complete }) => {
				const groups = new Map<K, WritableStore<A>>();
				let currentMap = new Map<K, Store<A>>();

				const unsub = subscribe(
					input,
					(v) => {
						let key: K;
						try {
							key = keyFn(v);
						} catch (err) {
							error(err);
							return;
						}
						let group = groups.get(key);
						let isNew = false;

						if (!group) {
							group = state(v);
							groups.set(key, group);
							isNew = true;
						} else {
							group.set(v);
						}

						if (isNew) {
							currentMap = new Map(groups);
							emit(currentMap);
						}
					},
					{
						onEnd: (err) => {
							if (err !== undefined) {
								error(err);
							} else {
								complete();
							}
						},
					},
				);

				return () => {
					groups.clear();
					currentMap = new Map();
					unsub();
				};
			},
			{ initial: new Map<K, Store<A>>() },
		);

		Inspector.register(store, { kind: "groupBy" });
		return store;
	};
}
