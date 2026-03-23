/**
 * On-Device LLM Streaming State
 *
 * Demonstrates: Managing token streams from a local LLM (Ollama, WebLLM)
 * as reactive sources with auto-cancellation and chunk accumulation.
 * Works with any OpenAI-compatible streaming endpoint.
 */

import { derived, pipe, state } from "callbag-recharge";
import { filter, scan, subscribe, switchMap } from "callbag-recharge/extra";
import { fromAbortable } from "callbag-recharge/utils/cancellableStream";

// ── State ────────────────────────────────────────────────────

const prompt = state("", { name: "prompt" });
const isStreaming = state(false, { name: "streaming" });

// ── Token stream from local model ───────────────────────────

// switchMap auto-cancels previous inference when a new prompt arrives
const tokens = pipe(
	prompt,
	filter((p: string) => p.length > 0),
	switchMap((p: string) => {
		isStreaming.set(true);
		return fromAbortable<string>(
			async function* (signal) {
				// Works with Ollama (localhost:11434) or any OpenAI-compatible endpoint
				const res = await fetch("http://localhost:11434/api/generate", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ model: "llama4", prompt: p, stream: true }),
					signal,
				});
				if (!res.ok || !res.body) {
					throw new Error(`HTTP ${res.status}: ${res.statusText}`);
				}
				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					const lines = decoder.decode(value, { stream: true }).split("\n").filter(Boolean);
					for (const line of lines) {
						try {
							const chunk = JSON.parse(line);
							if (chunk.response) yield chunk.response;
							if (chunk.done) return;
						} catch {
							/* skip malformed lines */
						}
					}
				}
			},
			{
				name: "llm-tokens",
				onComplete: () => isStreaming.set(false),
				onError: () => isStreaming.set(false),
				onAbort: () => isStreaming.set(false),
			},
		);
	}),
);

// ── Accumulated response ─────────────────────────────────────

const response = pipe(
	tokens,
	filter((t): t is string => t !== undefined),
	scan((acc: string, token: string) => acc + token, ""),
);

// ── Derived metrics ──────────────────────────────────────────

const tokenCount = derived(
	[response],
	() => (response.get() ?? "").split(/\s+/).filter(Boolean).length,
	{ name: "tokenCount" },
);

const _charCount = derived([response], () => (response.get() ?? "").length, { name: "charCount" });

// ── Usage ────────────────────────────────────────────────────

subscribe(response, (text) => {
	process.stdout.write(`\r${text ?? ""}`);
});

subscribe(tokenCount, (_count) => {
	// Token count updates reactively as response grows
});

// Send a prompt — previous inference auto-cancels
prompt.set("Explain reactive programming in one paragraph");

// Send another prompt — previous one is automatically cancelled
// prompt.set('What is the callbag protocol?')
