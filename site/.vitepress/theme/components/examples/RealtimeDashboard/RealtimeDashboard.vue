<script setup lang="ts">
import type { ServiceMetric } from "@examples/realtime-dashboard";
import {
	healthSummary,
	recentEvents,
	resetDashboard,
	running,
	services,
	totalEvents,
} from "@examples/realtime-dashboard";
import dashRaw from "@examples/realtime-dashboard.ts?raw";
import { useSubscribe } from "callbag-recharge/compat/vue";
import { onUnmounted, ref } from "vue";

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
const _SOURCE =
	minI > 0 && minI < Infinity
		? dLines.map((l) => l.slice(minI).replace(/\t/g, "  ")).join("\n")
		: rawRegion.replace(/\t/g, "  ");

// Reactive bindings
const _isRunning = useSubscribe(running);
const _health = useSubscribe(healthSummary);
const _eventCount = useSubscribe(totalEvents);
const _recent = useSubscribe(recentEvents);
const _svcSize = useSubscribe(services.sizeStore);

// Re-render service cards reactively
const _svcEntries = useSubscribe(services.keysStore);

function _getService(key: string): ServiceMetric | undefined {
	return services.get(key);
}

function _healthColor(m: ServiceMetric): string {
	if (m.errorRate > 0.05 || m.latencyMs > 1000) return "#f85149";
	if (m.errorRate > 0.02 || m.latencyMs > 500) return "#d29922";
	return "#3fb950";
}

function _formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString();
}

const _showCode = ref(false);

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
      <div class="summary-row">
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
      <div class="services">
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
      <div class="event-log">
        <h4>Recent Events <span class="event-count">(last 10)</span></h4>
        <div class="events">
          <div v-for="(ev, i) in recent" :key="i" class="event-row" :class="{ 'event-error': ev.isError }">
            <span class="ev-time">{{ formatTime(ev.timestamp) }}</span>
            <span class="ev-svc">{{ ev.service }}</span>
            <span class="ev-lat">{{ ev.latencyMs }}ms</span>
            <span v-if="ev.isError" class="ev-err">ERR</span>
          </div>
          <div v-if="recent.length === 0" class="empty">No events yet</div>
        </div>
      </div>
    </div>

    <div class="code-toggle">
      <button @click="showCode = !showCode" class="btn-code">{{ showCode ? 'Hide Source' : 'Show Source' }}</button>
    </div>
    <div v-if="showCode" class="code-panel">
      <pre><code>{{ SOURCE }}</code></pre>
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
.summary-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
.summary-card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 12px; text-align: center; }
.summary-num { font-size: 24px; font-weight: 600; }
.summary-label { font-size: 11px; color: #7d8590; margin-top: 2px; }
.ok .summary-num { color: #3fb950; }
.warn .summary-num { color: #d29922; }
.crit .summary-num { color: #f85149; }
.total .summary-num { color: #58a6ff; }
.services { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin-bottom: 16px; }
.svc-card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 10px 12px; }
.svc-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.svc-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.svc-name { color: #e6edf3; font-size: 12px; font-weight: 500; }
.svc-metrics { display: flex; flex-direction: column; gap: 2px; }
.metric-label { color: #7d8590; font-size: 11px; }
.metric-val { color: #c9d1d9; font-size: 11px; float: right; }
.event-log { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 12px; }
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
.code-panel { margin-top: 8px; background: #0d1117; border: 1px solid #21262d; border-radius: 8px; padding: 16px; overflow-x: auto; }
.code-panel pre { margin: 0; }
.code-panel code { color: #c9d1d9; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.5; white-space: pre; }
</style>
