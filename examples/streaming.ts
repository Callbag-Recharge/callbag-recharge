/**
 * AI chat streaming — switchMap + scan (3 operators, no footguns)
 *
 * switchMap auto-cancels the previous stream when a new prompt arrives.
 * scan accumulates chunks into a full response.
 *
 * With Option D3, switchMap is purely reactive — no eager evaluation,
 * no undefined leak, no extra filter needed.
 *
 * Run: npx tsx examples/streaming.ts
 */
import { pipe, producer, state } from "callbag-recharge";
import {
	filter,
	firstValueFrom,
	fromTimer,
	scan,
	subscribe,
	switchMap,
} from "callbag-recharge/extra";

// Simulate a streaming LLM response
function fakeLLMStream(prompt: string, signal: AbortSignal): AsyncIterable<string> {
	const words = `Response to "${prompt}": Hello world from the AI`.split(" ");
	return {
		async *[Symbol.asyncIterator]() {
			for (const word of words) {
				if (signal.aborted) return;
				await firstValueFrom(fromTimer(50, signal));
				if (signal.aborted) return;
				yield `${word} `;
			}
		},
	};
}

// User prompt — setting this auto-cancels any in-flight stream
const prompt = state("");

// Stream response with auto-cancellation via switchMap + scan
// Before D3: needed 5 operators (filter + switchMap + filter(undefined) + scan)
// After D3:  3 operators — switchMap is lazy, no undefined leak
const fullResponse = pipe(
	prompt,
	filter((p): p is string => p.length > 0),
	switchMap((p) =>
		producer<string>(({ emit, complete }) => {
			const ctrl = new AbortController();
			(async () => {
				for await (const chunk of fakeLLMStream(p, ctrl.signal)) {
					emit(chunk);
				}
				complete();
			})();
			return () => ctrl.abort(); // cleanup cancels the stream
		}),
	),
	scan((acc, chunk) => acc + (chunk ?? ""), ""),
);

const unsub = subscribe(fullResponse, (text) => {
	process.stdout.write(`\r${text}`);
});

// Start streaming
prompt.set("Tell me a joke");

// After the stream completes, clean up
firstValueFrom(fromTimer(500)).then(() => {
	console.log("\n--- done ---");
	unsub();
});
