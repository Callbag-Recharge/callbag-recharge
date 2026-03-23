<script setup lang="ts">
import {
	availableEvents,
	currentState,
	order,
	orderContext,
	transitions,
} from "@examples/state-machine";
import smRaw from "@examples/state-machine.ts?raw";
import { useSubscribe } from "callbag-recharge/compat/vue";
import { ref } from "vue";

// Source code
const REGION_START = "// #region display";
const REGION_END = "// #endregion display";
const s = smRaw.indexOf(REGION_START);
const e = smRaw.indexOf(REGION_END);
const after = s >= 0 ? smRaw.indexOf("\n", s) : -1;
const rawRegion = s >= 0 && e > s && after >= 0 ? smRaw.slice(after + 1, e).trimEnd() : smRaw;
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
const state = useSubscribe(currentState);
const _ctx = useSubscribe(orderContext);
const _events = useSubscribe(availableEvents);

// All states for the graph
const _ALL_STATES = [
	"draft",
	"reviewing",
	"processing",
	"confirmed",
	"shipped",
	"delivered",
	"cancelled",
	"error",
] as const;

// Graph layout positions (circular-ish)
const _positions: Record<string, { x: number; y: number }> = {
	draft: { x: 60, y: 40 },
	reviewing: { x: 220, y: 40 },
	processing: { x: 380, y: 40 },
	confirmed: { x: 380, y: 160 },
	shipped: { x: 220, y: 160 },
	delivered: { x: 60, y: 160 },
	cancelled: { x: 140, y: 250 },
	error: { x: 300, y: 250 },
};

function _stateColor(s: string): string {
	if (s === state.value) return "#58a6ff";
	// Check if reachable from current
	const reachable = transitions.filter((t) => t.from === state.value).map((t) => t.to);
	if (reachable.includes(s as any)) return "#30363d";
	return "#1c2128";
}

function _stateBorder(s: string): string {
	if (s === state.value) return "2px solid #58a6ff";
	const reachable = transitions.filter((t) => t.from === state.value).map((t) => t.to);
	if (reachable.includes(s as any)) return "2px solid #30363d";
	return "1px solid #21262d";
}

const history = ref<Array<{ from: string; event: string; to: string }>>([]);

function _sendEvent(ev: string) {
	const from = state.value;
	const ok = order.send(ev as any);
	if (ok) {
		history.value = [...history.value, { from, event: ev, to: state.value }];
	}
}

function _resetMachine() {
	order.reset();
	history.value = [];
}

const _showCode = ref(false);
const _showMermaid = ref(false);
</script>

<template>
  <div class="sm-demo">
    <div class="sm-panel">
      <h3>Order Workflow</h3>
      <p class="subtitle">stateMachine + declarative transitions + toMermaid()</p>

      <!-- State graph -->
      <div class="graph-container">
        <svg class="graph-svg" viewBox="0 0 480 300" xmlns="http://www.w3.org/2000/svg">
          <!-- Edges -->
          <g v-for="t in transitions" :key="`${t.from}-${t.event}-${t.to}`">
            <line
              :x1="positions[t.from].x + 40" :y1="positions[t.from].y + 18"
              :x2="positions[t.to].x + 40" :y2="positions[t.to].y + 18"
              :stroke="t.from === state ? '#58a6ff' : '#21262d'"
              stroke-width="1.5"
              :opacity="t.from === state ? 0.8 : 0.3"
              marker-end="url(#arrow)"
            />
          </g>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#58a6ff" />
            </marker>
          </defs>
          <!-- Nodes -->
          <g v-for="s in ALL_STATES" :key="s">
            <rect
              :x="positions[s].x" :y="positions[s].y"
              width="80" height="36" rx="6"
              :fill="stateColor(s)"
              :stroke="s === state ? '#58a6ff' : '#30363d'"
              :stroke-width="s === state ? 2 : 1"
            />
            <text
              :x="positions[s].x + 40" :y="positions[s].y + 22"
              text-anchor="middle" :fill="s === state ? '#fff' : '#8b949e'"
              font-size="11" font-family="JetBrains Mono, monospace"
            >{{ s }}</text>
          </g>
        </svg>
      </div>

      <!-- Current state + context -->
      <div class="state-info">
        <div class="state-current">
          <span class="state-label">State:</span>
          <span class="state-value">{{ state }}</span>
        </div>
        <div class="ctx-row">
          <span class="ctx-item">Order: {{ ctx.orderId }}</span>
          <span class="ctx-item">Items: {{ ctx.items.length }}</span>
          <span class="ctx-item">Total: ${{ ctx.total }}</span>
          <span class="ctx-item">Attempts: {{ ctx.attempts }}</span>
        </div>
      </div>

      <!-- Event buttons -->
      <div class="event-buttons">
        <button
          v-for="ev in events" :key="ev"
          @click="sendEvent(ev)"
          class="btn-event"
        >{{ ev }}</button>
        <button @click="resetMachine" class="btn-reset">Reset</button>
      </div>

      <!-- Transition history -->
      <div v-if="history.length" class="history">
        <h4>Transition History</h4>
        <div v-for="(h, i) in history" :key="i" class="history-row">
          <span class="hist-from">{{ h.from }}</span>
          <span class="hist-arrow">→</span>
          <span class="hist-event">{{ h.event }}</span>
          <span class="hist-arrow">→</span>
          <span class="hist-to">{{ h.to }}</span>
        </div>
      </div>
    </div>

    <!-- Toggles -->
    <div class="code-toggle">
      <button @click="showMermaid = !showMermaid" class="btn-code">{{ showMermaid ? 'Hide Diagram' : 'Mermaid Diagram' }}</button>
      <button @click="showCode = !showCode" class="btn-code">{{ showCode ? 'Hide Source' : 'Show Source' }}</button>
    </div>
    <div v-if="showMermaid" class="code-panel">
      <pre><code>{{ mermaidDiagram }}</code></pre>
    </div>
    <div v-if="showCode" class="code-panel">
      <pre><code>{{ SOURCE }}</code></pre>
    </div>
  </div>
</template>

<style scoped>
.sm-demo { font-family: 'Instrument Sans', -apple-system, sans-serif; max-width: 540px; margin: 0 auto; }
.sm-panel { background: #0d1117; border: 1px solid #21262d; border-radius: 12px; padding: 24px; }
h3 { color: #e6edf3; margin: 0 0 4px; font-size: 18px; }
h4 { color: #c9d1d9; margin: 0 0 8px; font-size: 13px; }
.subtitle { color: #7d8590; font-size: 13px; margin: 0 0 16px; }
.graph-container { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 8px; margin-bottom: 16px; }
.graph-svg { width: 100%; height: auto; }
.state-info { margin-bottom: 12px; }
.state-current { margin-bottom: 4px; }
.state-label { color: #7d8590; font-size: 13px; }
.state-value { color: #58a6ff; font-size: 15px; font-weight: 600; margin-left: 8px; font-family: 'JetBrains Mono', monospace; }
.ctx-row { display: flex; gap: 12px; flex-wrap: wrap; }
.ctx-item { color: #8b949e; font-size: 12px; font-family: 'JetBrains Mono', monospace; }
.event-buttons { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.btn-event { background: #21262d; color: #58a6ff; border: 1px solid #30363d; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; transition: background 0.15s; }
.btn-event:hover { background: #30363d; }
.btn-reset { background: transparent; color: #7d8590; border: 1px solid #30363d; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.history { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 12px; }
.history-row { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 0; font-family: 'JetBrains Mono', monospace; }
.hist-from { color: #8b949e; }
.hist-arrow { color: #484f58; }
.hist-event { color: #d29922; font-weight: 500; }
.hist-to { color: #58a6ff; }
.code-toggle { margin-top: 12px; display: flex; gap: 6px; }
.btn-code { background: transparent; color: #58a6ff; border: 1px solid #21262d; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.code-panel { margin-top: 8px; background: #0d1117; border: 1px solid #21262d; border-radius: 8px; padding: 16px; overflow-x: auto; }
.code-panel pre { margin: 0; }
.code-panel code { color: #c9d1d9; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.5; white-space: pre; }
</style>
