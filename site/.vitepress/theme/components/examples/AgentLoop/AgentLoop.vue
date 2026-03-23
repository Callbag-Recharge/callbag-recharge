<script setup lang="ts">
import type { ResearchAction } from "@examples/agent-loop";
import {
	approve,
	context,
	error,
	history,
	iteration,
	lastAction,
	modify,
	pending,
	phase,
	reject,
	startResearch,
	stop,
} from "@examples/agent-loop";
import agentRaw from "@examples/agent-loop.ts?raw";
import { useSubscribe } from "callbag-recharge/compat/vue";
import { nextTick, onUnmounted, ref, watch } from "vue";

// Source code
const REGION_START = "// #region display";
const REGION_END = "// #endregion display";
const s = agentRaw.indexOf(REGION_START);
const e = agentRaw.indexOf(REGION_END);
const after = s >= 0 ? agentRaw.indexOf("\n", s) : -1;
const rawRegion = s >= 0 && e > s && after >= 0 ? agentRaw.slice(after + 1, e).trimEnd() : agentRaw;
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
const currentPhase = useSubscribe(phase);
const ctx = useSubscribe(context);
const action = useSubscribe(lastAction);
const iter = useSubscribe(iteration);
const err = useSubscribe(error);
const hist = useSubscribe(history);
const pendingActions = useSubscribe(pending);

const query = ref("TypeScript reactive state management");
const showCode = ref(false);

// Highlight: map phase names to code line ranges
const hoveredSection = ref<string | null>(null);
const SECTION_PATTERNS: Record<string, RegExp> = {
	observe: /\bobserve\b/,
	plan: /\bplan\b/,
	act: /\bact\b/,
	gate: /\bgate\b|approve|reject/,
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

function phaseColor(p: string): string {
	switch (p) {
		case "idle":
			return "#484f58";
		case "observe":
			return "#58a6ff";
		case "plan":
			return "#d29922";
		case "awaiting_approval":
			return "#f0883e";
		case "act":
			return "#3fb950";
		case "completed":
			return "#3fb950";
		case "errored":
			return "#f85149";
		default:
			return "#7d8590";
	}
}

function handleStart() {
	if (query.value.trim()) {
		startResearch(query.value.trim());
	}
}

onUnmounted(() => {
	stop();
});
</script>

<template>
  <div class="agent-demo">
    <div class="agent-panel">
      <h3>Research Agent</h3>
      <p class="subtitle">agentLoop + gate (human-in-the-loop approval)</p>

      <!-- Query input -->
      <div class="query-row">
        <input v-model="query" placeholder="Ask a question..." class="query-input" @keyup.enter="handleStart" />
        <button @click="handleStart" class="btn-start" :disabled="currentPhase !== 'idle' && currentPhase !== 'completed' && currentPhase !== 'errored'">
          {{ currentPhase === 'idle' || currentPhase === 'completed' || currentPhase === 'errored' ? 'Start' : 'Running...' }}
        </button>
        <button v-if="currentPhase !== 'idle' && currentPhase !== 'completed'" @click="stop()" class="btn-stop">Stop</button>
      </div>

      <!-- Phase flow -->
      <div class="phase-flow">
        <span v-for="(p, i) in ['observe', 'plan', 'gate', 'act']" :key="p"
          class="flow-step"
          :class="{ active: currentPhase === p || (currentPhase === 'awaiting_approval' && p === 'gate') }"
          @mouseenter="hoveredSection = p" @mouseleave="hoveredSection = null">
          {{ p }}
          <span v-if="i < 3" class="flow-arrow">&rarr;</span>
        </span>
        <span class="iter-label" v-if="iter > 0">iteration {{ iter }}/5</span>
      </div>

      <!-- Approval gate -->
      <div v-if="currentPhase === 'awaiting_approval' && pendingActions.length > 0" class="gate-panel"
        @mouseenter="hoveredSection = 'gate'" @mouseleave="hoveredSection = null">
        <div class="gate-header">The agent wants to run:</div>
        <div class="gate-action">
          <span class="gate-tool">{{ pendingActions[0]?.tool }}</span>
          <span class="gate-query">"{{ pendingActions[0]?.query }}"</span>
        </div>
        <div class="gate-hint">Choose an action below to continue the loop:</div>
        <div class="gate-buttons">
          <button @click="approve()" class="btn-approve" title="Run this action as-is">Approve</button>
          <button @click="reject()" class="btn-reject" title="Skip this action and stop the loop">Reject</button>
          <button @click="modify((a: ResearchAction) => ({ ...a, query: a.query + ' advanced' }))" class="btn-modify" title="Append 'advanced' to the query before running">
            Modify query
          </button>
        </div>
      </div>

      <!-- Context panel -->
      <div v-if="ctx" class="context-panel"
        @mouseenter="hoveredSection = 'observe'" @mouseleave="hoveredSection = null">
        <h4>Accumulated Context</h4>
        <div class="ctx-row"><span class="ctx-key">Question:</span> {{ ctx.question }}</div>
        <div class="ctx-row"><span class="ctx-key">Refinements:</span> {{ ctx.refinements.length > 0 ? ctx.refinements.join(', ') : 'none yet' }}</div>
        <div class="ctx-results" v-if="ctx.searchResults.length > 0">
          <span class="ctx-key">Search results ({{ ctx.searchResults.length }}):</span>
          <div v-for="(r, i) in ctx.searchResults" :key="i" class="ctx-result-item">{{ r }}</div>
        </div>
        <div v-if="ctx.answer" class="ctx-answer">
          <span class="ctx-key">Final answer:</span> {{ ctx.answer }}
        </div>
      </div>

      <!-- History -->
      <div v-if="hist.length > 0" class="history-panel">
        <h4>Phase History</h4>
        <div v-for="(h, i) in hist" :key="i" class="hist-row">
          <span class="hist-phase" :style="{ color: phaseColor(h.phase) }">{{ h.phase }}</span>
          <span v-if="h.action" class="hist-action">{{ (h.action as ResearchAction).tool }}: "{{ (h.action as ResearchAction).query }}"</span>
        </div>
      </div>

      <!-- Error -->
      <div v-if="err" class="error-panel">{{ err }}</div>
    </div>

    <!-- Code panel -->
    <div class="code-toggle">
      <button @click="showCode = !showCode" class="btn-code">{{ showCode ? 'Hide Source' : 'Show Source' }}</button>
    </div>
    <div v-if="showCode" class="code-panel">
      <div class="code-header">
        <span class="code-filename">agent-loop.ts</span>
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
.agent-demo { font-family: 'Instrument Sans', -apple-system, sans-serif; max-width: 560px; margin: 0 auto; }
.agent-panel { background: #0d1117; border: 1px solid #21262d; border-radius: 12px; padding: 24px; }
h3 { color: #e6edf3; margin: 0 0 4px; font-size: 18px; }
h4 { color: #c9d1d9; margin: 0 0 8px; font-size: 13px; }
.subtitle { color: #7d8590; font-size: 13px; margin: 0 0 16px; }
.query-row { display: flex; gap: 6px; margin-bottom: 12px; }
.query-input { flex: 1; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 8px 12px; color: #e6edf3; font-size: 14px; outline: none; }
.query-input:focus { border-color: #58a6ff; }
.btn-start { background: #238636; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.btn-start:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-stop { background: #da3633; color: #fff; border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; cursor: pointer; }
.phase-flow { display: flex; align-items: center; gap: 4px; margin-bottom: 16px; padding: 8px; background: #161b22; border: 1px solid #21262d; border-radius: 8px; }
.flow-step { color: #484f58; font-size: 12px; font-weight: 600; font-family: 'JetBrains Mono', monospace; padding: 4px 8px; border-radius: 4px; cursor: default; transition: color 0.15s, background 0.15s; }
.flow-step.active { color: #58a6ff; background: rgba(88, 166, 255, 0.1); }
.flow-arrow { color: #30363d; margin: 0 2px; }
.iter-label { color: #7d8590; font-size: 12px; margin-left: auto; }
.gate-panel { background: #1c1e26; border: 2px solid #f0883e; border-radius: 8px; padding: 14px; margin-bottom: 16px; transition: background 0.15s; }
.gate-panel:hover { background: #22242e; }
.gate-header { color: #f0883e; font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.gate-action { margin-bottom: 10px; }
.gate-tool { color: #d29922; font-family: 'JetBrains Mono', monospace; font-size: 13px; margin-right: 6px; }
.gate-query { color: #c9d1d9; font-size: 13px; }
.gate-hint { color: #7d8590; font-size: 11px; margin-bottom: 8px; }
.gate-buttons { display: flex; gap: 6px; }
.btn-approve { background: #238636; color: #fff; border: none; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.btn-reject { background: #da3633; color: #fff; border: none; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.btn-modify { background: #21262d; color: #d29922; border: 1px solid #30363d; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.context-panel { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 12px; margin-bottom: 12px; transition: background 0.15s; }
.context-panel:hover { background: #1a2230; }
.ctx-row { color: #c9d1d9; font-size: 12px; font-family: 'JetBrains Mono', monospace; margin-bottom: 2px; }
.ctx-key { color: #7d8590; }
.ctx-results { margin-top: 4px; }
.ctx-result-item { color: #8b949e; font-size: 11px; font-family: 'JetBrains Mono', monospace; padding: 2px 0 2px 12px; border-left: 2px solid #21262d; margin: 2px 0; }
.ctx-answer { color: #3fb950; font-size: 12px; font-family: 'JetBrains Mono', monospace; margin-top: 6px; padding-top: 6px; border-top: 1px solid #21262d; }
.history-panel { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.hist-row { display: flex; gap: 8px; font-size: 12px; font-family: 'JetBrains Mono', monospace; padding: 2px 0; }
.hist-phase { min-width: 120px; font-weight: 500; }
.hist-action { color: #8b949e; }
.error-panel { background: rgba(248, 81, 73, 0.1); border: 1px solid #f85149; border-radius: 6px; color: #f85149; padding: 10px; font-size: 13px; }
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
