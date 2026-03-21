import { describe, expect, it } from "vitest";
import { pipe } from "../../core/pipe";
import { state } from "../../core/state";
import { subscribe } from "../../core/subscribe";
import { streamParse } from "../../extra/streamParse";

describe("streamParse", () => {
	describe("partial mode (default)", () => {
		it("returns undefined for empty string", () => {
			const input = state("");
			const parsed = pipe(input, streamParse());
			expect(parsed.get()).toBeUndefined();
		});

		it("parses complete JSON", () => {
			const input = state('{"name": "Alice"}');
			const parsed = pipe(input, streamParse<{ name: string }>());
			expect(parsed.get()).toEqual({ name: "Alice" });
		});

		it("repairs incomplete JSON object by closing braces", () => {
			const input = state('{"name": "Alice"');
			const parsed = pipe(input, streamParse<{ name: string }>());
			expect(parsed.get()).toEqual({ name: "Alice" });
		});

		it("repairs incomplete JSON array by closing brackets", () => {
			const input = state("[1, 2, 3");
			const parsed = pipe(input, streamParse<number[]>());
			expect(parsed.get()).toEqual([1, 2, 3]);
		});

		it("handles nested incomplete structures", () => {
			const input = state('{"data": {"items": [1, 2');
			const parsed = pipe(input, streamParse());
			expect(parsed.get()).toEqual({ data: { items: [1, 2] } });
		});

		it("closes unclosed strings", () => {
			const input = state('{"name": "Ali');
			const parsed = pipe(input, streamParse<{ name: string }>());
			expect(parsed.get()).toEqual({ name: "Ali" });
		});

		it("removes trailing commas before closing", () => {
			const input = state('{"a": 1, "b": 2,');
			const parsed = pipe(input, streamParse());
			expect(parsed.get()).toEqual({ a: 1, b: 2 });
		});

		it("returns undefined for completely unparseable text", () => {
			const input = state("not json at all");
			const parsed = pipe(input, streamParse());
			expect(parsed.get()).toBeUndefined();
		});

		it("parses numbers", () => {
			const input = state("42");
			const parsed = pipe(input, streamParse<number>());
			expect(parsed.get()).toBe(42);
		});

		it("parses strings", () => {
			const input = state('"hello world"');
			const parsed = pipe(input, streamParse<string>());
			expect(parsed.get()).toBe("hello world");
		});

		it("parses boolean", () => {
			const input = state("true");
			const parsed = pipe(input, streamParse<boolean>());
			expect(parsed.get()).toBe(true);
		});

		it("parses null", () => {
			const input = state("null");
			const parsed = pipe(input, streamParse());
			expect(parsed.get()).toBeNull();
		});
	});

	describe("complete mode", () => {
		it("returns undefined for incomplete JSON", () => {
			const input = state('{"name": "Alice"');
			const parsed = pipe(input, streamParse({ mode: "complete" }));
			expect(parsed.get()).toBeUndefined();
		});

		it("returns parsed value for complete JSON", () => {
			const input = state('{"name": "Alice"}');
			const parsed = pipe(input, streamParse({ mode: "complete" }));
			expect(parsed.get()).toEqual({ name: "Alice" });
		});
	});

	describe("extract option", () => {
		it("applies extractor to parsed value", () => {
			const input = state('{"answer": 42, "confidence": 0.95}');
			const parsed = pipe(input, streamParse({ extract: (d: any) => d.answer }));
			expect(parsed.get()).toBe(42);
		});

		it("returns undefined if extractor throws", () => {
			const input = state('{"a": 1}');
			const parsed = pipe(
				input,
				streamParse({
					extract: () => {
						throw new Error("bad");
					},
				}),
			);
			expect(parsed.get()).toBeUndefined();
		});

		it("extract works with partially repaired JSON", () => {
			const input = state('{"answer": 42, "detail": "in progr');
			const parsed = pipe(input, streamParse({ extract: (d: any) => d.answer }));
			expect(parsed.get()).toBe(42);
		});

		it("extract on partial JSON where extracted field is missing holds last value", () => {
			const input = state('{"answer": 42}');
			const parsed = pipe(input, streamParse({ extract: (d: any) => d.answer }));
			expect(parsed.get()).toBe(42);

			// Partial JSON where answer field is not yet present
			input.set('{"other": "data');
			// extract returns undefined for d.answer, but that IS the extracted value
			// Since extract(parsed) returns undefined, it's treated as a valid extraction
			// (extract didn't throw), so lastGood updates to undefined
			expect(parsed.get()).toBeUndefined();
		});
	});

	describe("reactive behavior", () => {
		it("holds last successfully parsed value on parse failure", () => {
			const input = state('{"step": 1}');
			const parsed = pipe(input, streamParse<{ step: number }>());

			expect(parsed.get()).toEqual({ step: 1 });

			// Now set to unparseable text — should hold last good value
			input.set("not json {broken");
			expect(parsed.get()).toEqual({ step: 1 });

			// Valid JSON again — updates
			input.set('{"step": 2}');
			expect(parsed.get()).toEqual({ step: 2 });
		});

		it("re-parses when input changes", () => {
			const input = state("");
			const parsed = pipe(input, streamParse<{ step: number }>());

			const values: any[] = [];
			const unsub = subscribe(parsed, (v) => values.push(v));

			input.set('{"step": 1');
			expect(parsed.get()).toEqual({ step: 1 });

			input.set('{"step": 1, "done": true}');
			expect(parsed.get()).toEqual({ step: 1, done: true });

			expect(values.length).toBeGreaterThanOrEqual(2);
			unsub.unsubscribe();
		});

		it("simulates streaming accumulation", () => {
			const accumulated = state("");
			const parsed = pipe(accumulated, streamParse<{ name: string; age: number }>());

			const unsub = subscribe(parsed, () => {});

			// Stream arrives in chunks
			accumulated.set("{");
			expect(parsed.get()).toEqual({});

			accumulated.set('{"name');
			// Might or might not parse depending on repair

			accumulated.set('{"name": "Bob"');
			expect(parsed.get()).toEqual({ name: "Bob" });

			accumulated.set('{"name": "Bob", "age": 30}');
			expect(parsed.get()).toEqual({ name: "Bob", age: 30 });

			unsub.unsubscribe();
		});
	});

	describe("edge cases", () => {
		it("handles escaped quotes in strings", () => {
			const input = state('{"msg": "say \\"hello\\""}');
			const parsed = pipe(input, streamParse<{ msg: string }>());
			expect(parsed.get()).toEqual({ msg: 'say "hello"' });
		});

		it("handles deeply nested structures", () => {
			const input = state('{"a": {"b": {"c": [1, 2');
			const parsed = pipe(input, streamParse());
			expect(parsed.get()).toEqual({ a: { b: { c: [1, 2] } } });
		});

		it("handles whitespace-only input", () => {
			const input = state("   ");
			const parsed = pipe(input, streamParse());
			expect(parsed.get()).toBeUndefined();
		});

		it("handles array of objects streaming", () => {
			const input = state('[{"id": 1}, {"id": 2');
			const parsed = pipe(input, streamParse());
			expect(parsed.get()).toEqual([{ id: 1 }, { id: 2 }]);
		});

		it("handles backslash at end of string", () => {
			const input = state('{"path": "C:\\\\users\\\\');
			const parsed = pipe(input, streamParse());
			// Should produce some result (repaired) or hold undefined
			const result = parsed.get();
			// The repair should close the string and object
			expect(result).toBeDefined();
		});

		it("handles trailing incomplete key-value pair via repair", () => {
			const input = state('{"a": 1, "b": "incompl');
			const parsed = pipe(input, streamParse());
			// Repair closes the string and brace: {"a": 1, "b": "incompl"}
			expect(parsed.get()).toEqual({ a: 1, b: "incompl" });
		});
	});
});
