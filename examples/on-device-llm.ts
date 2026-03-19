/**
 * On-Device LLM Streaming State
 *
 * Demonstrates: Managing token streams from a local LLM (Ollama, WebLLM)
 * as reactive sources with auto-cancellation and chunk accumulation.
 * Works with any OpenAI-compatible streaming endpoint.
 */

import { derived, pipe, producer, state } from "callbag-recharge";
import { filter, scan, subscribe, switchMap } from "callbag-recharge/extra";

// ── State ────────────────────────────────────────────────────

const prompt = state("", { name: "prompt" });
const isStreaming = state(false, { name: "streaming" });

// ── Token stream from local model ───────────────────────────

// switchMap auto-cancels previous inference when a new prompt arrives
const tokens = pipe(
	prompt,
	filter((p: string) => p.length > 0),
	switchMap((p: string) =>
		producer<string>(({ emit, complete, error }) => {
			const ctrl = new AbortController();
			isStreaming.set(true);

			// Works with Ollama (localhost:11434) or any OpenAI-compatible endpoint
			fetch("http://localhost:11434/api/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model: "llama3.2", prompt: p, stream: true }),
				signal: ctrl.signal,
			})
				.then(async (res) => {
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
								if (chunk.response) emit(chunk.response);
								if (chunk.done) {
									isStreaming.set(false);
									complete();
									return;
								}
							} catch {
								/* skip malformed lines */
							}
						}
					}
					isStreaming.set(false);
					complete();
				})
				.catch((e) => {
					isStreaming.set(false);
					if (e.name !== "AbortError") error(e);
				});

			return () => {
				ctrl.abort();
				isStreaming.set(false);
			};
		}),
	),
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
