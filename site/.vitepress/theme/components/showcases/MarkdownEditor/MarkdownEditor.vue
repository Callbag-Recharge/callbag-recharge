<script setup lang="ts">
import { createMarkdownEditorHero } from "@examples/markdown-editor-hero";
import { useSubscribe } from "callbag-recharge/compat/vue";
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useLockPageScroll } from "../../shared/useLockPageScroll";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
const hero = createMarkdownEditorHero({
	initial: `# Welcome to the Editor

This is a **live Markdown editor** powered by callbag-recharge.

## Features

- **Undo / Redo** — full history support
- **Auto-save** — debounced checkpoint persistence
- **Live preview** — instant Markdown rendering
- **Validation** — character limit enforcement

## Try it out

Type in the left pane and watch the preview update in real-time.

\`\`\`ts
const editor = textEditor({ markdown: true });
const stats = contentStats(editor.buffer.content);
\`\`\`

1. Edit the text on the left
2. Watch the preview on the right
3. Try undo/redo with the toolbar or Ctrl+Z/Y
`,
	maxLength: 5000,
	autoSaveMs: 1500,
});

onUnmounted(() => hero.dispose());

// ---------------------------------------------------------------------------
// Reactive refs
// ---------------------------------------------------------------------------
const content = useSubscribe(hero.editor.buffer.content);
const preview = useSubscribe(hero.editor.preview);
const wordCount = useSubscribe(hero.wordCount);
const charCount = useSubscribe(hero.charCount);
const lineCount = useSubscribe(hero.lineCount);
const cursorDisplay = useSubscribe(hero.cursorDisplay);
const autoSaveStatus = useSubscribe(hero.autoSaveStatus);
const valid = useSubscribe(hero.editor.valid);
const error = useSubscribe(hero.editor.error);

// ---------------------------------------------------------------------------
// Textarea sync
// ---------------------------------------------------------------------------
const isFullscreen = ref(false);
useLockPageScroll(isFullscreen);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const previewRef = ref<HTMLElement | null>(null);
const isSyncing = ref(false);
const previewScrollRatio = ref(0);
const previewWasAtBottom = ref(false);

function onInput(e: Event) {
	const textarea = e.target as HTMLTextAreaElement;
	isSyncing.value = true;
	hero.editor.buffer.replaceAll(textarea.value);
	isSyncing.value = false;
	syncCursor();
}

function syncCursor() {
	const el = textareaRef.value;
	if (!el) return;
	hero.editor.buffer.cursor.start.set(el.selectionStart);
	hero.editor.buffer.cursor.end.set(el.selectionEnd);
}

// Watch for external content changes (undo/redo) and sync back to textarea
watch(content, (val) => {
	if (isSyncing.value) return;
	const el = textareaRef.value;
	if (el && el.value !== val) {
		const start = el.selectionStart;
		const end = el.selectionEnd;
		el.value = val;
		nextTick(() => {
			el.selectionStart = Math.min(start, val.length);
			el.selectionEnd = Math.min(end, val.length);
			syncCursor();
		});
	}
});

function onPreviewScroll() {
	const el = previewRef.value;
	if (!el) return;
	const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight);
	previewScrollRatio.value = el.scrollTop / maxScroll;
	previewWasAtBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
}

// Preserve preview scroll position when v-html updates on every keystroke.
watch(preview, async () => {
	const el = previewRef.value;
	if (!el) return;
	const ratio = previewScrollRatio.value;
	const atBottom = previewWasAtBottom.value;
	await nextTick();
	const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
	el.scrollTop = atBottom ? maxScroll : Math.round(maxScroll * ratio);
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
function onKeyDown(e: KeyboardEvent) {
	const mod = e.metaKey || e.ctrlKey;
	if (mod && e.key === "z" && !e.shiftKey) {
		e.preventDefault();
		hero.editor.commands.dispatch("undo");
		syncTextarea();
	} else if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
		e.preventDefault();
		hero.editor.commands.dispatch("redo");
		syncTextarea();
	} else if (e.key === "Tab") {
		e.preventDefault();
		const el = textareaRef.value;
		if (el) {
			const start = el.selectionStart;
			const end = el.selectionEnd;
			const val = el.value;
			el.value = `${val.slice(0, start)}\t${val.slice(end)}`;
			el.selectionStart = el.selectionEnd = start + 1;
			hero.editor.buffer.replaceAll(el.value);
			syncCursor();
		}
	}
}

// ---------------------------------------------------------------------------
// Sync textarea from buffer (after commands modify content/cursor)
// ---------------------------------------------------------------------------
function syncTextarea() {
	const el = textareaRef.value;
	if (!el) return;
	const val = hero.editor.buffer.content.get();
	if (el.value !== val) el.value = val;
	el.selectionStart = hero.editor.buffer.cursor.start.get();
	el.selectionEnd = hero.editor.buffer.cursor.end.get();
	el.focus();
}

// ---------------------------------------------------------------------------
// Toolbar actions
// ---------------------------------------------------------------------------
function undo() {
	hero.editor.commands.dispatch("undo");
	syncTextarea();
}

function redo() {
	hero.editor.commands.dispatch("redo");
	syncTextarea();
}

function insertHeading(level: 1 | 2 | 3) {
	syncCursor();
	hero.editor.commands.dispatch("heading", { level });
	syncTextarea();
}

function insertBold() {
	syncCursor();
	hero.editor.commands.dispatch("bold");
	syncTextarea();
}

function insertItalic() {
	syncCursor();
	hero.editor.commands.dispatch("italic");
	syncTextarea();
}

function insertCode() {
	syncCursor();
	hero.editor.commands.dispatch("code", { block: false });
	syncTextarea();
}

function insertList() {
	syncCursor();
	hero.editor.commands.dispatch("list", { ordered: false });
	syncTextarea();
}

// ---------------------------------------------------------------------------
// Auto-save indicator
// ---------------------------------------------------------------------------
const saveIcon = computed(() => {
	switch (autoSaveStatus.value) {
		case "saved":
			return { class: "save-dot saved", title: "All changes saved" };
		case "saving":
			return { class: "save-dot saving", title: "Saving..." };
		case "unsaved":
			return { class: "save-dot unsaved", title: "Unsaved changes" };
		default:
			return { class: "save-dot", title: "" };
	}
});
</script>

<template>
	<div class="markdown-editor" :class="{ fullscreen: isFullscreen }">
		<!-- Fullscreen toggle -->
		<button class="fullscreen-btn" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="isFullscreen = !isFullscreen">
			<svg v-if="!isFullscreen" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
			<svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
		</button>

		<!-- Toolbar -->
		<div class="editor-toolbar">
			<div class="toolbar-left">
				<button class="tool-btn" title="Undo (Ctrl+Z)" @mousedown.prevent @click="undo">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10h10a5 5 0 0 1 0 10H9" /><polyline points="7 14 3 10 7 6" /></svg>
				</button>
				<button class="tool-btn" title="Redo (Ctrl+Y)" @mousedown.prevent @click="redo">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10H11a5 5 0 0 0 0 10h4" /><polyline points="17 14 21 10 17 6" /></svg>
				</button>
				<span class="toolbar-divider" />
				<button class="tool-btn" title="Heading 1" @mousedown.prevent @click="insertHeading(1)">H1</button>
				<button class="tool-btn" title="Heading 2" @mousedown.prevent @click="insertHeading(2)">H2</button>
				<button class="tool-btn" title="Heading 3" @mousedown.prevent @click="insertHeading(3)">H3</button>
				<span class="toolbar-divider" />
				<button class="tool-btn" title="Bold" @mousedown.prevent @click="insertBold"><strong>B</strong></button>
				<button class="tool-btn" title="Italic" @mousedown.prevent @click="insertItalic"><em>I</em></button>
				<button class="tool-btn" title="Inline Code" @mousedown.prevent @click="insertCode"><code>&lt;/&gt;</code></button>
				<button class="tool-btn" title="List" @mousedown.prevent @click="insertList">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></svg>
				</button>
			</div>
			<div class="toolbar-right">
				<span :class="saveIcon.class" :title="saveIcon.title" />
				<span class="toolbar-stat" :title="`${charCount} characters`">{{ wordCount }} words</span>
				<span class="toolbar-stat">{{ lineCount }} lines</span>
				<span class="toolbar-stat cursor-display">{{ cursorDisplay }}</span>
			</div>
		</div>

		<!-- Validation error -->
		<div v-if="!valid && error" class="editor-error">{{ error }}</div>

		<!-- Split pane: Editor + Preview -->
		<div class="editor-body">
			<div class="editor-pane">
				<div class="pane-header">
					<span class="pane-label">Markdown</span>
				</div>
				<textarea
					ref="textareaRef"
					class="editor-textarea"
					:value="content"
					spellcheck="false"
					@input="onInput"
					@click="syncCursor"
					@keyup="syncCursor"
					@keydown="onKeyDown"
					@select="syncCursor"
				/>
			</div>
			<div class="preview-pane">
				<div class="pane-header">
					<span class="pane-label">Preview</span>
				</div>
				<div ref="previewRef" class="preview-content" v-html="preview" @scroll="onPreviewScroll" />
			</div>
		</div>
	</div>
</template>

<style scoped>
.markdown-editor {
	width: 100%;
	border: 1px solid var(--cr-border);
	border-radius: 16px;
	background: var(--cr-surface);
	overflow: hidden;
}

/* ── Toolbar ── */
.editor-toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 16px;
	border-bottom: 1px solid var(--cr-border-subtle);
	background: var(--cr-surface-raised);
	gap: 8px;
	flex-wrap: wrap;
}

.toolbar-left,
.toolbar-right {
	display: flex;
	align-items: center;
	gap: 4px;
}

.tool-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 32px;
	height: 32px;
	padding: 4px 8px;
	border: 1px solid transparent;
	border-radius: 6px;
	background: transparent;
	color: var(--cr-text-muted);
	font-family: var(--vp-font-family-mono);
	font-size: 0.8rem;
	cursor: pointer;
	transition: all 0.15s;
}

.tool-btn:hover {
	background: var(--cr-surface-hover);
	color: var(--cr-text);
	border-color: var(--cr-border-subtle);
}

.toolbar-divider {
	width: 1px;
	height: 20px;
	background: var(--cr-border-subtle);
	margin: 0 4px;
}

.toolbar-stat {
	font-family: var(--vp-font-family-mono);
	font-size: 0.72rem;
	color: var(--cr-text-muted);
	padding: 3px 8px;
	border-radius: 4px;
	background: var(--cr-surface);
}

.cursor-display {
	min-width: 80px;
	text-align: center;
}

/* ── Auto-save dot ── */
.save-dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	margin-right: 4px;
	transition: background-color 0.3s;
}

.save-dot.saved { background-color: var(--cr-aqua); }
.save-dot.saving { background-color: var(--cr-accent-warm); animation: pulse-save 1s infinite; }
.save-dot.unsaved { background-color: var(--cr-text-muted); }

@keyframes pulse-save {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.4; }
}

/* ── Validation error ── */
.editor-error {
	padding: 8px 16px;
	background: rgba(239, 68, 68, 0.1);
	border-bottom: 1px solid rgba(239, 68, 68, 0.3);
	color: #ef4444;
	font-size: 0.8rem;
	font-family: var(--vp-font-family-mono);
}

/* ── Split pane ── */
.editor-body {
	display: grid;
	grid-template-columns: 1fr 1fr;
	min-height: 500px;
}

.editor-pane {
	display: flex;
	flex-direction: column;
	border-right: 1px solid var(--cr-border-subtle);
	min-height: 0;
}

.preview-pane {
	display: flex;
	flex-direction: column;
	min-height: 0;
}

.pane-header {
	display: flex;
	align-items: center;
	padding: 8px 16px;
	border-bottom: 1px solid var(--cr-border-subtle);
	background: var(--cr-surface-raised);
}

.pane-label {
	font-family: var(--vp-font-family-mono);
	font-size: 0.72rem;
	color: var(--cr-text-muted);
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

/* ── Editor textarea ── */
.editor-textarea {
	flex: 1;
	width: 100%;
	padding: 16px;
	background: #091322;
	border: none;
	outline: none;
	resize: none;
	color: var(--cr-text);
	font-family: var(--vp-font-family-mono);
	font-size: 0.85rem;
	line-height: 1.7;
	tab-size: 2;
	min-height: 460px;
}

.editor-textarea::placeholder {
	color: var(--cr-text-muted);
}

/* ── Preview ── */
.preview-content {
	flex: 1;
	padding: 16px 24px;
	overflow: auto;
	font-family: var(--vp-font-family-base);
	font-size: 0.92rem;
	line-height: 1.7;
	color: var(--cr-text);
	min-height: 460px;
	min-width: 0;
}

.preview-content :deep(h1) {
	font-size: 1.8rem;
	font-weight: 700;
	margin: 0 0 16px;
	padding-bottom: 8px;
	border-bottom: 1px solid var(--cr-border-subtle);
	color: var(--cr-text);
}

.preview-content :deep(h2) {
	font-size: 1.35rem;
	font-weight: 600;
	margin: 24px 0 12px;
	color: var(--cr-text);
}

.preview-content :deep(h3) {
	font-size: 1.1rem;
	font-weight: 600;
	margin: 20px 0 8px;
	color: var(--cr-text);
}

.preview-content :deep(p) {
	margin: 8px 0;
}

.preview-content :deep(li) {
	margin: 4px 0;
	padding-left: 20px;
	position: relative;
}

.preview-content :deep(li)::before {
	content: "\2022";
	color: var(--cr-aqua);
	position: absolute;
	left: 4px;
}

.preview-content :deep(strong) {
	font-weight: 700;
	color: var(--cr-aqua);
}

.preview-content :deep(em) {
	color: var(--cr-accent-warm);
}

.preview-content :deep(code) {
	font-family: var(--vp-font-family-mono);
	font-size: 0.85em;
	padding: 2px 6px;
	border-radius: 4px;
	background: var(--cr-surface-raised);
	color: var(--cr-aqua-dim);
}

.preview-content :deep(pre) {
	margin: 12px 0;
	padding: 12px 16px;
	border-radius: 8px;
	background: #091322;
	overflow-x: auto;
}

.preview-content :deep(pre code) {
	background: transparent;
	padding: 0;
	font-size: 0.82rem;
	line-height: 1.6;
	color: var(--cr-text-muted);
}

.preview-content :deep(a) {
	color: var(--cr-aqua);
	text-decoration: none;
}

.preview-content :deep(a:hover) {
	text-decoration: underline;
}

.preview-content :deep(br) {
	display: block;
	content: "";
	margin: 4px 0;
}

/* ── Fullscreen toggle ── */
.fullscreen-btn {
	position: absolute;
	top: 10px;
	right: 10px;
	z-index: 10;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	border: 1px solid var(--cr-border-subtle);
	border-radius: 6px;
	background: var(--cr-surface-raised);
	color: var(--cr-text-muted);
	cursor: pointer;
	transition: all 0.15s;
	opacity: 0.6;
}

.fullscreen-btn:hover {
	opacity: 1;
	color: var(--cr-text);
	border-color: var(--cr-border);
}

.markdown-editor {
	position: relative;
}

.markdown-editor.fullscreen {
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	z-index: 9999;
	border-radius: 0;
	border: none;
	display: flex;
	flex-direction: column;
}

.markdown-editor.fullscreen .editor-body {
	flex: 1;
	min-height: 0;
}

.markdown-editor.fullscreen .editor-pane,
.markdown-editor.fullscreen .preview-pane {
	min-height: 0;
}

.markdown-editor.fullscreen .editor-textarea,
.markdown-editor.fullscreen .preview-content {
	min-height: 0;
	flex: 1;
}

/* ── Responsive ── */
@media (max-width: 768px) {
	.editor-body {
		grid-template-columns: 1fr;
	}

	.editor-pane {
		border-right: none;
		border-bottom: 1px solid var(--cr-border-subtle);
	}

	.editor-textarea,
	.preview-content {
		min-height: 300px;
	}
}
</style>
