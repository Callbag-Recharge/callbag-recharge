<script setup lang="ts">
import {
	allValid,
	anyDirty,
	anyValidating,
	confirmField,
	disposeAll,
	emailField,
	nameField,
	passwordField,
	resetAll,
} from "@examples/form-builder";
import formRaw from "@examples/form-builder.ts?raw";
import { useSubscribe } from "callbag-recharge/compat/vue";
import { onUnmounted, ref } from "vue";

// ---------------------------------------------------------------------------
// Source code panel
// ---------------------------------------------------------------------------
const REGION_START = "// #region display";
const REGION_END = "// #endregion display";
const start = formRaw.indexOf(REGION_START);
const end = formRaw.indexOf(REGION_END);
const after = start >= 0 ? formRaw.indexOf("\n", start) : -1;
const rawRegion =
	start >= 0 && end > start && after >= 0 ? formRaw.slice(after + 1, end).trimEnd() : formRaw;
const regionLines = rawRegion.split("\n");
const minIndent = regionLines
	.filter((l) => l.trim().length > 0)
	.reduce((min, l) => {
		const m = l.match(/^(\t+)/);
		return m ? Math.min(min, m[1].length) : min;
	}, Infinity);
const SOURCE =
	minIndent > 0 && minIndent < Infinity
		? regionLines
				.map((l) => {
					let s = l;
					for (let t = 0; t < minIndent && s.startsWith("\t"); t++) s = s.slice(1);
					return s.replace(/\t/g, "  ");
				})
				.join("\n")
		: rawRegion.replace(/\t/g, "  ");

const codeLines = SOURCE.split("\n");

// ---------------------------------------------------------------------------
// Reactive bindings via useSubscribe
// ---------------------------------------------------------------------------
const name = useSubscribe(nameField.value);
const nameError = useSubscribe(nameField.error);
const nameDirty = useSubscribe(nameField.dirty);
const nameTouched = useSubscribe(nameField.touched);

const email = useSubscribe(emailField.value);
const emailError = useSubscribe(emailField.error);
const emailDirty = useSubscribe(emailField.dirty);
const emailValidating = useSubscribe(emailField.validating);

const password = useSubscribe(passwordField.value);
const passwordError = useSubscribe(passwordField.error);
const passwordDirty = useSubscribe(passwordField.dirty);

const confirm = useSubscribe(confirmField.value);
const confirmError = useSubscribe(confirmField.error);
const confirmDirty = useSubscribe(confirmField.dirty);

const formValid = useSubscribe(allValid);
const formDirty = useSubscribe(anyDirty);
const formValidating = useSubscribe(anyValidating);

const submitted = ref(false);

function onInput(field: { set: (v: string) => void; touch: () => void }, e: Event) {
	field.set((e.target as HTMLInputElement).value);
}

function onBlur(field: { touch: () => void }) {
	field.touch();
}

function handleSubmit() {
	if (formValid.value && !formValidating.value) {
		submitted.value = true;
		setTimeout(() => (submitted.value = false), 2000);
	}
}

// Code panel
const showCode = ref(false);

// Highlight: map field names to code line ranges
const hoveredField = ref<string | null>(null);
const FIELD_PATTERNS: Record<string, RegExp> = {
	name: /\bnameField\b/,
	email: /\bemailField\b/,
	password: /\bpasswordField\b/,
	confirm: /\bconfirmField\b/,
};

const highlightMap: Record<string, number[]> = {};
let blockStart = -1;
let blockId: string | null = null;
let depth = 0;

codeLines.forEach((line: string, i: number) => {
	if (blockStart < 0) {
		for (const [id, pattern] of Object.entries(FIELD_PATTERNS)) {
			if (pattern.test(line) && /=\s*formField\(/.test(line)) {
				blockStart = i;
				blockId = id;
				depth = 0;
				break;
			}
		}
	}
	if (blockStart >= 0) {
		for (const ch of line) {
			if (ch === "(" || ch === "{") depth++;
			if (ch === ")" || ch === "}") depth--;
		}
		if (depth <= 0) {
			if (blockId) {
				highlightMap[blockId] = Array.from(
					{ length: i - blockStart + 1 },
					(_, j) => blockStart + j,
				);
			}
			blockStart = -1;
			blockId = null;
		}
	}
});

function isLineHighlighted(lineIdx: number): boolean {
	if (!hoveredField.value) return false;
	return highlightMap[hoveredField.value]?.includes(lineIdx) ?? false;
}

onUnmounted(() => {
	disposeAll();
});
</script>

<template>
  <div class="form-demo">
    <div class="form-panel">
      <h3>Registration Form</h3>
      <p class="subtitle">formField + sync/async validation + derived aggregation</p>

      <form @submit.prevent="handleSubmit" class="form">
        <!-- Name -->
        <div class="field" :class="{ error: nameTouched && nameError, valid: nameDirty && !nameError }"
          @mouseenter="hoveredField = 'name'" @mouseleave="hoveredField = null">
          <label>Name</label>
          <input
            :value="name"
            @input="onInput(nameField, $event)"
            @blur="onBlur(nameField)"
            placeholder="Your name"
          />
          <span v-if="nameTouched && nameError" class="error-msg">{{ nameError }}</span>
        </div>

        <!-- Email -->
        <div class="field" :class="{ error: emailDirty && emailError && !emailValidating, valid: emailDirty && !emailError && !emailValidating }"
          @mouseenter="hoveredField = 'email'" @mouseleave="hoveredField = null">
          <label>
            Email
            <span v-if="emailValidating" class="validating">checking...</span>
          </label>
          <input
            :value="email"
            @input="onInput(emailField, $event)"
            @blur="onBlur(emailField)"
            placeholder="you@example.com"
            type="email"
          />
          <span v-if="emailDirty && emailError && !emailValidating" class="error-msg">{{ emailError }}</span>
        </div>

        <!-- Password -->
        <div class="field" :class="{ error: passwordDirty && passwordError, valid: passwordDirty && !passwordError }"
          @mouseenter="hoveredField = 'password'" @mouseleave="hoveredField = null">
          <label>Password</label>
          <input
            :value="password"
            @input="onInput(passwordField, $event)"
            @blur="onBlur(passwordField)"
            type="password"
            placeholder="Min 8 chars, 1 uppercase, 1 number"
          />
          <span v-if="passwordDirty && passwordError" class="error-msg">{{ passwordError }}</span>
        </div>

        <!-- Confirm Password -->
        <div class="field" :class="{ error: confirmDirty && confirmError, valid: confirmDirty && !confirmError }"
          @mouseenter="hoveredField = 'confirm'" @mouseleave="hoveredField = null">
          <label>Confirm Password</label>
          <input
            :value="confirm"
            @input="onInput(confirmField, $event)"
            @blur="onBlur(confirmField)"
            type="password"
            placeholder="Repeat password"
          />
          <span v-if="confirmDirty && confirmError" class="error-msg">{{ confirmError }}</span>
        </div>

        <!-- Actions -->
        <div class="actions">
          <button type="submit" :disabled="!formValid || formValidating" class="btn-submit">
            {{ formValidating ? 'Validating...' : submitted ? 'Submitted!' : 'Submit' }}
          </button>
          <button type="button" @click="resetAll" class="btn-reset" :disabled="!formDirty">
            Reset
          </button>
        </div>

        <!-- Status bar -->
        <div class="status-bar">
          <span :class="formValid ? 'status-ok' : 'status-err'">
            {{ formValid ? 'All fields valid' : 'Form has errors' }}
          </span>
          <span v-if="formDirty" class="status-dirty">Modified</span>
        </div>
      </form>
    </div>

    <!-- Code panel -->
    <div class="code-toggle">
      <button @click="showCode = !showCode" class="btn-code">
        {{ showCode ? 'Hide Source' : 'Show Source' }}
      </button>
    </div>
    <div v-if="showCode" class="code-panel">
      <div class="code-header">
        <span class="code-filename">form-builder.ts</span>
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
.form-demo {
  font-family: 'Instrument Sans', -apple-system, sans-serif;
  max-width: 520px;
  margin: 0 auto;
}
.form-panel {
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 12px;
  padding: 24px;
}
h3 { color: #e6edf3; margin: 0 0 4px; font-size: 18px; }
.subtitle { color: #7d8590; font-size: 13px; margin: 0 0 20px; }
.form { display: flex; flex-direction: column; gap: 16px; }
.field {
  display: flex; flex-direction: column; gap: 4px;
  transition: background 0.15s;
  padding: 8px;
  margin: -8px;
  border-radius: 8px;
}
.field:hover { background: rgba(88, 166, 255, 0.04); }
.field label {
  color: #c9d1d9; font-size: 13px; font-weight: 500;
  display: flex; align-items: center; gap: 8px;
}
.field input {
  background: #161b22; border: 1px solid #30363d; border-radius: 6px;
  padding: 8px 12px; color: #e6edf3; font-size: 14px; outline: none;
  transition: border-color 0.15s;
}
.field input:focus { border-color: #58a6ff; }
.field.error input { border-color: #f85149; }
.field.valid input { border-color: #3fb950; }
.error-msg { color: #f85149; font-size: 12px; }
.validating { color: #d29922; font-size: 11px; font-style: italic; }
.actions { display: flex; gap: 8px; margin-top: 4px; }
.btn-submit {
  background: #238636; color: #fff; border: none; border-radius: 6px;
  padding: 8px 20px; font-size: 14px; cursor: pointer;
  transition: opacity 0.15s;
}
.btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-reset {
  background: transparent; color: #7d8590; border: 1px solid #30363d;
  border-radius: 6px; padding: 8px 16px; font-size: 14px; cursor: pointer;
}
.btn-reset:disabled { opacity: 0.4; cursor: not-allowed; }
.status-bar {
  display: flex; gap: 12px; font-size: 12px; padding-top: 4px;
}
.status-ok { color: #3fb950; }
.status-err { color: #f85149; }
.status-dirty { color: #d29922; }
.code-toggle { margin-top: 12px; }
.btn-code {
  background: transparent; color: #58a6ff; border: 1px solid #21262d;
  border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer;
}
.code-panel {
  margin-top: 8px; background: #0d1117; border: 1px solid #21262d;
  border-radius: 8px; overflow: hidden;
}
.code-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid #21262d;
}
.code-filename {
  font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: #58a6ff;
}
.code-badge {
  font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: #7d8590;
  padding: 2px 8px; border: 1px solid #21262d; border-radius: 4px;
}
.code-body {
  overflow: auto; max-height: 400px; padding: 12px 0;
}
.code-body pre { margin: 0; background: transparent !important; border: none !important; box-shadow: none !important; }
.code-body code {
  font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; line-height: 1.6;
  background: transparent !important; border: none !important;
  color: #8b949e !important; padding: 0 !important;
}
.code-line {
  display: block; padding: 0 16px;
  transition: background 0.2s, color 0.2s;
}
.code-line.highlighted {
  background: rgba(77, 232, 194, 0.08);
  color: #4de8c2 !important;
}
.line-num {
  display: inline-block; width: 36px; min-width: 36px;
  color: #3a4a5e; user-select: none; text-align: right; margin-right: 16px;
}
</style>
