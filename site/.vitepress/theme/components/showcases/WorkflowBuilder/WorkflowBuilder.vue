<script setup lang="ts">
import { Background } from "@vue-flow/background";
import { Position, VueFlow } from "@vue-flow/core";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import { createWorkflowBuilder, presets, type WorkflowNode } from "@examples/workflow-builder";
import { useSubscribe, useSubscribeRecord } from "callbag-recharge/compat/vue";
import { computed, onUnmounted, ref, watchEffect } from "vue";
import { useAutoFitFlow } from "../../shared/useAutoFitFlow";
import { useLockPageScroll } from "../../shared/useLockPageScroll";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
const wb = createWorkflowBuilder();
onUnmounted(() => wb.destroy());

// ---------------------------------------------------------------------------
// Reactive refs
// ---------------------------------------------------------------------------
const selectedTemplate = useSubscribe(wb.selectedTemplate);
const running = useSubscribe(wb.running);
const runCount = useSubscribe(wb.runCount);
const pipelineStatus = useSubscribe(wb.pipelineStatus);
const nodesRef = useSubscribe(wb.nodes);
const edgesRef = useSubscribe(wb.edges);
const layoutRef = useSubscribe(wb.layout);
const durationRange = useSubscribe(wb.durationRange);
const failRate = useSubscribe(wb.failRate);
const parseError = useSubscribe(wb.parseError);
const executionLogLatest = useSubscribe(wb.execLog.latest);

// ---------------------------------------------------------------------------
// Editable code
// ---------------------------------------------------------------------------
const editorCode = ref(wb.code.get());
const codeChanged = ref(false);

function onCodeInput(e: Event) {
	editorCode.value = (e.target as HTMLTextAreaElement).value;
	codeChanged.value = true;
}

function onUpdateCode() {
	wb.updateCode(editorCode.value);
	codeChanged.value = false;
}

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
			nodeLogs.value[n.id] = [...current.slice(-5), entry.value];
		}
	}
});

// Execution log accumulator — formats ExecutionEntry into display strings
const executionLogLines = ref<string[]>([]);
let lastLogTimestamp = 0;
watchEffect(() => {
	const entry = executionLogLatest.value;
	if (entry && entry.timestamp !== lastLogTimestamp) {
		lastLogTimestamp = entry.timestamp;
		const time = new Date(entry.timestamp).toISOString().slice(11, 23);
		let line = `[${time}] ${entry.step}: ${entry.event}`;
		if (entry.event === "error" && entry.error) {
			const msg = entry.error instanceof Error ? entry.error.message : String(entry.error);
			line += ` — ${msg}`;
		}
		executionLogLines.value = [...executionLogLines.value.slice(-29), line];
	}
});

// ---------------------------------------------------------------------------
// Preset selector
// ---------------------------------------------------------------------------
function onPresetChange(e: Event) {
	const id = (e.target as HTMLSelectElement).value;
	wb.selectTemplate(id);
	editorCode.value = wb.code.get();
	codeChanged.value = false;
	executionLogLines.value = [];
	lastLogTimestamp = 0;
	wb.execLog.clear();
	nodeLogs.value = {};
	lastLogEntry.clear();
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
const isFullscreen = ref(false);
useLockPageScroll(isFullscreen);
const hoveredNode = ref<string | null>(null);
const graphPanelRef = ref<HTMLElement | null>(null);
const popoverPos = ref<{ x: number; y: number; above: boolean }>({ x: 0, y: 0, above: false });
const hasExecutionLog = computed(() => executionLogLines.value.length > 0);
const { onFlowInit } = useAutoFitFlow({
	panelRef: graphPanelRef,
	watchSources: [
		() => isFullscreen.value,
		() => hasExecutionLog.value,
		() => executionLogLines.value.length,
	],
	padding: 0.2,
	duration: 180,
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
	const above = nodeRelY > panelRect.height * 0.55;

	popoverPos.value = {
		x,
		y: above ? nodeRelY : nodeRelY + nodeRect.height,
		above,
	};
}

// ---------------------------------------------------------------------------
// Code line count for display
// ---------------------------------------------------------------------------
const codeLineCount = computed(() => editorCode.value.split("\n").length);
</script>

<template>
	<div class="workflow-builder" :class="{ fullscreen: isFullscreen }">
		<!-- Fullscreen toggle -->
		<button class="fullscreen-btn" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="isFullscreen = !isFullscreen">
			<svg v-if="!isFullscreen" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
			<svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
		</button>

		<!-- Header -->
		<div class="wb-header">
			<div class="wb-title">
				<span class="wb-icon">&#9671;</span>
				Workflow Builder
			</div>
			<div class="wb-controls">
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
		</div>

		<!-- Main body: Code + Graph -->
		<div class="wb-body">
			<!-- Script Pane (editable) -->
			<div class="code-panel">
				<div class="code-header">
					<div class="code-header-left">
						<span class="code-filename">pipeline.ts</span>
						<span class="code-badge">{{ codeLineCount }} lines</span>
					</div>
					<div class="code-header-right">
						<select class="preset-select" :value="selectedTemplate" @change="onPresetChange">
							<option value="" disabled>Presets...</option>
							<option v-for="p in presets" :key="p.id" :value="p.id">
								{{ p.name }}
							</option>
						</select>
						<button
							class="update-btn"
							:class="{ changed: codeChanged }"
							@click="onUpdateCode"
						>
							Update
						</button>
					</div>
				</div>
				<div v-if="parseError" class="parse-error">{{ parseError }}</div>
				<div class="code-body">
					<textarea
						class="code-textarea"
						:value="editorCode"
						spellcheck="false"
						@input="onCodeInput"
					/>
				</div>
			</div>

			<!-- DAG Graph -->
			<div class="graph-panel" ref="graphPanelRef">
				<VueFlow
					:nodes="vfNodes"
					:edges="dynamicEdges"
					:fit-view-on-init="true"
					:fit-view-params="{ padding: 0.2 }"
					:nodes-draggable="false"
					:nodes-connectable="false"
					:zoom-on-scroll="true"
					:pan-on-scroll="false"
					:pan-on-drag="true"
					:prevent-scrolling="true"
					:zoom-on-double-click="true"
					:zoom-on-pinch="true"
					class="vue-flow-wrapper"
					@init="onFlowInit"
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
									'log-value': line.includes('[VALUE]'),
								}"
							>
								{{ line }}
							</div>
						</div>
					</div>
				</Transition>
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
						'log-ok': line.includes('complete'),
						'log-err': line.includes('error'),
						'log-trigger': line.includes('start'),
						'log-value': line.includes('value'),
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

/* ── Body layout ── */
.wb-body {
	display: grid;
	grid-template-columns: 1fr 1fr;
}

/* ── Code panel (editable script pane) ── */
.code-panel {
	display: flex;
	flex-direction: column;
	background: #091322;
	min-width: 0;
	border-right: 1px solid var(--cr-border-subtle);
}

.code-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 16px;
	border-bottom: 1px solid var(--cr-border-subtle);
	gap: 8px;
	flex-wrap: wrap;
}

.code-header-left {
	display: flex;
	align-items: center;
	gap: 8px;
}

.code-header-right {
	display: flex;
	align-items: center;
	gap: 8px;
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

.preset-select {
	padding: 4px 8px;
	border: 1px solid var(--cr-border);
	border-radius: 6px;
	background: var(--cr-surface);
	color: var(--cr-text);
	font-family: var(--vp-font-family-base);
	font-size: 0.78rem;
	cursor: pointer;
	outline: none;
}

.preset-select:focus {
	border-color: var(--cr-aqua);
}

.update-btn {
	padding: 4px 14px;
	border: 1px solid var(--cr-border);
	border-radius: 6px;
	background: transparent;
	color: var(--cr-text-muted);
	font-family: var(--vp-font-family-base);
	font-size: 0.78rem;
	cursor: pointer;
	transition: all 0.2s;
}

.update-btn.changed {
	border-color: var(--cr-aqua);
	color: var(--cr-aqua);
	background: rgba(77, 232, 194, 0.08);
}

.update-btn:hover {
	border-color: var(--cr-aqua);
	color: var(--cr-aqua);
	background: rgba(77, 232, 194, 0.1);
}

.parse-error {
	padding: 8px 16px;
	background: rgba(239, 68, 68, 0.1);
	border-bottom: 1px solid rgba(239, 68, 68, 0.3);
	color: #ef4444;
	font-size: 0.78rem;
	font-family: var(--vp-font-family-mono);
	line-height: 1.4;
}

.code-body {
	flex: 1;
	display: flex;
	min-height: 0;
}

.code-textarea {
	flex: 1;
	width: 100%;
	padding: 16px;
	background: transparent;
	border: none;
	outline: none;
	resize: none;
	color: var(--cr-text-muted);
	font-family: var(--vp-font-family-mono);
	font-size: 0.78rem;
	line-height: 1.6;
	tab-size: 2;
	min-height: 480px;
	white-space: pre;
	overflow-wrap: normal;
	overflow-x: auto;
}

.code-textarea::placeholder {
	color: #3a4a5e;
}

/* ── Graph panel ── */
.graph-panel {
	position: relative;
	min-width: 0;
}

.vue-flow-wrapper {
	width: 100%;
	height: 100%;
	min-height: 480px;
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
.log-value { color: var(--cr-accent-warm); }

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
.exec-log-line.log-value { color: var(--cr-accent-warm); }

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

/* ── Fullscreen toggle ── */
.fullscreen-btn {
	position: absolute;
	top: 10px;
	right: 10px;
	z-index: 10;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	border: 1px solid var(--cr-border-subtle);
	border-radius: 6px;
	background: var(--cr-surface-raised);
	color: var(--cr-text-muted);
	cursor: pointer;
	transition: all 0.15s;
	opacity: 0.6;
}

.fullscreen-btn:hover {
	opacity: 1;
	color: var(--cr-text);
	border-color: var(--cr-border);
}

.workflow-builder {
	position: relative;
}

.workflow-builder.fullscreen {
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	z-index: 9999;
	border-radius: 0;
	border: none;
	display: flex;
	flex-direction: column;
}

.workflow-builder.fullscreen .wb-body {
	flex: 1;
	min-height: 0;
}

.workflow-builder.fullscreen .code-textarea {
	min-height: 0;
	flex: 1;
}

.workflow-builder.fullscreen .vue-flow-wrapper {
	min-height: 0;
	height: 100%;
}

.workflow-builder.fullscreen .graph-panel {
	min-height: 0;
}

/* ── Responsive ── */
@media (max-width: 768px) {
	.wb-body {
		grid-template-columns: 1fr;
	}

	.code-panel {
		border-right: none;
		border-bottom: 1px solid var(--cr-border-subtle);
	}

	.code-textarea {
		min-height: 300px;
	}

	.vue-flow-wrapper {
		min-height: 350px;
	}

	.wb-params {
		flex-direction: column;
		align-items: flex-start;
	}
}
</style>
