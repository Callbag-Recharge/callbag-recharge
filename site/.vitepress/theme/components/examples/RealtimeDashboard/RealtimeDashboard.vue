<script setup lang="ts">
import type { ServiceMetric } from "@examples/realtime-dashboard";
import {
	healthSummary,
	recentEvents,
	resetDashboard,
	running,
	services,
	startSimulation,
	stopSimulation,
	totalEvents,
} from "@examples/realtime-dashboard";
import dashRaw from "@examples/realtime-dashboard.ts?raw";
import { useSubscribe } from "callbag-recharge/compat/vue";
import { nextTick, onUnmounted, ref, watch } from "vue";

// Source code
const REGION_START = "// #region display";
const REGION_END = "// #endregion display";
const s = dashRaw.indexOf(REGION_START);
const e = dashRaw.indexOf(REGION_END);
const after = s >= 0 ? dashRaw.indexOf("\n", s) : -1;
const rawRegion = s >= 0 && e > s && after >= 0 ? dashRaw.slice(after + 1, e).trimEnd() : dashRaw;
const dLines = rawRegion.split("\n");
const minI = dLines
	.filter((l) => l.trim().length > 0)
	.reduce((m, l) => {
		const x = l.match(/^(\t+)/);
		return x ? Math.min(m, x[1].length) : m;
	}, Infinity);
const SOURCE =
	minI > 0 && minI < Infinity
		? dLines
				.map((l) => {
					let s = l;
					for (let t = 0; t < minI && s.startsWith("\t"); t++) s = s.slice(1);
					return s.replace(/\t/g, "  ");
				})
				.join("\n")
		: rawRegion.replace(/\t/g, "  ");

const codeLines = SOURCE.split("\n");

// Reactive bindings
const isRunning = useSubscribe(running);
const health = useSubscribe(healthSummary);
const eventCount = useSubscribe(totalEvents);
const recent = useSubscribe(recentEvents);
const svcSize = useSubscribe(services.sizeStore);
const svcEntries = useSubscribe(services.keysStore);

function getService(key: string): ServiceMetric | undefined {
	return services.get(key);
}

function healthColor(m: ServiceMetric): string {
	if (m.errorRate > 0.05 || m.latencyMs > 1000) return "#f85149";
	if (m.errorRate > 0.02 || m.latencyMs > 500) return "#d29922";
	return "#3fb950";
}

function formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString();
}

const showCode = ref(false);

// Highlight: map UI sections to code ranges
const hoveredSection = ref<string | null>(null);
const SECTION_PATTERNS: Record<string, RegExp> = {
	services: /\bservices\b|reactiveMap/,
	events: /\beventLog\b|reactiveLog|recentEvents/,
	health: /\bhealthSummary\b|healthy|warning|critical/,
	simulation: /\bstartSimulation\b|\bstopSimulation\b|simulate/,
};

const highlightMap: Record<string, number[]> = {};
codeLines.forEach((line: string, i: number) => {
	for (const [id, pattern] of Object.entries(SECTION_PATTERNS)) {
		if (pattern.test(line)) {
			if (!highlightMap[id]) highlightMap[id] = [];
			highlightMap[id].push(i);
		}
	}
});

const codeBodyRef = ref<HTMLElement | null>(null);

function isLineHighlighted(lineIdx: number): boolean {
	if (!hoveredSection.value) return false;
	return highlightMap[hoveredSection.value]?.includes(lineIdx) ?? false;
}

watch(hoveredSection, () => {
	if (!hoveredSection.value || !codeBodyRef.value) return;
	nextTick(() => {
		const el = codeBodyRef.value?.querySelector(".code-line.highlighted");
		if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
	});
});

onUnmounted(() => {
	resetDashboard();
});
</script>

<template>
  <div class="dash-demo">
    <div class="dash-panel">
      <div class="header">
        <div>
          <h3>Real-time Dashboard</h3>
          <p class="subtitle">reactiveMap + reactiveLog + derived aggregation</p>
        </div>
        <div class="controls">
          <button @click="isRunning ? stopSimulation() : startSimulation()" :class="isRunning ? 'btn-stop' : 'btn-start'">
            {{ isRunning ? 'Stop' : 'Start' }}
          </button>
          <button @click="resetDashboard()" class="btn-reset">Reset</button>
        </div>
      </div>

      <!-- Health summary -->
      <div class="summary-row"
        @mouseenter="hoveredSection = 'health'" @mouseleave="hoveredSection = null">
        <div class="summary-card ok">
          <div class="summary-num">{{ health.healthy }}</div>
          <div class="summary-label">Healthy</div>
        </div>
        <div class="summary-card warn">
          <div class="summary-num">{{ health.warning }}</div>
          <div class="summary-label">Warning</div>
        </div>
        <div class="summary-card crit">
          <div class="summary-num">{{ health.critical }}</div>
          <div class="summary-label">Critical</div>
        </div>
        <div class="summary-card total">
          <div class="summary-num">{{ eventCount }}</div>
          <div class="summary-label">Events</div>
        </div>
      </div>

      <!-- Service cards -->
      <div class="services"
        @mouseenter="hoveredSection = 'services'" @mouseleave="hoveredSection = null">
        <div v-for="key in svcEntries" :key="key" class="svc-card" v-if="getService(key)">
          <div class="svc-header">
            <span class="svc-dot" :style="{ background: healthColor(getService(key)!) }"></span>
            <span class="svc-name">{{ key }}</span>
          </div>
          <div class="svc-metrics">
            <div><span class="metric-label">Latency</span> <span class="metric-val">{{ getService(key)!.latencyMs }}ms</span></div>
            <div><span class="metric-label">Error rate</span> <span class="metric-val">{{ (getService(key)!.errorRate * 100).toFixed(1) }}%</span></div>
            <div><span class="metric-label">Requests</span> <span class="metric-val">{{ getService(key)!.requestCount }}</span></div>
          </div>
        </div>
        <div v-if="svcSize === 0" class="empty">Click Start to begin simulation</div>
      </div>

      <!-- Event tail -->
      <div class="event-log"
        @mouseenter="hoveredSection = 'events'" @mouseleave="hoveredSection = null">
        <h4>Recent Events <span class="event-count">(last 10)</span></h4>
        <div class="events">
          <div v-for="(ev, i) in recent" :key="i" class="event-row" :class="{ 'event-error': ev.value.isError }">
            <span class="ev-time">{{ formatTime(ev.value.timestamp) }}</span>
            <span class="ev-svc">{{ ev.value.service }}</span>
            <span class="ev-lat">{{ ev.value.latencyMs }}ms</span>
            <span v-if="ev.value.isError" class="ev-err">ERR</span>
          </div>
          <div v-if="recent.length === 0" class="empty">No events yet</div>
        </div>
      </div>
    </div>

    <!-- Code panel -->
    <div class="code-toggle">
      <button @click="showCode = !showCode" class="btn-code">{{ showCode ? 'Hide Source' : 'Show Source' }}</button>
    </div>
    <div v-if="showCode" class="code-panel">
      <div class="code-header">
        <span class="code-filename">realtime-dashboard.ts</span>
        <span class="code-badge">{{ codeLines.length }} lines</span>
      </div>
      <div class="code-body" ref="codeBodyRef">
        <pre><code><template
  v-for="(line, i) in codeLines"
  :key="i"
><span
  class="code-line"
  :class="{ highlighted: isLineHighlighted(i) }"
><span class="line-num">{{ String(i + 1).padStart(3, ' ') }}</span>{{ line }}
</span></template></code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dash-demo { font-family: 'Instrument Sans', -apple-system, sans-serif; max-width: 600px; margin: 0 auto; }
.dash-panel { background: #0d1117; border: 1px solid #21262d; border-radius: 12px; padding: 24px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
h3 { color: #e6edf3; margin: 0 0 4px; font-size: 18px; }
h4 { color: #c9d1d9; margin: 0 0 8px; font-size: 14px; }
.subtitle { color: #7d8590; font-size: 13px; margin: 0; }
.controls { display: flex; gap: 6px; }
.btn-start { background: #238636; color: #fff; border: none; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.btn-stop { background: #da3633; color: #fff; border: none; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.btn-reset { background: transparent; color: #7d8590; border: 1px solid #30363d; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.summary-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; padding: 4px; border-radius: 8px; transition: background 0.15s; }
.summary-row:hover { background: rgba(88, 166, 255, 0.04); }
.summary-card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 12px; text-align: center; }
.summary-num { font-size: 24px; font-weight: 600; }
.summary-label { font-size: 11px; color: #7d8590; margin-top: 2px; }
.ok .summary-num { color: #3fb950; }
.warn .summary-num { color: #d29922; }
.crit .summary-num { color: #f85149; }
.total .summary-num { color: #58a6ff; }
.services { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin-bottom: 16px; padding: 4px; border-radius: 8px; transition: background 0.15s; }
.services:hover { background: rgba(88, 166, 255, 0.04); }
.svc-card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 10px 12px; }
.svc-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.svc-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.svc-name { color: #e6edf3; font-size: 12px; font-weight: 500; }
.svc-metrics { display: flex; flex-direction: column; gap: 2px; }
.metric-label { color: #7d8590; font-size: 11px; }
.metric-val { color: #c9d1d9; font-size: 11px; float: right; }
.event-log { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 12px; transition: background 0.15s; }
.event-log:hover { background: #1a2230; }
.event-count { color: #7d8590; font-weight: 400; }
.events { display: flex; flex-direction: column; gap: 2px; }
.event-row { display: flex; gap: 8px; font-size: 11px; padding: 3px 0; font-family: 'JetBrains Mono', monospace; }
.ev-time { color: #7d8590; min-width: 70px; }
.ev-svc { color: #c9d1d9; min-width: 120px; }
.ev-lat { color: #58a6ff; min-width: 50px; }
.ev-err { color: #f85149; font-weight: 600; }
.event-error { background: rgba(248, 81, 73, 0.08); border-radius: 3px; padding: 3px 4px; }
.empty { color: #484f58; font-size: 13px; text-align: center; padding: 16px; }
.code-toggle { margin-top: 12px; }
.btn-code { background: transparent; color: #58a6ff; border: 1px solid #21262d; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.code-panel { margin-top: 8px; background: #0d1117; border: 1px solid #21262d; border-radius: 8px; overflow: hidden; }
.code-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid #21262d; }
.code-filename { font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: #58a6ff; }
.code-badge { font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: #7d8590; padding: 2px 8px; border: 1px solid #21262d; border-radius: 4px; }
.code-body { overflow: auto; max-height: 400px; padding: 12px 0; }
.code-body pre { margin: 0; background: transparent !important; border: none !important; box-shadow: none !important; }
.code-body code { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; line-height: 1.6; background: transparent !important; border: none !important; color: #8b949e !important; padding: 0 !important; }
.code-line { display: block; padding: 0 16px; transition: background 0.2s, color 0.2s; }
.code-line.highlighted { background: rgba(77, 232, 194, 0.08); color: #4de8c2 !important; }
.line-num { display: inline-block; width: 36px; min-width: 36px; color: #3a4a5e; user-select: none; text-align: right; margin-right: 16px; }
</style>
