<script setup lang="ts">
import {
	availableEvents,
	currentState,
	mermaidDiagram,
	order,
	orderContext,
	transitions,
} from "@examples/state-machine";
import smRaw from "@examples/state-machine.ts?raw";
import { useSubscribe } from "callbag-recharge/compat/vue";
import { nextTick, onMounted, ref, watch } from "vue";

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
const state = useSubscribe(currentState);
const ctx = useSubscribe(orderContext);
const events = useSubscribe(availableEvents);

// All states for the graph
const ALL_STATES = [
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
const positions: Record<string, { x: number; y: number }> = {
	draft: { x: 60, y: 40 },
	reviewing: { x: 220, y: 40 },
	processing: { x: 380, y: 40 },
	confirmed: { x: 380, y: 160 },
	shipped: { x: 220, y: 160 },
	delivered: { x: 60, y: 160 },
	cancelled: { x: 140, y: 250 },
	error: { x: 300, y: 250 },
};

function stateColor(s: string): string {
	if (s === state.value) return "#58a6ff";
	const reachable = transitions.filter((t) => t.from === state.value).map((t) => t.to);
	if (reachable.includes(s as any)) return "#30363d";
	return "#1c2128";
}

function stateBorder(s: string): string {
	if (s === state.value) return "2px solid #58a6ff";
	const reachable = transitions.filter((t) => t.from === state.value).map((t) => t.to);
	if (reachable.includes(s as any)) return "2px solid #30363d";
	return "1px solid #21262d";
}

const history = ref<Array<{ from: string; event: string; to: string }>>([]);

// Hover highlighting
const hoveredState = ref<string | null>(null);

const highlightMap: Record<string, number[]> = {};
codeLines.forEach((line: string, i: number) => {
	for (const st of ALL_STATES) {
		if (new RegExp(`["']${st}["']`).test(line)) {
			if (!highlightMap[st]) highlightMap[st] = [];
			highlightMap[st].push(i);
		}
	}
});

function isLineHighlighted(lineIdx: number): boolean {
	if (!hoveredState.value) return false;
	return highlightMap[hoveredState.value]?.includes(lineIdx) ?? false;
}

function sendEvent(ev: string) {
	const from = state.value;
	const ok = order.send(ev as any);
	if (ok) {
		history.value = [...history.value, { from, event: ev, to: state.value }];
	}
}

function resetMachine() {
	order.reset();
	history.value = [];
}

const showCode = ref(false);
const showMermaid = ref(false);
const codeBodyRef = ref<HTMLElement | null>(null);
const mermaidRef = ref<HTMLElement | null>(null);
const mermaidSvg = ref("");

watch(hoveredState, () => {
	if (!hoveredState.value || !codeBodyRef.value) return;
	nextTick(() => {
		const el = codeBodyRef.value?.querySelector(".code-line.highlighted");
		if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
	});
});

async function renderMermaid() {
	const mermaid = (await import("mermaid")).default;
	mermaid.initialize({ startOnLoad: false, theme: "dark" });
	const { svg } = await mermaid.render("sm-mermaid", mermaidDiagram);
	mermaidSvg.value = svg;
}

watch(showMermaid, (val) => {
	if (val && !mermaidSvg.value) renderMermaid();
});
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
          <g v-for="s in ALL_STATES" :key="s"
            @mouseenter="hoveredState = s" @mouseleave="hoveredState = null"
            style="cursor: pointer;">
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
        <div v-if="ctx.error" class="error-row">{{ ctx.error }}</div>
      </div>

      <!-- Event buttons -->
      <div class="event-buttons">
        <button
          v-for="ev in events.filter(e => e !== 'FAIL')" :key="ev"
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
          <span class="hist-arrow">&rarr;</span>
          <span class="hist-event">{{ h.event }}</span>
          <span class="hist-arrow">&rarr;</span>
          <span class="hist-to">{{ h.to }}</span>
        </div>
      </div>
    </div>

    <!-- Toggles -->
    <div class="code-toggle">
      <button @click="showMermaid = !showMermaid" class="btn-code">{{ showMermaid ? 'Hide Diagram' : 'Mermaid Diagram' }}</button>
      <button @click="showCode = !showCode" class="btn-code">{{ showCode ? 'Hide Source' : 'Show Source' }}</button>
    </div>
    <div v-if="showMermaid" class="mermaid-panel">
      <div v-if="mermaidSvg" v-html="mermaidSvg" class="mermaid-render" />
      <div v-else class="mermaid-loading">Rendering diagram...</div>
    </div>
    <div v-if="showCode" class="code-panel">
      <div class="code-header">
        <span class="code-filename">state-machine.ts</span>
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
.error-row { color: #f85149; font-size: 12px; font-family: 'JetBrains Mono', monospace; margin-top: 4px; padding: 4px 8px; background: rgba(248, 81, 73, 0.1); border-radius: 4px; }
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
.mermaid-panel { margin-top: 8px; background: #0d1117; border: 1px solid #21262d; border-radius: 8px; overflow: hidden; padding: 16px; }
.mermaid-render { display: flex; justify-content: center; }
.mermaid-render :deep(svg) { max-width: 100%; height: auto; }
.mermaid-loading { color: #7d8590; font-size: 13px; text-align: center; padding: 16px; }
.code-panel { margin-top: 8px; background: #0d1117; border: 1px solid #21262d; border-radius: 8px; overflow: hidden; }
.code-panel > pre { margin: 0; padding: 16px; }
.code-panel > pre code { color: #c9d1d9; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.5; white-space: pre; }
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
