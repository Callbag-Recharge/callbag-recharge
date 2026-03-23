// ---------------------------------------------------------------------------
// dagLayout — Sugiyama-style layered DAG layout for visualization
// ---------------------------------------------------------------------------
// Assigns (x, y) coordinates to nodes in a DAG using a layered approach:
//   1. Back-edge detection (DFS to break cycles)
//   2. Layer assignment (longest path from roots)
//   3. Crossing reduction (barycenter heuristic)
//   4. Coordinate assignment (centered within layer)
//
// Generic utility — works with any graph, not tied to pipeline.
// Gracefully handles cycles by detecting back-edges and excluding them
// from layer assignment. Back-edges are returned separately so renderers
// can draw them as dashed/curved arrows (e.g., loop-back indicators).
// ---------------------------------------------------------------------------

export interface LayoutNode {
	id: string;
	x: number;
	y: number;
	/** 0-based layer index (top → bottom or left → right). */
	layer: number;
	/** 0-based order within the layer. */
	order: number;
}

export interface DagLayoutEdge {
	source: string;
	target: string;
}

export interface DagLayoutResult {
	/** Positioned nodes with (x, y, layer, order). */
	nodes: LayoutNode[];
	/** Edges that were detected as back-edges (cycle-forming). Renderers should
	 *  draw these differently (e.g., dashed, curved upward) to indicate loops. */
	backEdges: DagLayoutEdge[];
}

export interface DagLayoutOpts {
	/** Horizontal spacing between nodes in the same layer (default: 200). */
	nodeGap?: number;
	/** Vertical spacing between layers (default: 120). */
	layerGap?: number;
	/** Layout direction: "TB" (top-to-bottom) or "LR" (left-to-right) (default: "TB"). */
	direction?: "TB" | "LR";
	/** Node width for centering calculations (default: 160). */
	nodeWidth?: number;
}

/**
 * Compute a layered DAG layout using Sugiyama-style algorithm.
 *
 * Handles cycles gracefully: back-edges are detected via DFS and excluded
 * from layer assignment. They are returned in `result.backEdges` so renderers
 * can draw them as dashed/curved arrows indicating loops.
 *
 * @returns `DagLayoutResult` with positioned nodes and detected back-edges.
 *
 * @example
 * ```ts
 * const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
 * const edges = [
 *   { source: "a", target: "b" },
 *   { source: "b", target: "c" },
 *   { source: "c", target: "a" }, // cycle!
 * ];
 * const result = dagLayout(nodes, edges);
 * // result.nodes — positioned layout (a → b → c layered)
 * // result.backEdges — [{ source: "c", target: "a" }]
 * ```
 */
export function dagLayout(
	nodes: { id: string }[],
	edges: DagLayoutEdge[],
	opts?: DagLayoutOpts,
): DagLayoutResult {
	const nodeGap = opts?.nodeGap ?? 200;
	const layerGap = opts?.layerGap ?? 120;
	const direction = opts?.direction ?? "TB";
	const nodeWidth = opts?.nodeWidth ?? 160;

	if (nodes.length === 0) return { nodes: [], backEdges: [] };

	// Build adjacency
	const ids = new Set(nodes.map((n) => n.id));
	const children = new Map<string, string[]>();
	const parents = new Map<string, string[]>();
	for (const id of ids) {
		children.set(id, []);
		parents.set(id, []);
	}

	// --- Phase 0: Detect back-edges via DFS ---
	// Build temporary adjacency for DFS
	const tempChildren = new Map<string, string[]>();
	for (const id of ids) tempChildren.set(id, []);
	for (const e of edges) {
		if (ids.has(e.source) && ids.has(e.target)) {
			tempChildren.get(e.source)!.push(e.target);
		}
	}

	const backEdges: DagLayoutEdge[] = [];
	const WHITE = 0; // unvisited
	const GRAY = 1; // in current DFS path
	const BLACK = 2; // fully processed
	const color = new Map<string, number>();
	for (const id of ids) color.set(id, WHITE);

	// Iterative DFS to avoid stack overflow on large graphs
	function dfs(startId: string): void {
		const stack: Array<{ id: string; childIdx: number }> = [{ id: startId, childIdx: 0 }];
		color.set(startId, GRAY);

		while (stack.length > 0) {
			const frame = stack[stack.length - 1];
			const cs = tempChildren.get(frame.id)!;

			if (frame.childIdx >= cs.length) {
				// Done with this node
				color.set(frame.id, BLACK);
				stack.pop();
				continue;
			}

			const child = cs[frame.childIdx];
			frame.childIdx++;

			const childColor = color.get(child);
			if (childColor === GRAY) {
				// Back-edge detected — this creates a cycle
				backEdges.push({ source: frame.id, target: child });
			} else if (childColor === WHITE) {
				color.set(child, GRAY);
				stack.push({ id: child, childIdx: 0 });
			}
			// BLACK = cross/forward edge, ignore
		}
	}

	// Deterministic DFS order: sort ids for stable back-edge detection
	const sortedIds = Array.from(ids).sort();
	for (const id of sortedIds) {
		if (color.get(id) === WHITE) dfs(id);
	}

	// Build cycle-free adjacency (exclude back-edges)
	const backEdgeSet = new Set(backEdges.map((e) => `${e.source}->${e.target}`));
	for (const e of edges) {
		if (ids.has(e.source) && ids.has(e.target)) {
			const key = `${e.source}->${e.target}`;
			if (!backEdgeSet.has(key)) {
				children.get(e.source)!.push(e.target);
				parents.get(e.target)!.push(e.source);
			}
		}
	}

	// --- Phase 1: Layer assignment (longest path from any root) ---
	const layerOf = new Map<string, number>();

	// Topological sort via Kahn's algorithm (on cycle-free graph)
	const inDegree = new Map<string, number>();
	for (const id of ids) inDegree.set(id, 0);
	for (const e of edges) {
		if (ids.has(e.source) && ids.has(e.target) && !backEdgeSet.has(`${e.source}->${e.target}`)) {
			inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
		}
	}

	const queue: string[] = [];
	for (const [id, deg] of inDegree) {
		if (deg === 0) {
			queue.push(id);
			layerOf.set(id, 0);
		}
	}

	// BFS — assign layer = max(parent layers) + 1
	const topoOrder: string[] = [];
	const visited = new Set<string>();
	let qi = 0;
	while (qi < queue.length) {
		const id = queue[qi++];
		topoOrder.push(id);
		visited.add(id);
		const myLayer = layerOf.get(id) ?? 0;
		for (const child of children.get(id) ?? []) {
			const childLayer = layerOf.get(child) ?? 0;
			layerOf.set(child, Math.max(childLayer, myLayer + 1));
			const deg = (inDegree.get(child) ?? 1) - 1;
			inDegree.set(child, deg);
			if (deg === 0) queue.push(child);
		}
	}

	// Handle any unvisited nodes (disconnected) — put at layer 0
	for (const id of ids) {
		if (!layerOf.has(id)) layerOf.set(id, 0);
	}

	// --- Phase 2: Group by layer ---
	let maxLayer = 0;
	for (const v of layerOf.values()) {
		if (v > maxLayer) maxLayer = v;
	}
	const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
	for (const id of topoOrder) {
		layers[layerOf.get(id)!].push(id);
	}
	// Add unvisited nodes (disconnected)
	for (const n of nodes) {
		if (!visited.has(n.id)) {
			layers[layerOf.get(n.id)!].push(n.id);
		}
	}

	// --- Phase 3: Crossing reduction (barycenter heuristic, 4 passes) ---
	for (let pass = 0; pass < 4; pass++) {
		for (let l = 1; l <= maxLayer; l++) {
			const layer = layers[l];
			const prevLayer = layers[l - 1];
			const prevPos = new Map<string, number>();
			for (let i = 0; i < prevLayer.length; i++) prevPos.set(prevLayer[i], i);

			// Compute barycenter for each node in this layer
			const bary = new Map<string, number>();
			for (const id of layer) {
				const ps = parents.get(id) ?? [];
				const parentPositions = ps
					.map((p) => prevPos.get(p))
					.filter((p) => p !== undefined) as number[];
				if (parentPositions.length > 0) {
					const avg = parentPositions.reduce((a, b) => a + b, 0) / parentPositions.length;
					bary.set(id, avg);
				} else {
					bary.set(id, layer.indexOf(id));
				}
			}

			// Sort by barycenter
			layers[l] = [...layer].sort((a, b) => (bary.get(a) ?? 0) - (bary.get(b) ?? 0));
		}

		// Bottom-up pass
		for (let l = maxLayer - 1; l >= 0; l--) {
			const layer = layers[l];
			const nextLayer = layers[l + 1];
			const nextPos = new Map<string, number>();
			for (let i = 0; i < nextLayer.length; i++) nextPos.set(nextLayer[i], i);

			const bary = new Map<string, number>();
			for (const id of layer) {
				const cs = children.get(id) ?? [];
				const childPositions = cs
					.map((c) => nextPos.get(c))
					.filter((c) => c !== undefined) as number[];
				if (childPositions.length > 0) {
					const avg = childPositions.reduce((a, b) => a + b, 0) / childPositions.length;
					bary.set(id, avg);
				} else {
					bary.set(id, layer.indexOf(id));
				}
			}

			layers[l] = [...layer].sort((a, b) => (bary.get(a) ?? 0) - (bary.get(b) ?? 0));
		}
	}

	// --- Phase 4: Coordinate assignment (center within layer) ---
	const layoutNodes: LayoutNode[] = [];

	for (let l = 0; l <= maxLayer; l++) {
		const layer = layers[l];
		const layerWidth = (layer.length - 1) * nodeGap;
		const startX = -layerWidth / 2;

		for (let i = 0; i < layer.length; i++) {
			const id = layer[i];
			const rawX = startX + i * nodeGap;
			const rawY = l * layerGap;

			layoutNodes.push({
				id,
				x: direction === "TB" ? rawX + nodeWidth / 2 : rawY,
				y: direction === "TB" ? rawY : rawX + nodeWidth / 2,
				layer: l,
				order: i,
			});
		}
	}

	return { nodes: layoutNodes, backEdges };
}
