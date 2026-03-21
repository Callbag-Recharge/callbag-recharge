import { describe, expect, it } from "vitest";
import { fromTrigger } from "../../extra/fromTrigger";
import { subscribe } from "../../extra/subscribe";
import { branch } from "../../orchestrate/branch";
import { toD2, toMermaid } from "../../orchestrate/diagram";
import { join } from "../../orchestrate/join";
import { pipeline, step } from "../../orchestrate/pipeline";
import { task } from "../../orchestrate/task";

describe("toMermaid (pipeline diagram)", () => {
	it("serializes a simple linear pipeline", () => {
		const steps = {
			trigger: step(fromTrigger<string>()),
			fetch: task(["trigger"], async (_signal, [v]: [string]) => v),
			process: task(["fetch"], async (_signal, [v]: [string]) => v),
		};

		const result = toMermaid(steps);

		expect(result).toContain("graph TD");
		expect(result).toContain("trigger");
		expect(result).toContain("fetch");
		expect(result).toContain("process");
		expect(result).toContain("source");
		expect(result).toContain("task");
		// Edges
		expect(result).toContain("trigger --> fetch");
		expect(result).toContain("fetch --> process");
	});

	it("supports custom direction", () => {
		const steps = {
			a: step(fromTrigger<void>()),
			b: task(["a"], (_signal) => 1),
		};

		const result = toMermaid(steps, { direction: "LR" });
		expect(result).toContain("graph LR");
	});

	it("includes branch .fail companion", () => {
		const steps = {
			input: step(fromTrigger<number>()),
			check: branch<number>("input", (v) => v > 0),
			good: task(["check"], async (_signal, [v]: [number]) => v),
			bad: task(["check.fail"], async (_signal, [v]: [number]) => v),
		};

		const result = toMermaid(steps);

		expect(result).toContain("check");
		expect(result).toContain("check.fail");
		expect(result).toContain("branch");
		// Branch fail should have edge from check
		expect(result).toMatch(/check[^\n]* --> check_fail/);
	});

	it("decorates with runtime status when provided", async () => {
		const steps = {
			trigger: step(fromTrigger<void>()),
			work: task(["trigger"], async (_signal) => {
				await new Promise((r) => setTimeout(r, 10));
				return 42;
			}),
		};
		const wf = pipeline(steps);
		const unsub = subscribe(wf.steps.work, () => {});

		(wf.steps.trigger as any).fire();
		await new Promise((r) => setTimeout(r, 50));

		const result = toMermaid(steps, { status: wf });

		// Should have classDef declarations
		expect(result).toContain("classDef idle");
		expect(result).toContain("classDef completed");

		unsub.unsubscribe();
		wf.destroy();
	});

	it("handles diamond topology", () => {
		const steps = {
			trigger: step(fromTrigger<void>()),
			left: task(["trigger"], (_signal) => 1),
			right: task(["trigger"], (_signal) => 2),
			merge: task(["left", "right"], (_signal, [l, r]: [number, number]) => l + r),
		};

		const result = toMermaid(steps);

		expect(result).toContain("trigger --> left");
		expect(result).toContain("trigger --> right");
		expect(result).toContain("left --> merge");
		expect(result).toContain("right --> merge");
	});

	it("detects join step type via _kind discriminator", () => {
		const steps = {
			trigger: step(fromTrigger<string>()),
			a: task(["trigger"], (_signal) => [1]),
			b: task(["trigger"], (_signal) => [2]),
			merged: join(["a", "b"], "append"),
		};

		const mermaid = toMermaid(steps);
		expect(mermaid).toContain("merged (join)");
		expect(mermaid).not.toContain("merged (task)");

		const d2 = toD2(steps);
		expect(d2).toContain("merged (join)");
		expect(d2).toContain("shape: hexagon");
	});
});

describe("toD2 (pipeline diagram)", () => {
	it("serializes a simple linear pipeline", () => {
		const steps = {
			trigger: step(fromTrigger<string>()),
			fetch: task(["trigger"], async (_signal, [v]: [string]) => v),
		};

		const result = toD2(steps);

		expect(result).toContain("direction: down");
		expect(result).toContain("trigger");
		expect(result).toContain("fetch");
		expect(result).toContain("shape: oval"); // source
		expect(result).toContain("shape: rectangle"); // task
		expect(result).toContain("trigger -> fetch");
	});

	it("supports custom direction", () => {
		const steps = {
			a: step(fromTrigger<void>()),
			b: task(["a"], (_signal) => 1),
		};

		const result = toD2(steps, { direction: "right" });
		expect(result).toContain("direction: right");
	});

	it("includes branch with diamond shape", () => {
		const steps = {
			input: step(fromTrigger<number>()),
			check: branch<number>("input", (v) => v > 0),
		};

		const result = toD2(steps);

		expect(result).toContain("shape: diamond");
		expect(result).toContain("check");
		expect(result).toContain("check_fail");
	});

	it("decorates with runtime status when provided", async () => {
		const steps = {
			trigger: step(fromTrigger<void>()),
			work: task(["trigger"], (_signal) => 42),
		};
		const wf = pipeline(steps);
		const unsub = subscribe(wf.steps.work, () => {});

		(wf.steps.trigger as any).fire();
		await new Promise((r) => setTimeout(r, 50));

		const result = toD2(steps, { status: wf });

		// Status should appear on a node line (with shape declaration)
		expect(result).toMatch(/\[(idle|active|completed)\].*shape:/);
		// At least one node should have status annotation
		const nodeLines = result.split("\n").filter((l) => l.includes("shape:"));
		expect(nodeLines.some((l) => /\[(idle|active|completed)\]/.test(l))).toBe(true);

		unsub.unsubscribe();
		wf.destroy();
	});

	it("handles diamond topology", () => {
		const steps = {
			trigger: step(fromTrigger<void>()),
			left: task(["trigger"], (_signal) => 1),
			right: task(["trigger"], (_signal) => 2),
			merge: task(["left", "right"], (_signal, [l, r]: [number, number]) => l + r),
		};

		const result = toD2(steps);

		expect(result).toContain("trigger -> left");
		expect(result).toContain("trigger -> right");
		expect(result).toContain("left -> merge");
		expect(result).toContain("right -> merge");
	});
});
