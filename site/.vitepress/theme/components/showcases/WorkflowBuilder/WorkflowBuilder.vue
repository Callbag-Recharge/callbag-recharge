<script setup lang="ts">
import { Background } from "@vue-flow/background";
import { Position, VueFlow } from "@vue-flow/core";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import { createWorkflowBuilder, templates, type WorkflowNode } from "@examples/workflow-builder";
import { useSubscribe, useSubscribeRecord } from "callbag-recharge/compat/vue";
import { computed, onUnmounted, ref, watchEffect } from "vue";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
const wb = createWorkflowBuilder();
onUnmounted(() => wb.destroy());

// ---------------------------------------------------------------------------
// Reactive refs
// ---------------------------------------------------------------------------
const selectedTemplate = useSubscribe(wb.selectedTemplate);
const code = useSubscribe(wb.code);
const running = useSubscribe(wb.running);
const runCount = useSubscribe(wb.runCount);
const pipelineStatus = useSubscribe(wb.pipelineStatus);
const nodesRef = useSubscribe(wb.nodes);
const edgesRef = useSubscribe(wb.edges);
const layoutRef = useSubscribe(wb.layout);
const durationRange = useSubscribe(wb.durationRange);
const failRate = useSubscribe(wb.failRate);
const executionLogLatest = useSubscribe(wb.executionLog.latest);

// Per-node reactive stores — auto-managed subscriptions via useSubscribeRecord
const nodeData = useSubscribeRecord(
	() => nodesRef.value.map((n) => n.id),
	(id) => {
		const n = nodesRef.value.find((node) => node.id === id)!;
		return {
			status: n.task.status as any,
			breaker: n.breakerState as any,
			latestLog: n.log.latest as any,
		};
	},
);

// Accumulate log lines per node (with dedup guard to prevent duplicate entries)
const nodeLogs = ref<Record<string, string[]>>({});
const lastLogEntry = new Map<string, string>();
watchEffect(() => {
	for (const n of nodesRef.value) {
		const entry = nodeData.value[n.id]?.latestLog;
		if (entry && entry.value !== lastLogEntry.get(n.id)) {
			lastLogEntry.set(n.id, entry.value);
			const current = nodeLogs.value[n.id] ?? [];
			nodeLogs.value[n.id] = [...current.slice(-4), entry.value];
		}
	}
});

// Execution log accumulator
const executionLogLines = ref<string[]>([]);
watchEffect(() => {
	const entry = executionLogLatest.value;
	if (entry) {
		executionLogLines.value = [...executionLogLines.value.slice(-19), entry.value];
	}
});

// ---------------------------------------------------------------------------
// Template selector
// ---------------------------------------------------------------------------
function onTemplateChange(e: Event) {
	const id = (e.target as HTMLSelectElement).value;
	wb.selectTemplate(id);
	executionLogLines.value = [];
}

// ---------------------------------------------------------------------------
// Parameter controls
// ---------------------------------------------------------------------------
function onDurationChange(e: Event) {
	const val = Number((e.target as HTMLInputElement).value);
	wb.durationRange.set([Math.round(val * 0.3), val]);
}

function onFailRateChange(e: Event) {
	const val = Number((e.target as HTMLInputElement).value);
	wb.failRate.set(val);
}

// ---------------------------------------------------------------------------
// Status → color / glow
// ---------------------------------------------------------------------------
function statusColor(status: string): string {
	switch (status) {
		case "running":
			return "#3b82f6";
		case "success":
			return "#4de8c2";
		case "error":
			return "#ef4444";
		case "skipped":
			return "#f0a858";
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

function pipelineStatusLabel(status: string): string {
	switch (status) {
		case "idle":
			return "Ready";
		case "active":
			return "Running";
		case "completed":
			return "Completed";
		case "errored":
			return "Failed";
		default:
			return status;
	}
}

// ---------------------------------------------------------------------------
// Vue Flow graph (dynamic from layout)
// ---------------------------------------------------------------------------
const vfNodes = computed(() =>
	nodesRef.value.map((node) => {
		const pos = layoutRef.value.find((l) => l.id === node.id);
		return {
			id: node.id,
			position: pos ? { x: pos.x, y: pos.y } : { x: 0, y: 0 },
			data: { label: node.label },
			type: "custom",
			sourcePosition: Position.Bottom,
			targetPosition: Position.Top,
		};
	}),
);

const dynamicEdges = computed(() =>
	edgesRef.value.map((e, i) => {
		const status = nodeData.value[e.source]?.status ?? "idle";
		const isHovered =
			hoveredNode.value && (e.source === hoveredNode.value || e.target === hoveredNode.value);
		const color =
			status === "running"
				? "#3b82f6"
				: status === "success"
					? "#4de8c2"
					: status === "error"
						? "#ef4444"
						: "#4de8c244";
		return {
			id: `e-${i}`,
			source: e.source,
			target: e.target,
			animated: status === "running" || !!isHovered,
			style: {
				stroke: isHovered ? "#4de8c2" : color,
				strokeWidth: isHovered ? 3 : 2,
				transition: "stroke 0.3s, stroke-width 0.3s",
			},
		};
	}),
);

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------
const hoveredNode = ref<string | null>(null);
const graphPanelRef = ref<HTMLElement | null>(null);
const popoverPos = ref<{ x: number; y: number; above: boolean }>({ x: 0, y: 0, above: false });

function onNodeEnter(id: string, event: MouseEvent) {
	hoveredNode.value = id;
	const nodeEl = event.currentTarget as HTMLElement;
	const panelEl = graphPanelRef.value;
	if (!nodeEl || !panelEl) return;

	const nodeRect = nodeEl.getBoundingClientRect();
	const panelRect = panelEl.getBoundingClientRect();
	const x = nodeRect.left + nodeRect.width / 2 - panelRect.left;
	const nodeRelY = nodeRect.top - panelRect.top;
	const above = nodeRelY > panelRect.height * 0.55;

	popoverPos.value = {
		x,
		y: above ? nodeRelY : nodeRelY + nodeRect.height,
		above,
	};
}

// ---------------------------------------------------------------------------
// Code panel
// ---------------------------------------------------------------------------
const codeLines = computed(() => code.value.split("\n"));
</script>

<template>
	<div class="workflow-builder">
		<!-- Header -->
		<div class="wb-header">
			<div class="wb-title">
				<span class="wb-icon">&#9671;</span>
				Workflow Builder
			</div>
			<div class="wb-controls">
				<select class="template-select" :value="selectedTemplate" @change="onTemplateChange">
					<option v-for="t in templates" :key="t.id" :value="t.id">
						{{ t.name }}
					</option>
				</select>
				<button
					class="run-btn"
					:class="{ running: running }"
					:disabled="running"
					@click="wb.trigger()"
				>
					<span v-if="running" class="spinner" />
					{{ running ? "Running..." : "Run Pipeline" }}
				</button>
				<button class="reset-btn" :disabled="running || pipelineStatus === 'idle'" @click="wb.reset()">
					Reset
				</button>
				<span
					class="status-badge"
					:class="pipelineStatus"
				>
					{{ pipelineStatusLabel(pipelineStatus) }}
				</span>
				<span v-if="runCount > 0" class="run-count">#{{ runCount }}</span>
			</div>
		</div>

		<!-- Parameter controls -->
		<div class="wb-params">
			<div class="param-group">
				<label class="param-label">Duration (max ms)</label>
				<input
					type="range"
					min="200"
					max="3000"
					step="100"
					:value="durationRange[1]"
					class="param-slider"
					@input="onDurationChange"
				/>
				<span class="param-value">{{ durationRange[1] }}ms</span>
			</div>
			<div class="param-group">
				<label class="param-label">Failure Rate</label>
				<input
					type="range"
					min="0"
					max="0.8"
					step="0.05"
					:value="failRate"
					class="param-slider"
					@input="onFailRateChange"
				/>
				<span class="param-value">{{ Math.round(failRate * 100) }}%</span>
			</div>
			<div class="param-info">
				{{ templates.find((t) => t.id === selectedTemplate)?.description }}
			</div>
		</div>

		<!-- Main body: Graph + Code -->
		<div class="wb-body">
			<!-- DAG Graph -->
			<div class="graph-panel" ref="graphPanelRef">
				<VueFlow
					:nodes="vfNodes"
					:edges="dynamicEdges"
					:fit-view-on-init="true"
					:fit-view-params="{ padding: 0.2 }"
					:nodes-draggable="false"
					:nodes-connectable="false"
					:zoom-on-scroll="false"
					:pan-on-scroll="false"
					:pan-on-drag="false"
					:prevent-scrolling="false"
					:zoom-on-double-click="false"
					:zoom-on-pinch="false"
					class="vue-flow-wrapper"
					:key="selectedTemplate"
				>
					<Background :gap="20" :size="0.5" pattern-color="#1e345033" />

					<template #node-custom="{ id, data }">
						<div
							class="dag-node"
							:class="[nodeData[id]?.status, { hovered: hoveredNode === id }]"
							:style="{
								borderColor: statusColor(nodeData[id]?.status ?? 'idle'),
								boxShadow: statusGlow(nodeData[id]?.status ?? 'idle'),
							}"
							@mouseenter="onNodeEnter(id, $event)"
							@mouseleave="hoveredNode = null"
						>
							<span
								class="status-dot"
								:class="nodeData[id]?.status"
								:style="{ backgroundColor: statusColor(nodeData[id]?.status ?? 'idle') }"
							/>
							<span class="node-label">{{ data.label }}</span>
						</div>
					</template>
				</VueFlow>

				<!-- Popover -->
				<Transition name="pop">
					<div
						v-if="hoveredNode"
						class="node-popover"
						:class="{ 'popover-above': popoverPos.above }"
						:style="{
							left: popoverPos.x + 'px',
							top: popoverPos.above ? 'auto' : popoverPos.y + 8 + 'px',
							bottom: popoverPos.above
								? (graphPanelRef ? graphPanelRef.offsetHeight - popoverPos.y + 8 : 0) + 'px'
								: 'auto',
						}"
					>
						<div class="pop-row">
							<span class="pop-label">Status</span>
							<span class="pop-value" :class="nodeData[hoveredNode]?.status">
								{{ nodeData[hoveredNode]?.status ?? "idle" }}
							</span>
						</div>
						<div class="pop-row">
							<span class="pop-label">Circuit</span>
							<span
								class="pop-value"
								:class="'circuit-' + nodeData[hoveredNode]?.breaker"
							>
								{{ nodeData[hoveredNode]?.breaker ?? "closed" }}
							</span>
						</div>
						<div class="pop-logs" v-if="nodeLogs[hoveredNode]?.length > 0">
							<div class="pop-label">Log</div>
							<div
								v-for="(line, i) in nodeLogs[hoveredNode]"
								:key="i"
								class="log-line"
								:class="{
									'log-ok': line.includes('[OK]'),
									'log-err': line.includes('[ERROR]'),
									'log-start': line.includes('[START]') || line.includes('[TRIGGER]'),
									'log-skip': line.includes('[CIRCUIT'),
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
><span class="code-line"><span class="line-num">{{ String(i + 1).padStart(3, ' ') }}</span>{{ line }}
</span></template></code></pre>
				</div>
			</div>
		</div>

		<!-- Execution log -->
		<div class="wb-log" v-if="executionLogLines.length > 0">
			<div class="log-header">
				<span class="log-title">Execution Log</span>
				<span class="log-count">{{ executionLogLines.length }} entries</span>
			</div>
			<div class="log-body">
				<div
					v-for="(line, i) in executionLogLines"
					:key="i"
					class="exec-log-line"
					:class="{
						'log-ok': line.includes('completed'),
						'log-err': line.includes('errored'),
						'log-trigger': line.includes('Triggered'),
					}"
				>
					{{ line }}
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.workflow-builder {
	width: 100%;
	border: 1px solid var(--cr-border);
	border-radius: 16px;
	background: var(--cr-surface);
	overflow: hidden;
}

/* ── Header ── */
.wb-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16px 24px;
	border-bottom: 1px solid var(--cr-border-subtle);
	background: var(--cr-surface-raised);
	flex-wrap: wrap;
	gap: 12px;
}

.wb-title {
	font-family: "Instrument Sans", "Outfit", sans-serif;
	font-size: 1.1rem;
	font-weight: 600;
	color: var(--cr-text);
	display: flex;
	align-items: center;
	gap: 8px;
}

.wb-icon {
	color: var(--cr-aqua);
	font-size: 1.2rem;
}

.wb-controls {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}

.template-select {
	padding: 6px 12px;
	border: 1px solid var(--cr-border);
	border-radius: 8px;
	background: var(--cr-surface);
	color: var(--cr-text);
	font-family: var(--vp-font-family-base);
	font-size: 0.85rem;
	cursor: pointer;
	outline: none;
}

.template-select:focus {
	border-color: var(--cr-aqua);
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
	transition: background 0.2s, box-shadow 0.2s;
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

.reset-btn {
	padding: 8px 16px;
	border: 1px solid var(--cr-border);
	border-radius: 8px;
	background: transparent;
	color: var(--cr-text-muted);
	font-family: var(--vp-font-family-base);
	font-size: 0.85rem;
	cursor: pointer;
	transition: all 0.15s;
}

.reset-btn:hover:not(:disabled) {
	border-color: var(--cr-text-muted);
	color: var(--cr-text);
}

.reset-btn:disabled {
	opacity: 0.4;
	cursor: not-allowed;
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
	to { transform: rotate(360deg); }
}

.status-badge {
	padding: 4px 10px;
	border-radius: 6px;
	font-family: var(--vp-font-family-mono);
	font-size: 0.75rem;
	font-weight: 500;
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

.status-badge.idle { background: var(--cr-surface); color: var(--cr-text-muted); }
.status-badge.active { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
.status-badge.completed { background: rgba(77, 232, 194, 0.15); color: var(--cr-aqua); }
.status-badge.errored { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

.run-count {
	color: var(--cr-text-muted);
	font-size: 0.85rem;
	font-family: var(--vp-font-family-mono);
}

/* ── Parameter controls ── */
.wb-params {
	display: flex;
	align-items: center;
	gap: 24px;
	padding: 12px 24px;
	border-bottom: 1px solid var(--cr-border-subtle);
	background: var(--cr-surface-raised);
	flex-wrap: wrap;
}

.param-group {
	display: flex;
	align-items: center;
	gap: 8px;
}

.param-label {
	font-family: var(--vp-font-family-mono);
	font-size: 0.72rem;
	color: var(--cr-text-muted);
	text-transform: uppercase;
	letter-spacing: 0.05em;
	white-space: nowrap;
}

.param-slider {
	width: 100px;
	accent-color: var(--cr-aqua);
}

.param-value {
	font-family: var(--vp-font-family-mono);
	font-size: 0.78rem;
	color: var(--cr-aqua-dim);
	min-width: 40px;
}

.param-info {
	font-size: 0.78rem;
	color: var(--cr-text-muted);
	margin-left: auto;
}

/* ── Body layout ── */
.wb-body {
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
	min-width: 140px;
	border: 1.5px solid var(--cr-border);
	border-radius: 10px;
	background: var(--cr-surface-raised);
	cursor: default;
	transition: border-color 0.3s, box-shadow 0.3s, transform 0.2s;
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
	0%, 100% { opacity: 1; transform: scale(1); }
	50% { opacity: 0.5; transform: scale(1.4); }
}

.node-label {
	font-family: var(--vp-font-family-base);
	font-size: 0.85rem;
	font-weight: 500;
	color: var(--cr-text);
	white-space: nowrap;
}

/* ── Popover ── */
.node-popover {
	position: absolute;
	transform: translateX(-50%);
	width: 220px;
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
	transition: opacity 0.15s, transform 0.15s;
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

.pop-value.idle { color: var(--cr-text-muted); }
.pop-value.running { color: #3b82f6; }
.pop-value.success { color: var(--cr-aqua); }
.pop-value.error { color: #ef4444; }
.pop-value.skipped { color: var(--cr-accent-warm); }

.circuit-closed { color: var(--cr-aqua); }
.circuit-open { color: #ef4444; }
.circuit-half-open { color: var(--cr-accent-warm); }

/* ── Popover logs ── */
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

.log-ok { color: var(--cr-aqua-dim); }
.log-err { color: #ef4444; }
.log-start { color: #3b82f6; }
.log-skip { color: var(--cr-accent-warm); }

/* ── Code panel ── */
.code-panel {
	display: flex;
	flex-direction: column;
	background: #091322;
	max-height: 350px;
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
}

.line-num {
	display: inline-block;
	width: 36px;
	min-width: 36px;
	color: #3a4a5e;
	user-select: none;
	text-align: right;
	margin-right: 16px;
}

/* ── Execution log ── */
.wb-log {
	border-top: 1px solid var(--cr-border-subtle);
}

.log-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 24px;
	background: var(--cr-surface-raised);
	border-bottom: 1px solid var(--cr-border-subtle);
}

.log-title {
	font-family: var(--vp-font-family-mono);
	font-size: 0.72rem;
	color: var(--cr-text-muted);
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

.log-count {
	font-family: var(--vp-font-family-mono);
	font-size: 0.7rem;
	color: var(--cr-text-muted);
}

.log-body {
	padding: 12px 24px;
	max-height: 150px;
	overflow: auto;
}

.exec-log-line {
	font-family: var(--vp-font-family-mono);
	font-size: 0.72rem;
	color: var(--cr-text-muted);
	padding: 2px 0;
	line-height: 1.4;
}

.exec-log-line.log-ok { color: var(--cr-aqua-dim); }
.exec-log-line.log-err { color: #ef4444; }
.exec-log-line.log-trigger { color: #3b82f6; }

/* ── Vue Flow overrides ── */
.vue-flow-wrapper :deep(.vue-flow__edge-path) {
	transition: stroke 0.3s, stroke-width 0.3s;
}

.vue-flow-wrapper :deep(.vue-flow__background) {
	background: var(--cr-surface) !important;
}

.vue-flow-wrapper :deep(.vue-flow__pane) {
	cursor: default;
}

.vue-flow-wrapper :deep(.vue-flow__handle) {
	width: 8px;
	height: 8px;
	background: var(--cr-border);
	border: 1px solid var(--cr-surface);
}

/* ── Responsive ── */
@media (max-width: 768px) {
	.wb-params {
		flex-direction: column;
		align-items: flex-start;
	}

	.param-info {
		margin-left: 0;
	}
}
</style>
