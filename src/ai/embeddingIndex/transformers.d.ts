// Type shim for @huggingface/transformers — peer dependency, not bundled.
// Only the subset used by embeddingIndex is declared here.
declare module "@huggingface/transformers" {
	export function pipeline(task: string, model: string): Promise<any>;
}
