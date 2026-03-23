<script setup lang="ts">
import {
	jotaiCount,
	jotaiDoubled,
	nativeCount,
	nativeDoubled,
	signalCount,
	signalDoubled,
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
const _SOURCE =
	minI > 0 && minI < Infinity
		? dLines.map((l) => l.slice(minI).replace(/\t/g, "  ")).join("\n")
		: rawRegion.replace(/\t/g, "  ");

// Native — use Vue bindings
const _natCount = useSubscribe(nativeCount);
const _natDoubled = useSubscribe(nativeDoubled);

// Jotai — subscribe manually via the atom's store
const _jCount = useSubscribe(jotaiCount._store);
const _jDoubled = useSubscribe(jotaiDoubled._store);

// Zustand — subscribe to store
const zState = ref(zustandStore.getState());
const zUnsub = zustandStore.subscribe((s) => {
	zState.value = { ...s };
});

// Signals — subscribe via underlying store
const _sCount = useSubscribe(signalCount._store);
const _sDoubled = useSubscribe(signalDoubled._store);

const _showCode = ref(false);

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
        <div class="card">
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
        <div class="card">
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
        <div class="card">
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
        <div class="card">
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

    <div class="code-toggle">
      <button @click="showCode = !showCode" class="btn-code">{{ showCode ? 'Hide Source' : 'Show Source' }}</button>
    </div>
    <div v-if="showCode" class="code-panel">
      <pre><code>{{ SOURCE }}</code></pre>
    </div>
  </div>
</template>

<style scoped>
.compat-demo { font-family: 'Instrument Sans', -apple-system, sans-serif; max-width: 600px; margin: 0 auto; }
.compat-panel { background: #0d1117; border: 1px solid #21262d; border-radius: 12px; padding: 24px; }
h3 { color: #e6edf3; margin: 0 0 4px; font-size: 18px; }
.subtitle { color: #7d8590; font-size: 13px; margin: 0 0 20px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; overflow: hidden; }
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
.code-panel { margin-top: 8px; background: #0d1117; border: 1px solid #21262d; border-radius: 8px; padding: 16px; overflow-x: auto; }
.code-panel pre { margin: 0; }
.code-panel code { color: #c9d1d9; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.5; white-space: pre; }
</style>
