<script setup lang="ts">
import {
	context,
	error,
	history,
	iteration,
	lastAction,
	pending,
	phase,
	startResearch,
	stop,
} from "@examples/agent-loop";
import agentRaw from "@examples/agent-loop.ts?raw";
import { useSubscribe } from "callbag-recharge/compat/vue";
import { onUnmounted, ref } from "vue";

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
const _SOURCE =
	minI > 0 && minI < Infinity
		? dLines.map((l) => l.slice(minI).replace(/\t/g, "  ")).join("\n")
		: rawRegion.replace(/\t/g, "  ");

// Reactive bindings
const _currentPhase = useSubscribe(phase);
const _ctx = useSubscribe(context);
const _action = useSubscribe(lastAction);
const _iter = useSubscribe(iteration);
const _err = useSubscribe(error);
const _hist = useSubscribe(history);
const _pendingActions = useSubscribe(pending);

const query = ref("TypeScript reactive state management");
const _showCode = ref(false);

function _phaseColor(p: string): string {
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

function _handleStart() {
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

      <!-- Phase indicator -->
      <div class="phase-bar">
        <span class="phase-dot" :style="{ background: phaseColor(currentPhase) }"></span>
        <span class="phase-label" :style="{ color: phaseColor(currentPhase) }">{{ currentPhase }}</span>
        <span class="iter-label" v-if="iter > 0">Iteration {{ iter }}</span>
      </div>

      <!-- Approval gate -->
      <div v-if="currentPhase === 'awaiting_approval' && pendingActions.length > 0" class="gate-panel">
        <div class="gate-header">Action awaiting approval:</div>
        <div class="gate-action">
          <span class="gate-tool">{{ pendingActions[0]?.tool }}</span>
          <span class="gate-query">"{{ pendingActions[0]?.query }}"</span>
        </div>
        <div class="gate-buttons">
          <button @click="approve()" class="btn-approve">Approve</button>
          <button @click="reject()" class="btn-reject">Reject</button>
          <button @click="modify((a: ResearchAction) => ({ ...a, query: a.query + ' advanced' }))" class="btn-modify">
            Modify (add "advanced")
          </button>
        </div>
      </div>

      <!-- Context panel -->
      <div v-if="ctx" class="context-panel">
        <h4>Context</h4>
        <div class="ctx-row"><span class="ctx-key">Question:</span> {{ ctx.question }}</div>
        <div class="ctx-row"><span class="ctx-key">Results:</span> {{ ctx.searchResults.length }} items</div>
        <div v-if="ctx.answer" class="ctx-answer">
          <span class="ctx-key">Answer:</span> {{ ctx.answer }}
        </div>
      </div>

      <!-- History -->
      <div v-if="hist.length > 0" class="history-panel">
        <h4>Phase History</h4>
        <div v-for="(h, i) in hist" :key="i" class="hist-row">
          <span class="hist-phase" :style="{ color: phaseColor(h.phase) }">{{ h.phase }}</span>
          <span v-if="h.action" class="hist-action">{{ (h.action as ResearchAction).tool }}: {{ (h.action as ResearchAction).query }}</span>
        </div>
      </div>

      <!-- Error -->
      <div v-if="err" class="error-panel">{{ err }}</div>
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
.phase-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.phase-dot { width: 10px; height: 10px; border-radius: 50%; }
.phase-label { font-size: 14px; font-weight: 600; font-family: 'JetBrains Mono', monospace; }
.iter-label { color: #7d8590; font-size: 12px; margin-left: auto; }
.gate-panel { background: #1c1e26; border: 2px solid #f0883e; border-radius: 8px; padding: 14px; margin-bottom: 16px; }
.gate-header { color: #f0883e; font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.gate-action { margin-bottom: 10px; }
.gate-tool { color: #d29922; font-family: 'JetBrains Mono', monospace; font-size: 13px; margin-right: 6px; }
.gate-query { color: #c9d1d9; font-size: 13px; }
.gate-buttons { display: flex; gap: 6px; }
.btn-approve { background: #238636; color: #fff; border: none; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.btn-reject { background: #da3633; color: #fff; border: none; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.btn-modify { background: #21262d; color: #d29922; border: 1px solid #30363d; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.context-panel { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.ctx-row { color: #c9d1d9; font-size: 12px; font-family: 'JetBrains Mono', monospace; margin-bottom: 2px; }
.ctx-key { color: #7d8590; }
.ctx-answer { color: #3fb950; font-size: 12px; font-family: 'JetBrains Mono', monospace; margin-top: 6px; padding-top: 6px; border-top: 1px solid #21262d; }
.history-panel { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.hist-row { display: flex; gap: 8px; font-size: 12px; font-family: 'JetBrains Mono', monospace; padding: 2px 0; }
.hist-phase { min-width: 120px; font-weight: 500; }
.hist-action { color: #8b949e; }
.error-panel { background: rgba(248, 81, 73, 0.1); border: 1px solid #f85149; border-radius: 6px; color: #f85149; padding: 10px; font-size: 13px; }
.code-toggle { margin-top: 12px; }
.btn-code { background: transparent; color: #58a6ff; border: 1px solid #21262d; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.code-panel { margin-top: 8px; background: #0d1117; border: 1px solid #21262d; border-radius: 8px; padding: 16px; overflow-x: auto; }
.code-panel pre { margin: 0; }
.code-panel code { color: #c9d1d9; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.5; white-space: pre; }
</style>
