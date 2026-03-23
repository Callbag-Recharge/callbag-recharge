<script setup lang="ts">
import {
	jotaiCount,
	jotaiDecrement,
	jotaiDoubled,
	jotaiIncrement,
	jotaiReset,
	nativeCount,
	nativeDecrement,
	nativeDoubled,
	nativeIncrement,
	nativeReset,
	signalCount,
	signalDecrement,
	signalDoubled,
	signalIncrement,
	signalReset,
	zustandStore,
} from "@examples/compat-comparison";
import compatRaw from "@examples/compat-comparison.ts?raw";
import { useSubscribe } from "callbag-recharge/compat/vue";
import { onUnmounted, ref } from "vue";

// Source code extraction
const REGION_START = "// #region display";
const REGION_END = "// #endregion display";
const s = compatRaw.indexOf(REGION_START);
const e = compatRaw.indexOf(REGION_END);
const after = s >= 0 ? compatRaw.indexOf("\n", s) : -1;
const rawRegion =
	s >= 0 && e > s && after >= 0 ? compatRaw.slice(after + 1, e).trimEnd() : compatRaw;
const dLines = rawRegion.split("\n");
const minI = dLines
	.filter((l) => l.trim().length > 0)
	.reduce((m, l) => {
		const x = l.match(/^(\t+)/);
		return x ? Math.min(m, x[1].length) : m;
	}, Infinity);
const SOURCE =
	minI > 0 && minI < Infinity
		? dLines.map((l) => l.slice(minI).replace(/\t/g, "  ")).join("\n")
		: rawRegion.replace(/\t/g, "  ");

const codeLines = SOURCE.split("\n");

// Native
const natCount = useSubscribe(nativeCount);
const natDoubled = useSubscribe(nativeDoubled);

// Jotai
const jCount = useSubscribe(jotaiCount._store);
const jDoubled = useSubscribe(jotaiDoubled._store);

// Zustand
const zState = ref(zustandStore.getState());
const zUnsub = zustandStore.subscribe((s) => {
	zState.value = { ...s };
});

// Signals
const sCount = useSubscribe(signalCount._store);
const sDoubled = useSubscribe(signalDoubled._store);

const showCode = ref(false);

// Highlight: map API sections to code ranges
const hoveredApi = ref<string | null>(null);
const API_PATTERNS: Record<string, RegExp> = {
	native: /\bnative\w*\b/i,
	jotai: /\bjotai\w*\b/i,
	zustand: /\bzustand\w*\b/i,
	signals: /\bsignal\w*\b/i,
};

const highlightMap: Record<string, number[]> = {};
codeLines.forEach((line: string, i: number) => {
	for (const [id, pattern] of Object.entries(API_PATTERNS)) {
		if (pattern.test(line)) {
			if (!highlightMap[id]) highlightMap[id] = [];
			highlightMap[id].push(i);
		}
	}
});

function isLineHighlighted(lineIdx: number): boolean {
	if (!hoveredApi.value) return false;
	return highlightMap[hoveredApi.value]?.includes(lineIdx) ?? false;
}

onUnmounted(() => {
	zUnsub();
});
</script>

<template>
  <div class="compat-demo">
    <div class="compat-panel">
      <h3>Same Counter, Four APIs</h3>
      <p class="subtitle">All backed by callbag-recharge's reactive engine</p>

      <div class="grid">
        <!-- Native -->
        <div class="card" @mouseenter="hoveredApi = 'native'" @mouseleave="hoveredApi = null">
          <div class="card-header native">callbag-recharge</div>
          <div class="card-body">
            <div class="counter-display">{{ natCount }}</div>
            <div class="derived-display">doubled: {{ natDoubled }}</div>
            <div class="card-actions">
              <button @click="nativeDecrement">-</button>
              <button @click="nativeIncrement">+</button>
              <button @click="nativeReset" class="btn-sm-reset">0</button>
            </div>
            <div class="api-hint">state() + derived()</div>
          </div>
        </div>

        <!-- Jotai -->
        <div class="card" @mouseenter="hoveredApi = 'jotai'" @mouseleave="hoveredApi = null">
          <div class="card-header jotai">Jotai compat</div>
          <div class="card-body">
            <div class="counter-display">{{ jCount }}</div>
            <div class="derived-display">doubled: {{ jDoubled }}</div>
            <div class="card-actions">
              <button @click="jotaiDecrement">-</button>
              <button @click="jotaiIncrement">+</button>
              <button @click="jotaiReset" class="btn-sm-reset">0</button>
            </div>
            <div class="api-hint">atom() + derived atom</div>
          </div>
        </div>

        <!-- Zustand -->
        <div class="card" @mouseenter="hoveredApi = 'zustand'" @mouseleave="hoveredApi = null">
          <div class="card-header zustand">Zustand compat</div>
          <div class="card-body">
            <div class="counter-display">{{ zState.count }}</div>
            <div class="derived-display">doubled: {{ zState.doubled }}</div>
            <div class="card-actions">
              <button @click="zState.decrement?.()">-</button>
              <button @click="zState.increment?.()">+</button>
              <button @click="zState.reset?.()" class="btn-sm-reset">0</button>
            </div>
            <div class="api-hint">create() + set/get</div>
          </div>
        </div>

        <!-- Signals -->
        <div class="card" @mouseenter="hoveredApi = 'signals'" @mouseleave="hoveredApi = null">
          <div class="card-header signals">TC39 Signals</div>
          <div class="card-body">
            <div class="counter-display">{{ sCount }}</div>
            <div class="derived-display">doubled: {{ sDoubled }}</div>
            <div class="card-actions">
              <button @click="signalDecrement">-</button>
              <button @click="signalIncrement">+</button>
              <button @click="signalReset" class="btn-sm-reset">0</button>
            </div>
            <div class="api-hint">Signal.State + Computed</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Code panel -->
    <div class="code-toggle">
      <button @click="showCode = !showCode" class="btn-code">{{ showCode ? 'Hide Source' : 'Show Source' }}</button>
    </div>
    <div v-if="showCode" class="code-panel">
      <div class="code-header">
        <span class="code-filename">compat-comparison.ts</span>
        <span class="code-badge">{{ codeLines.length }} lines</span>
      </div>
      <div class="code-body">
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
.compat-demo { font-family: 'Instrument Sans', -apple-system, sans-serif; max-width: 600px; margin: 0 auto; }
.compat-panel { background: #0d1117; border: 1px solid #21262d; border-radius: 12px; padding: 24px; }
h3 { color: #e6edf3; margin: 0 0 4px; font-size: 18px; }
.subtitle { color: #7d8590; font-size: 13px; margin: 0 0 20px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; overflow: hidden; transition: border-color 0.15s; }
.card:hover { border-color: #30363d; }
.card-header { padding: 8px 12px; font-size: 12px; font-weight: 600; letter-spacing: 0.3px; }
.native { background: #1a3a2a; color: #3fb950; }
.jotai { background: #1a2a3a; color: #58a6ff; }
.zustand { background: #2a1a3a; color: #bc8cff; }
.signals { background: #3a2a1a; color: #f0883e; }
.card-body { padding: 16px; text-align: center; }
.counter-display { font-size: 36px; font-weight: 700; color: #e6edf3; font-family: 'JetBrains Mono', monospace; }
.derived-display { color: #7d8590; font-size: 12px; margin-bottom: 12px; font-family: 'JetBrains Mono', monospace; }
.card-actions { display: flex; justify-content: center; gap: 6px; margin-bottom: 8px; }
.card-actions button { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; width: 36px; height: 32px; font-size: 16px; cursor: pointer; transition: background 0.15s; }
.card-actions button:hover { background: #30363d; }
.btn-sm-reset { font-size: 13px !important; }
.api-hint { color: #484f58; font-size: 11px; font-family: 'JetBrains Mono', monospace; }
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
