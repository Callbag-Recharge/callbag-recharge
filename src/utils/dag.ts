// ---------------------------------------------------------------------------
// dag — acyclicity validation + Inspector graph registration
// ---------------------------------------------------------------------------
// Optional sugar for declaring task DAGs. Validates that the dependency graph
// is acyclic (topological sort) and registers all edges with Inspector for
// graph visualization.
//
// This does NOT create new nodes — it validates and annotates existing ones.
// The actual DAG execution is handled by derived() + effect() with explicit
// deps (diamond resolution IS the DAG executor).
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import type { Store } from "../core/types";

export interface DagNode {
	/** The store (state, derived, producer, operator, etc.) */
	store: Store<unknown>;
	/** Dependencies — other stores that must complete before this one. */
	deps?: Store<unknown>[];
	/** Optional label for Inspector. */
	name?: string;
}

export interface DagResult {
	/** Topologically sorted node stores (deps before dependents). */
	order: Store<unknown>[];
	/** Number of nodes in the DAG. */
	size: number;
}

/**
 * Validate a task DAG for acyclicity and register edges with Inspector.
 * Throws if a cycle is detected.
 *
 * @example
 * ```ts
 * const daily = fromCron('0 9 * * *');
 * const fetchBank = pipe(daily, exhaustMap(() => fromPromise(plaid.sync())));
 * const fetchCards = pipe(daily, exhaustMap(() => fromPromise(stripe.charges())));
 * const aggregate = derived([fetchBank, fetchCards], () => merge(...));
 *
 * // Validate the DAG — throws if cycles exist
 * const { order } = dag([
 *   { store: daily, name: 'cron' },
 *   { store: fetchBank, deps: [daily], name: 'fetch-bank' },
 *   { store: fetchCards, deps: [daily], name: 'fetch-cards' },
 *   { store: aggregate, deps: [fetchBank, fetchCards], name: 'aggregate' },
 * ]);
 * ```
 */
export function dag(nodes: DagNode[]): DagResult {
	// Build adjacency list using store identity
	const storeToIndex = new Map<Store<unknown>, number>();
	for (let i = 0; i < nodes.length; i++) {
		if (storeToIndex.has(nodes[i].store)) {
			throw new Error(`Duplicate store in DAG: ${nodes[i].name ?? `node[${i}]`}`);
		}
		storeToIndex.set(nodes[i].store, i);
	}

	// Adjacency: edges[i] = list of indices that depend on i (i → j means i must come before j)
	const inDegree = new Array(nodes.length).fill(0) as number[];
	const adj: number[][] = nodes.map(() => []);

	for (let i = 0; i < nodes.length; i++) {
		const deps = nodes[i].deps;
		if (!deps) continue;
		for (const dep of deps) {
			const depIdx = storeToIndex.get(dep);
			if (depIdx === undefined) {
				throw new Error(
					`Dependency not found in DAG for ${nodes[i].name ?? `node[${i}]`}. ` +
						"All deps must be declared as DAG nodes.",
				);
			}
			adj[depIdx].push(i);
			inDegree[i]++;
		}
	}

	// Kahn's algorithm — topological sort
	const queue: number[] = [];
	for (let i = 0; i < nodes.length; i++) {
		if (inDegree[i] === 0) queue.push(i);
	}

	const sorted: number[] = [];
	while (queue.length > 0) {
		const idx = queue.shift()!;
		sorted.push(idx);
		for (const next of adj[idx]) {
			inDegree[next]--;
			if (inDegree[next] === 0) queue.push(next);
		}
	}

	if (sorted.length !== nodes.length) {
		// Find the cycle participants for a useful error message
		const inCycle = nodes
			.filter((_, i) => !sorted.includes(i))
			.map((n, i) => n.name ?? `node[${i}]`);
		throw new Error(`Cycle detected in DAG involving: ${inCycle.join(", ")}`);
	}

	// Register with Inspector for graph visualization
	for (const node of nodes) {
		if (node.name) {
			Inspector.register(node.store, { name: node.name, kind: "dag-node" });
		}
		if (node.deps) {
			for (const dep of node.deps) {
				Inspector.registerEdge(dep, node.store);
			}
		}
	}

	return {
		order: sorted.map((i) => nodes[i].store),
		size: nodes.length,
	};
}
