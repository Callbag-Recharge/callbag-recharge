<script setup lang="ts">
import { onMounted, ref } from "vue";

const mounted = ref(false);
onMounted(() => {
	mounted.value = true;
});

const features = [
	{
		icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/></svg>',
		title: "Diamond-Safe",
		desc: "Two-phase push guarantees glitch-free derived values. When A \u2192 B, A \u2192 C, B+C \u2192 D \u2014 D computes exactly once.",
		color: "#f0a858",
	},
	{
		icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>',
		title: "Streaming-Native",
		desc: "LLM chunks, WebSocket, SSE \u2014 all first-class. switchMap auto-cancels. scan accumulates. retry recovers.",
		color: "#4de8c2",
	},
	{
		icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M12 8v3"/></svg>',
		title: "60+ Operators",
		desc: "switchMap, debounce, retry, scan, merge, combine, groupBy, window, and more \u2014 tree-shakeable.",
		color: "#a78bfa",
	},
	{
		icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
		title: "Inspectable",
		desc: "Every node observable via Inspector. Names, edges, dirty/resolved phases \u2014 zero runtime cost in production.",
		color: "#f472b6",
	},
];

const primitives = [
	{ name: "state", desc: "writable store", example: "state(0)" },
	{ name: "derived", desc: "computed value", example: "derived([a, b], fn)" },
	{ name: "effect", desc: "side effects", example: "effect([dep], fn)" },
	{ name: "producer", desc: "async source", example: "producer(({ emit }) => ...)" },
	{ name: "operator", desc: "custom transform", example: "operator([dep], init, handler)" },
];
</script>

<template>
  <div class="home-root" :class="{ mounted }">

    <!-- ══════════ HERO ══════════ -->
    <section class="hero">
      <!-- Animated background -->
      <div class="hero-bg">
        <div class="gradient-orb orb-1"></div>
        <div class="gradient-orb orb-2"></div>
        <div class="gradient-orb orb-3"></div>
        <div class="flow-lines">
          <svg viewBox="0 0 1200 600" fill="none" preserveAspectRatio="xMidYMid slice">
            <path class="flow-line fl-1" d="M-100 300 Q200 100 400 300 T800 300 T1300 300" stroke="url(#grad1)" stroke-width="1.5" />
            <path class="flow-line fl-2" d="M-100 350 Q250 150 450 350 T850 320 T1300 350" stroke="url(#grad2)" stroke-width="1" />
            <path class="flow-line fl-3" d="M-100 250 Q150 400 350 250 T750 280 T1300 250" stroke="url(#grad3)" stroke-width="1" />
            <path class="flow-line fl-4" d="M-100 400 Q300 200 500 400 T900 380 T1300 400" stroke="url(#grad1)" stroke-width="0.75" opacity="0.5" />
            <path class="flow-line fl-5" d="M-100 200 Q100 350 300 200 T700 230 T1300 200" stroke="url(#grad2)" stroke-width="0.75" opacity="0.5" />
            <defs>
              <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#4de8c200" />
                <stop offset="30%" stop-color="#4de8c2" />
                <stop offset="70%" stop-color="#2bb89a" />
                <stop offset="100%" stop-color="#4de8c200" />
              </linearGradient>
              <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#a78bfa00" />
                <stop offset="40%" stop-color="#a78bfa88" />
                <stop offset="100%" stop-color="#a78bfa00" />
              </linearGradient>
              <linearGradient id="grad3" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#f0a85800" />
                <stop offset="50%" stop-color="#f0a85866" />
                <stop offset="100%" stop-color="#f0a85800" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div class="noise-overlay"></div>
      </div>

      <div class="hero-content">
        <p class="hero-kicker">Reactive State Management for TypeScript</p>
        <h1 class="hero-title">
          <span class="title-line-1">State that</span>
          <span class="title-line-2"><em class="flows-word">flows</em><span class="period">.</span></span>
        </h1>
        <p class="hero-chinese">川流不息，唯取一瓢</p>
        <p class="hero-sub">
          6 primitives. 60+ operators. Diamond-safe. Framework-agnostic.
          <br />From atoms to streams in one library.
        </p>
        <div class="hero-actions">
          <a href="/callbag-recharge/getting-started" class="btn btn-primary">
            Get Started
            <span class="btn-arrow">&rarr;</span>
          </a>
          <a href="https://github.com/Callbag-Recharge/callbag-recharge" class="btn btn-ghost" target="_blank" rel="noopener">
            GitHub
          </a>
          <div class="install-cmd">
            <code>npm i @callbag-recharge/callbag-recharge</code>
          </div>
        </div>
      </div>
    </section>

    <!-- ══════════ FEATURES ══════════ -->
    <section class="features-section">
      <div class="features-grid">
        <div
          v-for="(f, i) in features"
          :key="f.title"
          class="feature-card"
          :style="{ '--delay': `${i * 0.1}s`, '--accent': f.color }"
        >
          <div class="feature-icon" v-html="f.icon"></div>
          <h3 class="feature-title">{{ f.title }}</h3>
          <p class="feature-desc">{{ f.desc }}</p>
        </div>
      </div>
    </section>

    <!-- ══════════ PRIMITIVES ══════════ -->
    <section class="primitives-section">
      <div class="section-inner">
        <h2 class="section-heading">Five Primitives. That's It.</h2>
        <p class="section-sub">No ceremony. No providers. No boilerplate. Every store is a callbag source.</p>
        <div class="primitives-list">
          <div
            v-for="(p, i) in primitives"
            :key="p.name"
            class="primitive-row"
            :style="{ '--delay': `${i * 0.06}s` }"
          >
            <code class="primitive-name">{{ p.name }}()</code>
            <span class="primitive-dash">&mdash;</span>
            <span class="primitive-desc">{{ p.desc }}</span>
            <code class="primitive-example">{{ p.example }}</code>
          </div>
        </div>
      </div>
    </section>

    <!-- ══════════ CODE SHOWCASE ══════════ -->
    <section class="code-section">
      <div class="section-inner">
        <h2 class="section-heading">See It In Action</h2>
        <div class="code-grid">
          <div class="code-block">
            <div class="code-header">
              <span class="code-dot" style="background:#ff5f57"></span>
              <span class="code-dot" style="background:#febc2e"></span>
              <span class="code-dot" style="background:#28c840"></span>
              <span class="code-label">basic.ts</span>
            </div>
            <pre class="code-pre"><code><span class="k">import</span> { state, derived, effect } <span class="k">from</span> <span class="s">'callbag-recharge'</span>

<span class="c">// Create reactive atoms</span>
<span class="k">const</span> count = <span class="fn">state</span>(<span class="n">0</span>)
<span class="k">const</span> doubled = <span class="fn">derived</span>([count], () <span class="k">=></span> count.<span class="fn">get</span>() * <span class="n">2</span>)

<span class="c">// React to changes</span>
<span class="fn">effect</span>([doubled], () <span class="k">=></span> {
  console.<span class="fn">log</span>(<span class="s">'doubled:'</span>, doubled.<span class="fn">get</span>())
})

count.<span class="fn">set</span>(<span class="n">1</span>)  <span class="c">// logs: "doubled: 2"</span></code></pre>
          </div>
          <div class="code-block">
            <div class="code-header">
              <span class="code-dot" style="background:#ff5f57"></span>
              <span class="code-dot" style="background:#febc2e"></span>
              <span class="code-dot" style="background:#28c840"></span>
              <span class="code-label">streaming.ts</span>
            </div>
            <pre class="code-pre"><code><span class="k">import</span> { producer } <span class="k">from</span> <span class="s">'callbag-recharge'</span>
<span class="k">import</span> { switchMap, scan } <span class="k">from</span> <span class="s">'callbag-recharge/extra'</span>

<span class="c">// AI chat with auto-cancellation</span>
<span class="k">const</span> prompt = <span class="fn">state</span>(<span class="s">''</span>)
<span class="k">const</span> response = <span class="fn">switchMap</span>(prompt, (p) <span class="k">=></span>
  <span class="fn">producer</span>(({ emit, complete }) <span class="k">=></span> {
    <span class="k">const</span> ctrl = <span class="k">new</span> <span class="fn">AbortController</span>()
    <span class="fn">streamChat</span>(p, ctrl.signal, emit, complete)
    <span class="k">return</span> () <span class="k">=></span> ctrl.<span class="fn">abort</span>()
  })
)
<span class="c">// New prompt auto-cancels previous stream</span></code></pre>
          </div>
        </div>
      </div>
    </section>

    <!-- ══════════ COMPARISON ══════════ -->
    <section class="compare-section">
      <div class="section-inner">
        <h2 class="section-heading">How We Compare</h2>
        <div class="compare-table-wrap">
          <table class="compare-table">
            <thead>
              <tr>
                <th></th>
                <th class="highlight">callbag-recharge</th>
                <th>Zustand</th>
                <th>Jotai</th>
                <th>Nanostores</th>
                <th>Signals</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="row-label">Diamond-safe</td>
                <td class="highlight"><span class="check">&#10003;</span></td>
                <td><span class="cross">&#10005;</span></td>
                <td><span class="cross">&#10005;</span></td>
                <td><span class="cross">&#10005;</span></td>
                <td><span class="cross">&#10005;</span></td>
              </tr>
              <tr>
                <td class="row-label">Stream operators</td>
                <td class="highlight"><span class="check">&#10003;</span> 60+</td>
                <td><span class="cross">&#10005;</span></td>
                <td><span class="cross">&#10005;</span></td>
                <td><span class="cross">&#10005;</span></td>
                <td><span class="cross">&#10005;</span></td>
              </tr>
              <tr>
                <td class="row-label">Framework-agnostic</td>
                <td class="highlight"><span class="check">&#10003;</span></td>
                <td><span class="partial">~</span></td>
                <td><span class="cross">&#10005;</span></td>
                <td><span class="check">&#10003;</span></td>
                <td><span class="check">&#10003;</span></td>
              </tr>
              <tr>
                <td class="row-label">Async/streaming</td>
                <td class="highlight"><span class="check">&#10003;</span> native</td>
                <td><span class="partial">~</span></td>
                <td><span class="partial">~</span></td>
                <td><span class="cross">&#10005;</span></td>
                <td><span class="cross">&#10005;</span></td>
              </tr>
              <tr>
                <td class="row-label">Inspectable graph</td>
                <td class="highlight"><span class="check">&#10003;</span></td>
                <td><span class="cross">&#10005;</span></td>
                <td><span class="partial">~</span></td>
                <td><span class="cross">&#10005;</span></td>
                <td><span class="cross">&#10005;</span></td>
              </tr>
              <tr>
                <td class="row-label">Zero deps</td>
                <td class="highlight"><span class="check">&#10003;</span></td>
                <td><span class="check">&#10003;</span></td>
                <td><span class="check">&#10003;</span></td>
                <td><span class="check">&#10003;</span></td>
                <td><span class="check">&#10003;</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- ══════════ CTA ══════════ -->
    <section class="cta-section">
      <div class="section-inner">
        <h2 class="cta-heading">Start flowing.</h2>
        <p class="cta-sub">npm i @callbag-recharge/callbag-recharge</p>
        <div class="cta-actions">
          <a href="/callbag-recharge/getting-started" class="btn btn-primary btn-lg">
            Read the Guide
            <span class="btn-arrow">&rarr;</span>
          </a>
          <a href="/callbag-recharge/api/state" class="btn btn-ghost btn-lg">
            API Reference
          </a>
        </div>
      </div>
    </section>

  </div>
</template>

<style scoped>
/* ═══════════ RESET & STRUCTURE ═══════════ */
.home-root {
  --cr-aqua: #4de8c2;
  --cr-aqua-dim: #2bb89a;
  --cr-deep: #0a1628;
  --cr-surface: #0f1f35;
  --cr-surface-raised: #142640;
  --cr-text: #e2eaf4;
  --cr-text-muted: #8899b0;
  --cr-accent-warm: #f0a858;
  --cr-border-subtle: #162a42;

  color: var(--cr-text);
  font-family: 'Outfit', -apple-system, sans-serif;
}

.section-inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 2rem;
}

/* ═══════════ HERO ═══════════ */
.hero {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 6rem 2rem 4rem;
}

.hero-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: radial-gradient(ellipse 80% 60% at 50% 40%, #0d2847 0%, var(--cr-deep) 70%);
}

.gradient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.4;
  animation: float 20s ease-in-out infinite;
}

.orb-1 {
  width: 600px;
  height: 600px;
  top: -10%;
  left: -5%;
  background: radial-gradient(circle, #4de8c233, transparent 70%);
  animation-delay: 0s;
}

.orb-2 {
  width: 400px;
  height: 400px;
  top: 20%;
  right: -5%;
  background: radial-gradient(circle, #a78bfa22, transparent 70%);
  animation-delay: -7s;
  animation-duration: 25s;
}

.orb-3 {
  width: 300px;
  height: 300px;
  bottom: 5%;
  left: 30%;
  background: radial-gradient(circle, #f0a85818, transparent 70%);
  animation-delay: -13s;
  animation-duration: 30s;
}

@keyframes float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  25% { transform: translate(30px, -40px) scale(1.05); }
  50% { transform: translate(-20px, 20px) scale(0.95); }
  75% { transform: translate(15px, 30px) scale(1.02); }
}

.flow-lines {
  position: absolute;
  inset: 0;
  opacity: 0.35;
}

.flow-lines svg {
  width: 100%;
  height: 100%;
}

.flow-line {
  stroke-dasharray: 800;
  stroke-dashoffset: 800;
  animation: flowDraw 4s ease forwards;
}

.fl-1 { animation-delay: 0.2s; }
.fl-2 { animation-delay: 0.5s; }
.fl-3 { animation-delay: 0.8s; }
.fl-4 { animation-delay: 1.1s; }
.fl-5 { animation-delay: 1.4s; }

@keyframes flowDraw {
  to { stroke-dashoffset: 0; }
}

.noise-overlay {
  position: absolute;
  inset: 0;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 256px;
  pointer-events: none;
}

.hero-content {
  position: relative;
  z-index: 1;
  text-align: center;
  max-width: 800px;
}

.hero-kicker {
  font-size: 0.85rem;
  font-weight: 500;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--cr-aqua-dim);
  margin-bottom: 1.5rem;
  opacity: 0;
  transform: translateY(20px);
  animation: fadeUp 0.8s ease 0.3s forwards;
}

.hero-title {
  font-family: 'Instrument Sans', 'Outfit', -apple-system, sans-serif;
  font-weight: 700;
  line-height: 1;
  margin: 0 0 1rem;
}

.title-line-1 {
  display: block;
  font-size: clamp(3rem, 8vw, 5.5rem);
  color: var(--cr-text);
  opacity: 0;
  transform: translateY(30px);
  animation: fadeUp 0.8s ease 0.5s forwards;
}

.title-line-2 {
  display: block;
  font-size: clamp(3.5rem, 10vw, 7rem);
  color: var(--cr-text);
  opacity: 0;
  transform: translateY(30px);
  animation: fadeUp 0.8s ease 0.7s forwards;
}

.flows-word {
  font-family: 'Tangerine', cursive;
  font-style: normal;
  font-weight: 700;
  font-size: 1.8em;
  letter-spacing: 0.01em;
  background: linear-gradient(135deg, var(--cr-aqua), #7df0d5, var(--cr-aqua-dim));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 0.8;
  vertical-align: bottom;
  display: inline-block;
  padding: 0 0.15em;
  margin-left: -0.05em;
}

.period {
  -webkit-text-fill-color: var(--cr-accent-warm);
}

.hero-chinese {
  font-size: 1.1rem;
  color: var(--cr-text-muted);
  font-style: italic;
  margin: 0.5rem 0 1.5rem;
  opacity: 0;
  animation: fadeUp 0.8s ease 0.9s forwards;
}

.hero-sub {
  font-size: 1.15rem;
  line-height: 1.7;
  color: var(--cr-text-muted);
  margin-bottom: 2.5rem;
  opacity: 0;
  animation: fadeUp 0.8s ease 1.1s forwards;
}

.hero-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  flex-wrap: wrap;
  opacity: 0;
  animation: fadeUp 0.8s ease 1.3s forwards;
}

@keyframes fadeUp {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ═══════════ BUTTONS ═══════════ */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.75rem;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.95rem;
  text-decoration: none;
  transition: all 0.25s ease;
  cursor: pointer;
}

.btn-primary {
  background: var(--cr-aqua);
  color: var(--cr-deep);
}

.btn-primary:hover {
  background: #7df0d5;
  box-shadow: 0 0 30px var(--cr-aqua-dim);
  transform: translateY(-1px);
}

.btn-ghost {
  background: transparent;
  border: 1px solid var(--cr-border-subtle);
  color: var(--cr-text);
}

.btn-ghost:hover {
  border-color: var(--cr-aqua-dim);
  color: var(--cr-aqua);
  background: rgba(77, 232, 194, 0.05);
}

.btn-lg {
  padding: 1rem 2.25rem;
  font-size: 1.05rem;
}

.btn-arrow {
  transition: transform 0.2s;
}

.btn:hover .btn-arrow {
  transform: translateX(3px);
}

.install-cmd {
  padding: 0.5rem 1.25rem;
  background: rgba(9, 19, 34, 0.8);
  border: 1px solid var(--cr-border-subtle);
  border-radius: 8px;
}

.install-cmd code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  color: var(--cr-text-muted);
}

/* ═══════════ FEATURES ═══════════ */
.features-section {
  padding: 6rem 2rem;
  background: var(--cr-surface);
  border-top: 1px solid var(--cr-border-subtle);
  border-bottom: 1px solid var(--cr-border-subtle);
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1.5rem;
  max-width: 1100px;
  margin: 0 auto;
}

.feature-card {
  padding: 2rem;
  background: var(--cr-surface-raised);
  border: 1px solid var(--cr-border-subtle);
  border-radius: 16px;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.feature-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: 0;
  transition: opacity 0.3s;
}

.feature-card:hover {
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}

.feature-card:hover::before {
  opacity: 1;
}

.feature-icon {
  margin-bottom: 1rem;
  color: var(--accent);
}

.feature-icon svg {
  display: block;
  stroke: currentColor;
  filter: drop-shadow(0 0 10px color-mix(in srgb, var(--accent) 40%, transparent));
}

.feature-title {
  font-family: 'Instrument Sans', 'Outfit', -apple-system, sans-serif;
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
  color: var(--cr-text);
}

.feature-desc {
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--cr-text-muted);
  margin: 0;
}

/* ═══════════ PRIMITIVES ═══════════ */
.primitives-section {
  padding: 6rem 2rem;
}

.section-heading {
  font-family: 'Instrument Sans', 'Outfit', -apple-system, sans-serif;
  font-size: 2.2rem;
  font-weight: 700;
  text-align: center;
  margin: 0 0 0.75rem;
  color: var(--cr-text);
}

.section-sub {
  text-align: center;
  color: var(--cr-text-muted);
  font-size: 1.05rem;
  margin: 0 0 3rem;
}

.primitives-list {
  max-width: 750px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.primitive-row {
  display: grid;
  grid-template-columns: 120px 24px 1fr auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.85rem 1.25rem;
  background: var(--cr-surface);
  border: 1px solid var(--cr-border-subtle);
  border-radius: 10px;
  transition: all 0.2s ease;
}

.primitive-row:hover {
  border-color: var(--cr-aqua-dim);
  background: var(--cr-surface-raised);
}

.primitive-name {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--cr-aqua);
}

.primitive-dash {
  color: var(--cr-text-muted);
  opacity: 0.4;
}

.primitive-desc {
  font-size: 0.9rem;
  color: var(--cr-text);
}

.primitive-example {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: var(--cr-text-muted);
  background: var(--cr-deep);
  padding: 0.25rem 0.6rem;
  border-radius: 4px;
  white-space: nowrap;
}

/* ═══════════ CODE SHOWCASE ═══════════ */
.code-section {
  padding: 6rem 2rem;
  background: var(--cr-surface);
  border-top: 1px solid var(--cr-border-subtle);
  border-bottom: 1px solid var(--cr-border-subtle);
}

.code-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 1.5rem;
}

.code-block {
  background: #091322;
  border: 1px solid var(--cr-border-subtle);
  border-radius: 14px;
  overflow: hidden;
}

.code-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0.75rem 1rem;
  background: rgba(20, 38, 64, 0.5);
  border-bottom: 1px solid var(--cr-border-subtle);
}

.code-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.code-label {
  margin-left: auto;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  color: var(--cr-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.code-pre {
  margin: 0;
  padding: 1.25rem;
  overflow-x: auto;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.82rem;
  line-height: 1.75;
}

.code-pre code {
  color: var(--cr-text);
}

.code-pre .k { color: #c792ea; }
.code-pre .fn { color: #82aaff; }
.code-pre .s { color: #c3e88d; }
.code-pre .n { color: #f78c6c; }
.code-pre .c { color: #546e7a; font-style: italic; }

/* ═══════════ COMPARISON ═══════════ */
.compare-section {
  padding: 6rem 2rem;
}

.compare-table-wrap {
  overflow-x: auto;
  border-radius: 14px;
  border: 1px solid var(--cr-border-subtle);
}

.compare-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.compare-table th,
.compare-table td {
  padding: 0.85rem 1.25rem;
  text-align: center;
  border-bottom: 1px solid var(--cr-border-subtle);
}

.compare-table thead th {
  background: var(--cr-surface-raised);
  font-weight: 600;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--cr-text-muted);
}

.compare-table thead th.highlight {
  color: var(--cr-aqua);
  background: rgba(77, 232, 194, 0.08);
}

.compare-table td.highlight {
  background: rgba(77, 232, 194, 0.04);
  font-weight: 500;
}

.compare-table .row-label {
  text-align: left;
  font-weight: 500;
  color: var(--cr-text);
}

.compare-table tr:last-child td {
  border-bottom: none;
}

.check {
  color: var(--cr-aqua);
  font-weight: 700;
}

.cross {
  color: #5a6a80;
}

.partial {
  color: var(--cr-accent-warm);
}

/* ═══════════ CTA ═══════════ */
.cta-section {
  padding: 8rem 2rem;
  text-align: center;
  position: relative;
}

.cta-section::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 60% 50% at 50% 60%, rgba(77, 232, 194, 0.06), transparent);
  pointer-events: none;
}

.cta-heading {
  font-family: 'Instrument Sans', 'Outfit', -apple-system, sans-serif;
  font-size: 3rem;
  font-weight: 700;
  margin: 0 0 0.75rem;
  color: var(--cr-aqua);
  padding: 0.1em 0;
}

.cta-sub {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1rem;
  color: var(--cr-text-muted);
  margin: 0 0 2.5rem;
}

.cta-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  flex-wrap: wrap;
}

/* ═══════════ RESPONSIVE ═══════════ */
@media (max-width: 768px) {
  .hero {
    min-height: auto;
    padding: 8rem 1.5rem 4rem;
  }

  .title-line-1 { font-size: 2.5rem; }
  .title-line-2 { font-size: 3.5rem; }

  .primitive-row {
    grid-template-columns: 1fr;
    gap: 0.25rem;
  }

  .primitive-dash { display: none; }
  .primitive-example { justify-self: start; }

  .code-grid {
    grid-template-columns: 1fr;
  }

  .compare-table {
    font-size: 0.8rem;
  }

  .compare-table th,
  .compare-table td {
    padding: 0.6rem 0.75rem;
  }

  .cta-heading {
    font-size: 2.2rem;
  }
}

@media (max-width: 480px) {
  .hero-actions {
    flex-direction: column;
  }

  .install-cmd {
    order: -1;
  }

  .features-grid {
    grid-template-columns: 1fr;
  }
}
</style>
