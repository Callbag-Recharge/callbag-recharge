#!/usr/bin/env node

/**
 * Generate API docs from TypeScript source JSDoc.
 *
 * Usage:
 *   node scripts/gen-api-docs.mjs                    # all registered entries
 *   node scripts/gen-api-docs.mjs state map          # specific functions
 *   node scripts/gen-api-docs.mjs --check             # dry-run, exit 1 if stale
 *
 * Reads structured JSDoc from source, outputs site/api/<name>.md.
 *
 * Supported JSDoc tags:
 *   @description  - first line of JSDoc (implicit)
 *   @param        - parameter docs
 *   @returns      - return type description
 *   @remarks      - bullet list for "Options / Behavior Details"
 *   @example      - code examples (multiple allowed, optional title after tag)
 *   @seeAlso      - comma-separated links for "See Also"
 *   @category     - "core" | "extra" | "data" | etc.
 *   @optionsType  - name of the options interface to expand (e.g. "StoreOptions")
 *   @returnsTable - pipe-separated method rows: "method | signature | description"
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SITE_API = resolve(ROOT, "site/api");

// ─── Registry: map function names to source files ───────────────────────────

const REGISTRY = {
	// Core
	state: "src/core/state.ts",
	derived: "src/core/derived.ts",
	effect: "src/core/effect.ts",
	producer: "src/core/producer.ts",
	operator: "src/core/operator.ts",
	pipe: "src/core/pipe.ts",
	batch: "src/core/protocol.ts",
	teardown: "src/core/protocol.ts",
	subscribe: "src/core/subscribe.ts",

	// Raw — pure callbag primitives (no core deps)
	rawSubscribe: "src/raw/subscribe.ts",
	firstValueFrom: "src/raw/firstValueFrom.ts",
	fromTimer: "src/raw/fromTimer.ts",
	fromNodeCallback: "src/raw/fromNodeCallback.ts",
	latestAsync: "src/raw/latestAsync.ts",
	rawSkip: "src/raw/skip.ts",
	rawFromPromise: "src/raw/fromPromise.ts",
	rawFromAsyncIter: "src/raw/fromAsyncIter.ts",
	rawFromAny: "src/raw/fromAny.ts",
	rawRace: "src/raw/race.ts",

	// Extras — operators
	map: "src/extra/map.ts",
	filter: "src/extra/filter.ts",
	scan: "src/extra/scan.ts",
	debounce: "src/extra/debounce.ts",
	throttle: "src/extra/throttle.ts",
	delay: "src/extra/delay.ts",
	switchMap: "src/extra/switchMap.ts",
	concatMap: "src/extra/concatMap.ts",
	exhaustMap: "src/extra/exhaustMap.ts",
	flat: "src/extra/flat.ts",
	take: "src/extra/take.ts",
	skip: "src/extra/skip.ts",
	first: "src/extra/first.ts",
	last: "src/extra/last.ts",
	find: "src/extra/find.ts",
	elementAt: "src/extra/elementAt.ts",
	distinctUntilChanged: "src/extra/distinctUntilChanged.ts",
	startWith: "src/extra/startWith.ts",
	pairwise: "src/extra/pairwise.ts",
	takeUntil: "src/extra/takeUntil.ts",
	takeWhile: "src/extra/takeWhile.ts",
	withLatestFrom: "src/extra/withLatestFrom.ts",
	partition: "src/extra/partition.ts",
	share: "src/extra/share.ts",
	tap: "src/extra/tap.ts",
	remember: "src/extra/remember.ts",
	cached: "src/extra/cached.ts",
	pipeRaw: "src/extra/pipeRaw.ts",

	// Extras — sources
	interval: "src/extra/interval.ts",
	fromIter: "src/extra/fromIter.ts",
	fromAsyncIter: "src/extra/fromAsyncIter.ts",
	fromEvent: "src/extra/fromEvent.ts",
	fromPromise: "src/extra/fromPromise.ts",
	fromObs: "src/extra/fromObs.ts",
	of: "src/extra/of.ts",
	empty: "src/extra/empty.ts",
	throwError: "src/extra/throwError.ts",
	never: "src/extra/never.ts",

	// Extras — multi-source
	merge: "src/extra/merge.ts",
	combine: "src/extra/combine.ts",
	concat: "src/extra/concat.ts",
	race: "src/extra/race.ts",

	// Extras — buffering & windowing
	buffer: "src/extra/buffer.ts",
	bufferCount: "src/extra/bufferCount.ts",
	bufferTime: "src/extra/bufferTime.ts",
	window: "src/extra/window.ts",
	windowCount: "src/extra/windowCount.ts",
	windowTime: "src/extra/windowTime.ts",
	sample: "src/extra/sample.ts",
	audit: "src/extra/audit.ts",
	timeout: "src/extra/timeout.ts",

	// Extras — aggregation
	reduce: "src/extra/reduce.ts",
	toArray: "src/extra/toArray.ts",
	groupBy: "src/extra/groupBy.ts",

	// Extras — error handling & resubscription
	rescue: "src/extra/rescue.ts",
	repeat: "src/extra/repeat.ts",

	// Extras — sources (from orchestrate)
	fromTrigger: "src/extra/fromTrigger.ts",
	fromCron: "src/extra/fromCron.ts",
	route: "src/extra/route.ts",

	// Utils
	cascadingCache: "src/utils/cascadingCache.ts",
	keyedAsync: "src/utils/keyedAsync.ts",
	retry: "src/utils/retry.ts",
	resolveBackoffPreset: "src/utils/backoff.ts",
	tieredStorage: "src/utils/tieredStorage.ts",
	track: "src/utils/track.ts",
	checkpoint: "src/utils/checkpoint.ts",
	tokenTracker: "src/utils/tokenTracker.ts",
	withBreaker: "src/utils/withBreaker.ts",
	withMeta: "src/utils/withMeta.ts",
	withStatus: "src/utils/withStatus.ts",
	dag: "src/utils/dag.ts",
	autoSave: "src/utils/autoSave.ts",
	contentStats: "src/utils/contentStats.ts",
	cursorInfo: "src/utils/cursorInfo.ts",

	// Memory
	collection: "src/memory/collection.ts",
	lightCollection: "src/memory/lightCollection.ts",
	memoryNode: "src/memory/node.ts",
	knowledgeGraph: "src/memory/knowledgeGraph.ts",
	vectorIndex: "src/memory/vectorIndex.ts",

	// Data
	reactiveLog: "src/data/reactiveLog.ts",
	reactiveMap: "src/data/reactiveMap.ts",
	reactiveIndex: "src/data/reactiveIndex.ts",
	reactiveList: "src/data/reactiveList.ts",
	pubsub: "src/data/pubsub.ts",

	// AI
	fromLLM: "src/ai/fromLLM.ts",
	toToolCallRequests: "src/ai/fromLLM.ts",
	chatStream: "src/ai/chatStream/index.ts",
	conversationThread: "src/ai/conversationThread/index.ts",
	docIndex: "src/ai/docIndex/index.ts",
	embeddingIndex: "src/ai/embeddingIndex/index.ts",
	memoryStore: "src/ai/memoryStore/index.ts",
	ragPipeline: "src/ai/ragPipeline/index.ts",
	conversationSummary: "src/ai/conversationSummary/index.ts",

	// Orchestrate — workflow nodes
	taskState: "src/orchestrate/taskState.ts",
	pipeline: "src/orchestrate/pipeline.ts",
	source: "src/orchestrate/pipeline.ts",
	task: "src/orchestrate/task.ts",
	branch: "src/orchestrate/branch.ts",
	switchStep: "src/orchestrate/switchStep.ts",
	approval: "src/orchestrate/approval.ts",
	gate: "src/orchestrate/gate.ts",
	executionLog: "src/orchestrate/executionLog.ts",
	fileLogAdapter: "src/orchestrate/executionLogAdapters.node.ts",
	sqliteLogAdapter: "src/orchestrate/executionLogAdapters.ts",
	indexedDBLogAdapter: "src/orchestrate/executionLogAdapters.ts",
	onFailure: "src/orchestrate/onFailure.ts",
	wait: "src/orchestrate/wait.ts",
	subPipeline: "src/orchestrate/subPipeline.ts",
	dagLayout: "src/orchestrate/dagLayout.ts",
	workflowNode: "src/orchestrate/workflowNode.ts",

	// Compat — Vue
	useSubscribeRecord: "src/compat/vue/index.ts",

	// Extras — sinks
	forEach: "src/extra/forEach.ts",

	// Extras — control flow
	pausable: "src/extra/pausable.ts",

	// Extras — universal source
	fromAny: "src/extra/fromAny.ts",

	// Extras — interop
	subject: "src/extra/subject.ts",
	wrap: "src/extra/wrap.ts",

	// Messaging
	topic: "src/messaging/topic.ts",
	subscription: "src/messaging/subscription.ts",
	repeatPublish: "src/messaging/repeatPublish.ts",
	jobQueue: "src/messaging/jobQueue.ts",
	jobFlow: "src/messaging/jobFlow.ts",
	topicBridge: "src/messaging/topicBridge.ts",
	wsMessageTransport: "src/messaging/wsTransport.ts",
	h2MessageTransport: "src/messaging/h2Transport.ts",
	listTopics: "src/messaging/admin.ts",
	inspectSubscription: "src/messaging/admin.ts",
	resetCursor: "src/messaging/admin.ts",

	// Patterns
	textBuffer: "src/patterns/textBuffer/index.ts",
};

// ─── TypeScript parsing ─────────────────────────────────────────────────────

function parseSource(filePath) {
	const absPath = resolve(ROOT, filePath);
	const source = readFileSync(absPath, "utf-8");
	const sourceFile = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true);
	return { sourceFile, source };
}

/**
 * Find the exported function declaration (or the last overload signature)
 * for a given function name.
 */
function findExportedFunction(sourceFile, name) {
	let fn = null;
	const overloads = [];

	ts.forEachChild(sourceFile, (node) => {
		if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
			const isExported =
				node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
			if (isExported) {
				if (node.body) {
					fn = node; // implementation
				} else {
					overloads.push(node); // overload signature
				}
			}
		}
	});

	return { implementation: fn, overloads };
}

/**
 * Extract the namespace declaration for a function (e.g., derived.from).
 */
function findNamespace(sourceFile, name) {
	let ns = null;
	ts.forEachChild(sourceFile, (node) => {
		if (ts.isModuleDeclaration(node) && node.name?.text === name) {
			ns = node;
		}
	});
	return ns;
}

// ─── JSDoc extraction ───────────────────────────────────────────────────────

function getJSDoc(node) {
	// ts stores JSDoc as node.jsDoc array
	const jsDocs = node.jsDoc;
	if (!jsDocs || jsDocs.length === 0) return null;
	return jsDocs[jsDocs.length - 1]; // last JSDoc block
}

/**
 * Re-indent code that lost its indentation from JSDoc * stripping.
 * Uses brace tracking to restore 2-space indentation.
 */
function reindentCode(code) {
	const lines = code.split("\n");
	const result = [];
	let depth = 0;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			result.push("");
			continue;
		}

		// Decrease depth before the line if it starts with closing brace/bracket/paren
		if (/^[}\])]/.test(trimmed)) {
			depth = Math.max(0, depth - 1);
		}

		result.push("  ".repeat(depth) + trimmed);

		// Increase depth after lines ending with opening brace/bracket/paren
		// but not if the same line closes it (e.g., `{ x: 0, y: 0 }`)
		const opens = (trimmed.match(/[{([[]/g) || []).length;
		const closes = (trimmed.match(/[})\]]/g) || []).length;
		depth += opens - closes;
		if (depth < 0) depth = 0;
	}

	// Trim trailing empty lines
	while (result.length > 0 && result[result.length - 1] === "") result.pop();

	return result.join("\n");
}

function extractJSDocData(jsDoc) {
	const result = {
		description: "",
		params: [],
		returns: "",
		remarks: [],
		examples: [],
		seeAlso: [],
		optionsType: "",
		optionsRows: [],
		returnsTable: [],
		category: "",
	};
	if (!jsDoc) return result;

	// Description: the main comment text (before tags)
	if (jsDoc.comment) {
		result.description =
			typeof jsDoc.comment === "string"
				? jsDoc.comment
				: jsDoc.comment.map((c) => c.text || "").join("");
	}

	if (!jsDoc.tags) return result;

	for (const tag of jsDoc.tags) {
		const tagName = tag.tagName.text;
		const comment =
			typeof tag.comment === "string"
				? tag.comment
				: tag.comment?.map((c) => c.text || "").join("") || "";

		switch (tagName) {
			case "param": {
				const name = tag.name?.getText() || "";
				// Strip leading "- " from JSDoc @param name - description syntax
				const desc = comment.trim().replace(/^-\s*/, "");
				result.params.push({ name, description: desc });
				break;
			}
			case "returns":
			case "return":
				result.returns = comment.trim();
				break;
			case "remarks":
				// Each remark is a bullet: "**Title:** description"
				result.remarks.push(comment.trim());
				break;
			case "example": {
				// Example: optional title on first line, then ```lang\ncode\n```
				const raw = comment.trim();
				const codeMatch = raw.match(/^([\s\S]*?)```(\w*)\n([\s\S]*?)```\s*$/);
				if (codeMatch) {
					const title = codeMatch[1].trim();
					const lang = codeMatch[2] || "ts";
					const code = codeMatch[3];
					// Re-indent: TSDoc strips leading spaces from * lines.
					// Detect brace-based indentation and restore 2-space indent.
					const reindented = reindentCode(code);
					result.examples.push({ title, lang, code: reindented });
				} else {
					result.examples.push({ title: "", lang: "ts", code: raw });
				}
				break;
			}
			case "seeAlso":
				result.seeAlso = comment
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);
				break;
			case "optionsType":
				result.optionsType = comment.trim();
				break;
			case "option": {
				// Format: "property | type | default | description"
				const parts = comment.split("|").map((s) => s.trim());
				if (parts.length >= 4) {
					result.optionsRows = result.optionsRows || [];
					result.optionsRows.push({
						property: parts[0],
						type: parts[1],
						default: parts[2],
						description: parts[3],
					});
				}
				break;
			}
			case "returnsTable":
				// Lines of "method | signature | description"
				for (const line of comment.split("\n")) {
					const parts = line.split("|").map((s) => s.trim());
					if (parts.length >= 3) {
						result.returnsTable.push({
							method: parts[0],
							signature: parts[1],
							description: parts[2],
						});
					}
				}
				break;
			case "category":
				result.category = comment.trim();
				break;
		}
	}

	return result;
}

// ─── Signature extraction ───────────────────────────────────────────────────

function getSignatureText(node, source) {
	// For overloaded functions, we want the overload signatures (no body)
	// For non-overloaded, we want the declaration minus the body
	const start = node.getStart();
	const bodyStart = node.body ? node.body.getStart() : node.getEnd();
	let sig = source.substring(start, bodyStart).trim();
	// Remove 'export ' prefix
	sig = sig.replace(/^export\s+/, "");
	// Remove trailing '{'
	sig = sig.replace(/\s*\{?\s*$/, "");
	return sig;
}

function getOverloadSignatures(overloads, source) {
	return overloads.map((o) => {
		let sig = source.substring(o.getStart(), o.getEnd()).trim();
		sig = sig.replace(/^export\s+/, "");
		sig = sig.replace(/;$/, "");
		return sig;
	});
}

// ─── Parameter table from function params ───────────────────────────────────

function extractParams(node, jsdocParams, source) {
	const params = [];
	if (!node.parameters) return params;

	for (const p of node.parameters) {
		const name = p.name.getText();
		if (name === "...ops") continue; // skip rest params for display

		const typeText = p.type ? source.substring(p.type.getStart(), p.type.getEnd()) : "unknown";
		const isOptional = !!p.questionToken || !!p.initializer;

		// Find matching JSDoc @param
		const jsdoc = jsdocParams.find((jp) => jp.name === name);
		const description = jsdoc?.description || "";

		params.push({
			name: isOptional ? name : name,
			type: typeText,
			description,
			optional: isOptional,
		});
	}

	return params;
}

// ─── Markdown helpers ───────────────────────────────────────────────────────

/**
 * Escape angle brackets for VitePress/Vue markdown.
 * Inside code fences (```), angle brackets are safe.
 * In tables and inline text, `<T>` gets parsed as an HTML tag even inside backticks.
 * Replace < and > with HTML entities when used in table cells.
 */
function escapeVue(str) {
	return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Markdown generation ────────────────────────────────────────────────────

function generateMarkdown(name, data) {
	const lines = [];

	// Title
	lines.push(`# ${name}()`);
	lines.push("");

	// Description
	if (data.description) {
		lines.push(escapeVue(data.description));
		lines.push("");
	}

	// Signature
	lines.push("## Signature");
	lines.push("");
	lines.push("```ts");
	for (const sig of data.signatures) {
		lines.push(sig);
	}
	lines.push("```");
	lines.push("");

	// Namespace functions (e.g., derived.from)
	if (data.namespaceFns && data.namespaceFns.length > 0) {
		for (const ns of data.namespaceFns) {
			lines.push(`### ${ns.title}`);
			lines.push("");
			lines.push("```ts");
			lines.push(ns.signature);
			lines.push("```");
			lines.push("");
			if (ns.description) {
				lines.push(ns.description);
				lines.push("");
			}
		}
	}

	// Parameters
	if (data.params.length > 0) {
		lines.push("## Parameters");
		lines.push("");
		lines.push("| Parameter | Type | Description |");
		lines.push("|-----------|------|-------------|");
		for (const p of data.params) {
			const typeStr = `\`${escapeVue(p.type)}\``;
			lines.push(`| \`${escapeVue(p.name)}\` | ${typeStr} | ${escapeVue(p.description)} |`);
		}
		lines.push("");
	}

	// Options type expansion (manual section from @optionsType)
	if (data.optionsRows && data.optionsRows.length > 0) {
		lines.push(`### ${data.optionsTypeName}`);
		lines.push("");
		lines.push("| Property | Type | Default | Description |");
		lines.push("|----------|------|---------|-------------|");
		for (const row of data.optionsRows) {
			lines.push(
				`| \`${escapeVue(row.property)}\` | \`${escapeVue(row.type)}\` | \`${escapeVue(row.default)}\` | ${escapeVue(row.description)} |`,
			);
		}
		lines.push("");
	}

	// Returns
	if (data.returns) {
		lines.push("## Returns");
		lines.push("");
		lines.push(escapeVue(data.returns));
		lines.push("");
	}

	// Returns table (method signatures)
	if (data.returnsTable && data.returnsTable.length > 0) {
		lines.push("| Method | Signature | Description |");
		lines.push("|--------|-----------|-------------|");
		for (const row of data.returnsTable) {
			lines.push(
				`| \`${escapeVue(row.method)}\` | \`${escapeVue(row.signature)}\` | ${escapeVue(row.description)} |`,
			);
		}
		lines.push("");
	}

	// Basic Usage (first example)
	if (data.examples.length > 0) {
		const first = data.examples[0];
		lines.push("## Basic Usage");
		lines.push("");
		lines.push(`\`\`\`${first.lang}`);
		lines.push(first.code);
		lines.push("```");
		lines.push("");
	}

	// Behavior details
	if (data.remarks.length > 0) {
		lines.push("## Options / Behavior Details");
		lines.push("");
		for (const r of data.remarks) {
			lines.push(`- ${r}`);
		}
		lines.push("");
	}

	// Additional examples (each must have a title)
	if (data.examples.length > 1) {
		lines.push("## Examples");
		lines.push("");
		for (let i = 1; i < data.examples.length; i++) {
			const ex = data.examples[i];
			const title = ex.title || `Example ${i + 1}`;
			lines.push(`### ${title}`);
			lines.push("");
			lines.push(`\`\`\`${ex.lang}`);
			lines.push(ex.code);
			lines.push("```");
			lines.push("");
		}
	}

	// See Also
	if (data.seeAlso.length > 0) {
		lines.push("## See Also");
		lines.push("");
		for (const link of data.seeAlso) {
			lines.push(`- ${link}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ─── Main pipeline ──────────────────────────────────────────────────────────

function processFunction(name, filePath) {
	const { sourceFile, source } = parseSource(filePath);
	const { implementation, overloads } = findExportedFunction(sourceFile, name);

	// The JSDoc is on the implementation (or the first overload if no impl JSDoc)
	const primaryNode = implementation || overloads[overloads.length - 1];
	if (!primaryNode) {
		console.error(`  ⚠ No exported function '${name}' found in ${filePath}`);
		return null;
	}

	const jsDoc = getJSDoc(primaryNode);
	const jsdocData = extractJSDocData(jsDoc);

	// Build signatures
	let signatures;
	if (overloads.length > 0) {
		// Use overload signatures (skip the implementation signature)
		signatures = getOverloadSignatures(overloads, source);
	} else {
		signatures = [getSignatureText(primaryNode, source)];
	}

	// Extract params from the implementation (or last overload)
	const paramNode = implementation || overloads[overloads.length - 1];
	const params = extractParams(paramNode, jsdocData.params ?? [], source);

	// Check for namespace (e.g., derived.from)
	const namespaceFns = [];
	const ns = findNamespace(sourceFile, name);
	if (ns?.body && ts.isModuleBlock(ns.body)) {
		for (const stmt of ns.body.statements) {
			if (ts.isFunctionDeclaration(stmt) && stmt.name) {
				const nsName = stmt.name.text;
				const nsJsDoc = getJSDoc(stmt);
				const nsData = extractJSDocData(nsJsDoc);
				const nsSig = getSignatureText(stmt, source);
				namespaceFns.push({
					title: `${name}.${nsName}`,
					signature: `${name}.${nsName}${nsSig.replace(/^function\s+\w+/, "")}`,
					description: nsData.description,
				});
			}
		}
	}

	// Parse @returnsTable from JSDoc
	const returnsTable = jsdocData.returnsTable;

	const optionsRows = jsdocData.optionsRows || [];
	const optionsTypeName = jsdocData.optionsType;

	return {
		name,
		description: jsdocData.description,
		signatures,
		params,
		returns: jsdocData.returns,
		returnsTable,
		remarks: jsdocData.remarks,
		examples: jsdocData.examples,
		seeAlso: jsdocData.seeAlso,
		namespaceFns,
		optionsRows,
		optionsTypeName,
	};
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const checkMode = args.includes("--check");
const targets = args.filter((a) => !a.startsWith("--"));

const entries =
	targets.length > 0
		? targets.map((t) => [t, REGISTRY[t]]).filter(([, v]) => v)
		: Object.entries(REGISTRY);

let stale = 0;

for (const [name, filePath] of entries) {
	const data = processFunction(name, filePath);
	if (!data) continue;

	const md = generateMarkdown(name, data);
	const outPath = resolve(SITE_API, `${name}.md`);

	if (checkMode) {
		if (existsSync(outPath)) {
			const existing = readFileSync(outPath, "utf-8");
			if (existing !== md) {
				console.log(`  ⚠ ${name}.md is stale`);
				stale++;
			} else {
				console.log(`  ✓ ${name}.md is up to date`);
			}
		} else {
			console.log(`  ⚠ ${name}.md does not exist`);
			stale++;
		}
	} else {
		writeFileSync(outPath, md);
		console.log(`  ✓ wrote ${name}.md`);
	}
}

if (checkMode && stale > 0) {
	console.log(`\n${stale} file(s) stale. Run 'node scripts/gen-api-docs.mjs' to regenerate.`);
	process.exit(1);
}
