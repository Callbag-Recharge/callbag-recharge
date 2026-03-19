/**
 * Hybrid Cloud+Edge Model Routing
 *
 * Demonstrates: Confidence-based routing between a local/edge LLM
 * and a cloud LLM, with automatic fallback via rescue().
 * Research shows this approach reduces cloud costs by 60% and latency by 40%.
 */

import { pipe, producer, state } from "callbag-recharge";
import { merge, rescue, subscribe, switchMap } from "callbag-recharge/extra";
import { route } from "callbag-recharge/orchestrate";

// ── Types ────────────────────────────────────────────────────

interface LLMRequest {
	prompt: string;
	maxTokens: number;
	complexity: "simple" | "moderate" | "complex";
}

interface LLMResponse {
	text: string;
	model: string;
	latencyMs: number;
	cost: number;
}

// ── Simulated inference functions ────────────────────────────

function localInfer(req: LLMRequest): Promise<LLMResponse> {
	return Promise.resolve({
		text: `(local answer to: ${req.prompt.slice(0, 30)})`,
		model: "llama3.2",
		latencyMs: 120,
		cost: 0,
	});
}

function cloudInfer(req: LLMRequest): Promise<LLMResponse> {
	return Promise.resolve({
		text: `(cloud answer to: ${req.prompt.slice(0, 30)})`,
		model: "gpt-4o",
		latencyMs: 800,
		cost: 0.003,
	});
}

// ── Request source ───────────────────────────────────────────

const request = state<LLMRequest | null>(null, { name: "request" });

// ── Route based on complexity ────────────────────────────────

// route() splits the stream: simple/moderate → local, complex → cloud
const [localRoute, cloudRoute] = route(
	request,
	(req: LLMRequest | null) => req !== null && req.complexity !== "complex",
);

// ── Local model (Ollama / WebLLM) with cloud fallback ────────

const localResponse = pipe(
	localRoute,
	// switchMap runs local inference for each routed request
	switchMap((req: LLMRequest | null) =>
		producer<LLMResponse>(({ emit, complete, error }) => {
			if (!req) return;
			localInfer(req)
				.then((res) => {
					emit(res);
					complete();
				})
				.catch((e) => error(e));
		}),
	),
	// rescue() catches local model errors and falls back to cloud
	rescue(() =>
		producer<LLMResponse>(({ emit, complete }) => {
			emit({
				text: "(cloud fallback response)",
				model: "gpt-4o",
				latencyMs: 800,
				cost: 0.003,
			});
			complete();
		}),
	),
);

// ── Cloud model (OpenAI / Anthropic) ─────────────────────────

const cloudResponse = pipe(
	cloudRoute,
	switchMap((req: LLMRequest | null) =>
		producer<LLMResponse>(({ emit, complete, error }) => {
			if (!req) return;
			cloudInfer(req)
				.then((res) => {
					emit(res);
					complete();
				})
				.catch((e) => error(e));
		}),
	),
);

// ── Derived metrics ──────────────────────────────────────────

const routingStats = state(
	{ localCount: 0, cloudCount: 0, totalCost: 0 },
	{ name: "routingStats" },
);

// ── Merge all responses ──────────────────────────────────────

const allResponses = merge(localResponse, cloudResponse);

subscribe(allResponses, (resp) => {
	if (resp) {
		const source = resp.model === "llama3.2" ? "LOCAL" : "CLOUD";
		console.log(`[${source}] ${resp.model}: "${resp.text}" (${resp.latencyMs}ms, $${resp.cost})`);
		routingStats.update((s) => ({
			localCount: s.localCount + (resp.model === "llama3.2" ? 1 : 0),
			cloudCount: s.cloudCount + (resp.model !== "llama3.2" ? 1 : 0),
			totalCost: s.totalCost + resp.cost,
		}));
	}
});

// Simple question → routed to local model
request.set({ prompt: "What is 2+2?", maxTokens: 50, complexity: "simple" });

// Complex question → routed to cloud
request.set({
	prompt: "Analyze the geopolitical implications of...",
	maxTokens: 2000,
	complexity: "complex",
});

console.log("Stats:", routingStats.get());
