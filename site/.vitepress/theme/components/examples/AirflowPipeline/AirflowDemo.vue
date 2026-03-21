<script setup lang="ts">
import { Background } from "@vue-flow/background";
import { Position, VueFlow } from "@vue-flow/core";
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import { subscribe } from "@lib/core/subscribe";
import type { Store } from "@lib/core/types";
import { createPipeline } from "./pipeline";
import pipelineRaw from "./pipeline.ts?raw";

// Extract the display region between #region display and #endregion display
const REGION_START = "// #region display";
const REGION_END = "// #endregion display";
const regionStart = pipelineRaw.indexOf(REGION_START);
const regionEnd = pipelineRaw.indexOf(REGION_END);
const afterMarker = regionStart >= 0 ? pipelineRaw.indexOf("\n", regionStart) : -1;
const rawRegion =
	regionStart >= 0 && regionEnd > regionStart && afterMarker >= 0
		? pipelineRaw.slice(afterMarker + 1, regionEnd).trimEnd()
		: pipelineRaw;

// Dedent: strip common leading whitespace so the code panel isn't over-indented
const regionLines = rawRegion.split("\n");
const minIndent = regionLines
	.filter((l) => l.trim().length > 0)
	.reduce((min, l) => {
		const match = l.match(/^(\t+)/);
		return match ? Math.min(min, match[1].length) : min;
	}, Infinity);
const PIPELINE_SOURCE =
	minIndent > 0 && minIndent < Infinity
		? regionLines.map((l) => l.slice(minIndent).replace(/\t/g, "  ")).join("\n")
		: rawRegion.replace(/\t/g, "  ");

// ---------------------------------------------------------------------------
// Pipeline instance
// ---------------------------------------------------------------------------
const pipeline = createPipeline();
const unsubs: Array<() => void> = [];

// ---------------------------------------------------------------------------
// Reactive state for Vue
// ---------------------------------------------------------------------------
const nodeStates = reactive<
	Record<
		string,
		{
			status: string;
			duration?: number;
			runCount: number;
			error?: string;
			circuitState: string;
			logs: string[];
		}
	>
>({});

const hoveredNode = ref<string | null>(null);
const isRunning = ref(false);
const runCount = ref(0);

// Popover positioning — rendered outside Vue Flow to escape overflow:hidden
const graphPanelRef = ref<HTMLElement | null>(null);
const popoverPos = ref<{ x: number; y: number; above: boolean }>({
	x: 0,
	y: 0,
	above: false,
});

function onNodeEnter(id: string, event: MouseEvent) {
	hoveredNode.value = id;
	const nodeEl = event.currentTarget as HTMLElement;
	const panelEl = graphPanelRef.value;
	if (!nodeEl || !panelEl) return;

	const nodeRect = nodeEl.getBoundingClientRect();
	const panelRect = panelEl.getBoundingClientRect();

	const x = nodeRect.left + nodeRect.width / 2 - panelRect.left;
	const nodeRelY = nodeRect.top - panelRect.top;
	const panelH = panelRect.height;

	// Flip above if node is in lower 45% of panel
	const above = nodeRelY > panelH * 0.55;

	popoverPos.value = {
		x,
		y: above ? nodeRelY : nodeRelY + nodeRect.height,
		above,
	};
}

// Initialize node states
for (const node of pipeline.nodes) {
	nodeStates[node.id] = {
		status: "idle",
		duration: undefined,
		runCount: 0,
		error: undefined,
		circuitState: "closed",
		logs: [],
	};
}

// Subscribe to taskState changes
onMounted(() => {
	const safeSubscribe = <T>(
		store: Store<T> | null | undefined,
		cb: Parameters<typeof subscribe<T>>[1],
	) => {
		if (!store || typeof (store as { source?: unknown }).source !== "function") {
			return () => {};
		}
		return subscribe(store, cb);
	};

	for (const node of pipeline.nodes) {
		const unsub = safeSubscribe(node.task as unknown as Store<any>, (meta) => {
			const ns = nodeStates[node.id];
			ns.status = meta.status;
			ns.duration = meta.duration;
			ns.runCount = meta.runCount;
			ns.error = meta.error ? String(meta.error) : undefined;
			ns.circuitState = node.breaker.state;
		});
		unsubs.push(unsub);

		// Subscribe to log entries
		const logUnsub = safeSubscribe(node.log?.latest, (entry) => {
			if (entry) {
				const ns = nodeStates[node.id];
				ns.logs = [...ns.logs.slice(-4), entry.value];
			}
		});
		unsubs.push(logUnsub);
	}

	// Pipeline-level subscriptions
	unsubs.push(safeSubscribe(pipeline.running, (v) => (isRunning.value = v)));
	unsubs.push(safeSubscribe(pipeline.runCount, (v) => (runCount.value = v)));
});

onUnmounted(() => {
	for (const unsub of unsubs) unsub();
	pipeline.destroy();
});

// ---------------------------------------------------------------------------
// Status → color mapping
// ---------------------------------------------------------------------------
function statusColor(status: string): string {
	switch (status) {
		case "running":
			return "#3b82f6";
		case "success":
			return "#4de8c2";
		case "error":
			return "#ef4444";
		default:
			return "#6b7f99";
	}
}

function statusGlow(status: string): string {
	switch (status) {
		case "running":
			return "0 0 20px rgba(59, 130, 246, 0.5)";
		case "success":
			return "0 0 20px rgba(77, 232, 194, 0.4)";
		case "error":
			return "0 0 20px rgba(239, 68, 68, 0.5)";
		default:
			return "none";
	}
}

// ---------------------------------------------------------------------------
// Vue Flow graph definition
// ---------------------------------------------------------------------------
// Layout positions (manually placed for the finance DAG shape)
const positions: Record<string, { x: number; y: number }> = {
	cron: { x: 220, y: 0 },
	"fetch-bank": { x: 50, y: 110 },
	"fetch-cards": { x: 390, y: 110 },
	aggregate: { x: 220, y: 220 },
	anomaly: { x: 80, y: 330 },
	"batch-write": { x: 360, y: 330 },
	alert: { x: 80, y: 430 },
};

const vfNodes = pipeline.nodes.map((node) => ({
	id: node.id,
	position: positions[node.id],
	data: { label: node.label },
	type: "custom",
	sourcePosition: Position.Bottom,
	targetPosition: Position.Top,
}));

const vfEdges = pipeline.edges.map((e, i) => ({
	id: `e-${i}`,
	source: e.source,
	target: e.target,
	animated: true,
	style: { stroke: "#4de8c244", strokeWidth: 2 },
}));

// Computed: edges with dynamic colors based on source node status
const dynamicEdges = computed(() =>
	vfEdges.map((e) => {
		const sourceStatus = nodeStates[e.source]?.status ?? "idle";
		const isHoveredPath =
			hoveredNode.value && (e.source === hoveredNode.value || e.target === hoveredNode.value);
		const color =
			sourceStatus === "running"
				? "#3b82f6"
				: sourceStatus === "success"
					? "#4de8c2"
					: sourceStatus === "error"
						? "#ef4444"
						: "#4de8c244";
		return {
			...e,
			animated: sourceStatus === "running" || !!isHoveredPath,
			style: {
				stroke: isHoveredPath ? "#4de8c2" : color,
				strokeWidth: isHoveredPath ? 3 : 2,
				transition: "stroke 0.3s, stroke-width 0.3s",
			},
		};
	}),
);

// ---------------------------------------------------------------------------
// Code panel highlight
// ---------------------------------------------------------------------------
const codeLines = PIPELINE_SOURCE.split("\n");

// Map node IDs to relevant source line ranges (0-indexed, within the display region).
// Matches step definitions and nodeProducer calls in the pipeline() wiring.
const NODE_PATTERNS: Record<string, RegExp> = {
	cron: /\bcron\b/,
	"fetch-bank": /\bfetchBank\b/,
	"fetch-cards": /\bfetchCards\b/,
	aggregate: /\baggregate\b/,
	anomaly: /\banomaly\b/,
	"batch-write": /\bbatchWrite\b/,
	alert: /\balert\b/,
};

const highlightMap: Record<string, number[]> = {};
codeLines.forEach((line: string, i: number) => {
	// Match step(...) definitions and nodeProducer(...) calls
	const isStepLine = /\bstep\(/.test(line);
	const isProducerLine = /\bnodeProducer\(/.test(line);
	const isCommentLine = /\/\/\s*Step/.test(line);
	if (!isStepLine && !isProducerLine && !isCommentLine) return;

	for (const [id, pattern] of Object.entries(NODE_PATTERNS)) {
		if (pattern.test(line)) {
			if (!highlightMap[id]) highlightMap[id] = [];
			highlightMap[id].push(i);
		}
	}
});

function isLineHighlighted(lineIdx: number): boolean {
	if (!hoveredNode.value) return false;
	return highlightMap[hoveredNode.value]?.includes(lineIdx) ?? false;
}

// Active node = currently running node for code panel auto-highlight
const activeNodeId = computed(() => {
	for (const node of pipeline.nodes) {
		if (nodeStates[node.id]?.status === "running") return node.id;
	}
	return null;
});

function isLineActive(lineIdx: number): boolean {
	const id = activeNodeId.value;
	if (!id) return false;
	return highlightMap[id]?.includes(lineIdx) ?? false;
}

// Biome currently checks `<script setup>` bindings independently from template usage.
// Exposing template-consumed bindings keeps lint clean without changing behavior.
defineExpose({
	Background,
	VueFlow,
	onNodeEnter,
	statusColor,
	statusGlow,
	vfNodes,
	dynamicEdges,
	codeLines,
	isLineHighlighted,
	isLineActive,
});
</script>

<template>
	<div class="airflow-demo">
		<!-- Header -->
		<div class="demo-header">
			<div class="demo-title">
				<span class="demo-icon">&#9651;</span>
				Personal Finance Pipeline
			</div>
			<div class="demo-controls">
				<button
					class="run-btn"
					:class="{ running: isRunning }"
					:disabled="isRunning"
					@click="pipeline.trigger()"
				>
					<span v-if="isRunning" class="spinner" />
					{{ isRunning ? "Running..." : "Run Pipeline" }}
				</button>
				<span class="run-count" v-if="runCount > 0">
					Run #{{ runCount }}
				</span>
			</div>
		</div>

		<!-- Main content: graph + code side by side -->
		<div class="demo-body">
			<!-- DAG Graph -->
			<div class="graph-panel" ref="graphPanelRef">
				<VueFlow
					:nodes="vfNodes"
					:edges="dynamicEdges"
					:fit-view-on-init="true"
					:fit-view-params="{ padding: 0.15 }"
					:nodes-draggable="false"
					:nodes-connectable="false"
					:zoom-on-scroll="false"
					:pan-on-scroll="false"
					:pan-on-drag="false"
					:prevent-scrolling="false"
					:zoom-on-double-click="false"
					:zoom-on-pinch="false"
					class="vue-flow-wrapper"
				>
					<Background :gap="20" :size="0.5" pattern-color="#1e345033" />

					<!-- Custom node template -->
					<template #node-custom="{ id, data }">
						<div
							class="dag-node"
							:class="[
								nodeStates[id]?.status,
								{ hovered: hoveredNode === id },
							]"
							:style="{
								borderColor: statusColor(nodeStates[id]?.status ?? 'idle'),
								boxShadow: statusGlow(nodeStates[id]?.status ?? 'idle'),
							}"
							@mouseenter="onNodeEnter(id, $event)"
							@mouseleave="hoveredNode = null"
						>
							<!-- Status dot -->
							<span
								class="status-dot"
								:class="nodeStates[id]?.status"
								:style="{
									backgroundColor: statusColor(
										nodeStates[id]?.status ?? 'idle',
									),
								}"
							/>
							<span class="node-label">{{ data.label }}</span>
						</div>
					</template>
				</VueFlow>

				<!-- Popover rendered OUTSIDE Vue Flow to escape overflow:hidden -->
				<Transition name="pop">
					<div
						v-if="hoveredNode"
						class="node-popover"
						:class="{ 'popover-above': popoverPos.above }"
						:style="{
							left: popoverPos.x + 'px',
							top: popoverPos.above ? 'auto' : popoverPos.y + 8 + 'px',
							bottom: popoverPos.above ? (graphPanelRef ? graphPanelRef.offsetHeight - popoverPos.y + 8 : 0) + 'px' : 'auto',
						}"
					>
						<div class="pop-row">
							<span class="pop-label">Status</span>
							<span
								class="pop-value"
								:class="nodeStates[hoveredNode]?.status"
							>
								{{ nodeStates[hoveredNode]?.status }}
							</span>
						</div>
						<div
							class="pop-row"
							v-if="nodeStates[hoveredNode]?.duration != null"
						>
							<span class="pop-label">Duration</span>
							<span class="pop-value">
								{{ Math.round(nodeStates[hoveredNode]!.duration!) }}ms
							</span>
						</div>
						<div class="pop-row">
							<span class="pop-label">Runs</span>
							<span class="pop-value">
								{{ nodeStates[hoveredNode]?.runCount ?? 0 }}
							</span>
						</div>
						<div class="pop-row">
							<span class="pop-label">Circuit</span>
							<span
								class="pop-value"
								:class="'circuit-' + nodeStates[hoveredNode]?.circuitState"
							>
								{{ nodeStates[hoveredNode]?.circuitState }}
							</span>
						</div>
						<div
							class="pop-row"
							v-if="nodeStates[hoveredNode]?.error"
						>
							<span class="pop-label">Error</span>
							<span class="pop-value error">
								{{ nodeStates[hoveredNode]?.error }}
							</span>
						</div>
						<!-- Log tail -->
						<div
							class="pop-logs"
							v-if="(nodeStates[hoveredNode]?.logs?.length ?? 0) > 0"
						>
							<div class="pop-label">Log</div>
							<div
								v-for="(line, i) in nodeStates[hoveredNode]?.logs"
								:key="i"
								class="log-line"
								:class="{
									'log-ok': line.includes('[OK]'),
									'log-err': line.includes('[ERROR]'),
									'log-start': line.includes('[START]') || line.includes('[TRIGGER]'),
								}"
							>
								{{ line }}
							</div>
						</div>
					</div>
				</Transition>
			</div>

			<!-- Code Panel -->
			<div class="code-panel">
				<div class="code-header">
					<span class="code-filename">pipeline.ts</span>
					<span class="code-badge">{{ codeLines.length }} lines</span>
				</div>
				<div class="code-body">
					<pre><code><template
  v-for="(line, i) in codeLines"
  :key="i"
><span
  class="code-line"
  :class="{
    highlighted: isLineHighlighted(i),
    active: isLineActive(i),
  }"
><span class="line-num">{{ String(i + 1).padStart(2, ' ') }}</span>{{ line }}
</span></template></code></pre>
				</div>
			</div>
		</div>

		<!-- Primitives legend -->
		<div class="demo-legend">
			<div class="legend-item">
				<code>taskState()</code>
				<span>Status, duration, runCount per task</span>
			</div>
			<div class="legend-item">
				<code>circuitBreaker()</code>
				<span>3 failures &rarr; circuit opens</span>
			</div>
			<div class="legend-item">
				<code>reactiveLog()</code>
				<span>Bounded append-only log per task</span>
			</div>
			<div class="legend-item">
				<code>exponential()</code>
				<span>Backoff strategy for cooldown</span>
			</div>
		</div>
	</div>
</template>

<style scoped>
.airflow-demo {
	width: 100%;
	border: 1px solid var(--cr-border);
	border-radius: 16px;
	background: var(--cr-surface);
	overflow: hidden;
}

/* ── Header ── */
.demo-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16px 24px;
	border-bottom: 1px solid var(--cr-border-subtle);
	background: var(--cr-surface-raised);
}

.demo-title {
	font-family: "Instrument Sans", "Outfit", sans-serif;
	font-size: 1.1rem;
	font-weight: 600;
	color: var(--cr-text);
	display: flex;
	align-items: center;
	gap: 8px;
}

.demo-icon {
	color: var(--cr-aqua);
	font-size: 1.2rem;
}

.demo-controls {
	display: flex;
	align-items: center;
	gap: 12px;
}

.run-btn {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 20px;
	border: 1px solid var(--cr-aqua);
	border-radius: 8px;
	background: transparent;
	color: var(--cr-aqua);
	font-family: var(--vp-font-family-base);
	font-size: 0.9rem;
	font-weight: 500;
	cursor: pointer;
	transition:
		background 0.2s,
		box-shadow 0.2s;
}

.run-btn:hover:not(:disabled) {
	background: rgba(77, 232, 194, 0.1);
	box-shadow: 0 0 16px rgba(77, 232, 194, 0.2);
}

.run-btn:disabled {
	opacity: 0.6;
	cursor: not-allowed;
}

.run-btn.running {
	border-color: #3b82f6;
	color: #3b82f6;
}

.spinner {
	display: inline-block;
	width: 14px;
	height: 14px;
	border: 2px solid transparent;
	border-top-color: currentColor;
	border-radius: 50%;
	animation: spin 0.8s linear infinite;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}

.run-count {
	color: var(--cr-text-muted);
	font-size: 0.85rem;
	font-family: var(--vp-font-family-mono);
}

/* ── Body layout ── */
.demo-body {
	display: grid;
	grid-template-columns: 1fr;
}

/* ── Graph panel ── */
.graph-panel {
	position: relative;
	min-width: 0;
	border-bottom: 1px solid var(--cr-border-subtle);
}

.vue-flow-wrapper {
	width: 100%;
	height: 480px;
}

/* ── DAG nodes ── */
.dag-node {
	position: relative;
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 12px 18px;
	min-width: 160px;
	border: 1.5px solid var(--cr-border);
	border-radius: 10px;
	background: var(--cr-surface-raised);
	cursor: default;
	transition:
		border-color 0.3s,
		box-shadow 0.3s,
		transform 0.2s;
}

.dag-node.hovered {
	transform: scale(1.05);
	z-index: 10;
}

.status-dot {
	width: 10px;
	height: 10px;
	border-radius: 50%;
	flex-shrink: 0;
	transition: background-color 0.3s;
}

.status-dot.running {
	animation: pulse-dot 1.2s ease-in-out infinite;
}

@keyframes pulse-dot {
	0%,
	100% {
		opacity: 1;
		transform: scale(1);
	}
	50% {
		opacity: 0.5;
		transform: scale(1.4);
	}
}

.node-label {
	font-family: var(--vp-font-family-base);
	font-size: 0.85rem;
	font-weight: 500;
	color: var(--cr-text);
	white-space: nowrap;
}

/* ── Popover (rendered outside Vue Flow) ── */
.node-popover {
	position: absolute;
	transform: translateX(-50%);
	width: 240px;
	padding: 14px;
	background: var(--cr-deep);
	border: 1px solid var(--cr-border);
	border-radius: 10px;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
	z-index: 1000;
	pointer-events: none;
}

.pop-enter-active,
.pop-leave-active {
	transition:
		opacity 0.15s,
		transform 0.15s;
}
.pop-enter-from,
.pop-leave-to {
	opacity: 0;
	transform: translateX(-50%) translateY(-6px);
}

.popover-above.pop-enter-from,
.popover-above.pop-leave-to {
	transform: translateX(-50%) translateY(6px);
}

.pop-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 3px 0;
	font-size: 0.78rem;
}

.pop-label {
	color: var(--cr-text-muted);
	font-family: var(--vp-font-family-mono);
	font-size: 0.72rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

.pop-value {
	font-family: var(--vp-font-family-mono);
	color: var(--cr-text);
	font-size: 0.78rem;
}

.pop-value.idle {
	color: var(--cr-text-muted);
}
.pop-value.running {
	color: #3b82f6;
}
.pop-value.success {
	color: var(--cr-aqua);
}
.pop-value.error {
	color: #ef4444;
}

.circuit-closed {
	color: var(--cr-aqua);
}
.circuit-open {
	color: #ef4444;
}
.circuit-half-open {
	color: var(--cr-accent-warm);
}

/* ── Log tail ── */
.pop-logs {
	margin-top: 8px;
	padding-top: 8px;
	border-top: 1px solid var(--cr-border-subtle);
}

.log-line {
	font-family: var(--vp-font-family-mono);
	font-size: 0.7rem;
	color: var(--cr-text-muted);
	padding: 1px 0;
	line-height: 1.4;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.log-ok {
	color: var(--cr-aqua-dim);
}
.log-err {
	color: #ef4444;
}
.log-start {
	color: #3b82f6;
}

/* ── Code panel ── */
.code-panel {
	display: flex;
	flex-direction: column;
	background: #091322;
	max-height: 400px;
	min-width: 0;
}

.code-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 16px;
	border-bottom: 1px solid var(--cr-border-subtle);
}

.code-filename {
	font-family: var(--vp-font-family-mono);
	font-size: 0.8rem;
	color: var(--cr-aqua-dim);
}

.code-badge {
	font-family: var(--vp-font-family-mono);
	font-size: 0.7rem;
	color: var(--cr-text-muted);
	padding: 2px 8px;
	border: 1px solid var(--cr-border-subtle);
	border-radius: 4px;
}

.code-body {
	flex: 1;
	overflow: auto;
	padding: 16px 0;
}

.code-body pre {
	margin: 0;
	background: transparent !important;
	border: none !important;
	box-shadow: none !important;
}

.code-body code {
	font-family: var(--vp-font-family-mono);
	font-size: 0.78rem;
	line-height: 1.6;
	background: transparent !important;
	border: none !important;
	color: var(--cr-text-muted) !important;
	padding: 0 !important;
}

.code-line {
	display: block;
	padding: 0 16px;
	transition:
		background 0.2s,
		color 0.2s;
}

.code-line.highlighted {
	background: rgba(77, 232, 194, 0.08);
	color: var(--cr-aqua) !important;
}

.code-line.active {
	background: rgba(59, 130, 246, 0.12);
	color: #93c5fd !important;
}

.line-num {
	display: inline-block;
	width: 28px;
	color: #3a4a5e;
	user-select: none;
	text-align: right;
	margin-right: 16px;
}

/* ── Legend ── */
.demo-legend {
	display: flex;
	flex-wrap: wrap;
	gap: 16px;
	padding: 14px 24px;
	border-top: 1px solid var(--cr-border-subtle);
	background: var(--cr-surface-raised);
}

.legend-item {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 0.78rem;
	color: var(--cr-text-muted);
}

.legend-item code {
	font-family: var(--vp-font-family-mono);
	font-size: 0.75rem;
	color: var(--cr-aqua);
	background: var(--cr-surface);
	border: 1px solid var(--cr-border-subtle);
	padding: 2px 6px;
	border-radius: 4px;
}

/* ── Vue Flow overrides ── */
.vue-flow-wrapper :deep(.vue-flow__edge-path) {
	transition:
		stroke 0.3s,
		stroke-width 0.3s;
}

.vue-flow-wrapper :deep(.vue-flow__background) {
	background: var(--cr-surface) !important;
}

.vue-flow-wrapper :deep(.vue-flow__pane) {
	cursor: default;
}

/* Vue Flow default styles needed */
.vue-flow-wrapper :deep(.vue-flow__handle) {
	width: 8px;
	height: 8px;
	background: var(--cr-border);
	border: 1px solid var(--cr-surface);
}
</style>
