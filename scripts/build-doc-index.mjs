#!/usr/bin/env node

// ---------------------------------------------------------------------------
// build-doc-index.mjs — Build-time FTS5 doc index for docIndex runtime
// ---------------------------------------------------------------------------
// Produces a wa-sqlite-compatible .db file with trigram FTS5 index over:
//   1. llms-full.txt — split by ## headings
//   2. examples/*.ts — each file as one chunk
//   3. site/recipes/*.md — each recipe, frontmatter stripped
//   4. JSDoc from src/ai/, src/patterns/, src/adapters/, src/orchestrate/, src/memory/
//
// Usage:
//   node scripts/build-doc-index.mjs
//   node scripts/build-doc-index.mjs --dry-run   # print stats, don't write
//
// Output: site/.vitepress/public/docs-index.db
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Input paths ────────────────────────────────────────────────────────────

const LLMS_FULL = resolve(ROOT, "llms-full.txt");
const EXAMPLES_DIR = resolve(ROOT, "examples");
const RECIPES_DIR = resolve(ROOT, "site/recipes");
const JSDOC_DIRS = ["src/ai", "src/patterns", "src/adapters", "src/orchestrate", "src/memory"];
const OUT_PATH = resolve(ROOT, "site/.vitepress/public/docs-index.db");

// ─── Chunkers ───────────────────────────────────────────────────────────────

/**
 * Split llms-full.txt by ## headings into chunks.
 * Each section becomes one searchable document.
 */
function parseLlmsFullTxt(path) {
	const text = readFileSync(path, "utf-8");
	const chunks = [];
	// Split on lines starting with "## "
	const sections = text.split(/^(?=## )/m);

	for (const section of sections) {
		if (!section.startsWith("## ")) continue; // skip preamble before first ##
		const newlineIdx = section.indexOf("\n");
		const heading = newlineIdx >= 0 ? section.slice(3, newlineIdx).trim() : section.slice(3).trim();
		const body = newlineIdx >= 0 ? section.slice(newlineIdx + 1).trim() : "";
		if (!body) continue;

		const slug = heading
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");

		chunks.push({
			title: heading,
			body,
			tags: "api",
			source: `llms-full:${slug}`,
		});
	}

	return chunks;
}

/**
 * Each examples/*.ts file becomes one chunk, tagged with filename.
 */
function parseExamples(dir) {
	if (!existsSync(dir)) return [];
	const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
	return files.map((f) => {
		const body = readFileSync(resolve(dir, f), "utf-8");
		const name = basename(f, ".ts");
		return {
			title: name,
			body,
			tags: "example",
			source: `examples/${f}`,
		};
	});
}

/**
 * Each site/recipes/*.md file becomes one chunk.
 * VitePress frontmatter (--- ... ---) is stripped.
 */
function parseRecipes(dir) {
	if (!existsSync(dir)) return [];
	const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "index.md");
	return files.map((f) => {
		let text = readFileSync(resolve(dir, f), "utf-8");
		// Strip frontmatter
		text = text.replace(/^---[\s\S]*?---\n*/, "");
		// Extract title from first # heading
		const titleMatch = text.match(/^#\s+(.+)/m);
		const title = titleMatch ? titleMatch[1].trim() : basename(f, ".md");
		return {
			title,
			body: text,
			tags: "recipe",
			source: `recipes/${f}`,
		};
	});
}

/**
 * Extract JSDoc blocks preceding `export function` declarations.
 * Lightweight regex approach — no TypeDoc needed.
 */
function extractJSDoc(dirs) {
	const chunks = [];

	for (const dir of dirs) {
		const absDir = resolve(ROOT, dir);
		if (!existsSync(absDir)) continue;
		const folder = dir.replace(/^src\//, "");

		walkDir(absDir, (filePath) => {
			if (!filePath.endsWith(".ts") || filePath.endsWith(".test.ts") || filePath.endsWith(".d.ts"))
				return;

			const content = readFileSync(filePath, "utf-8");
			const re = /\/\*\*([\s\S]*?)\*\/\s*export\s+function\s+(\w+)/g;

			for (const match of content.matchAll(re)) {
				const rawDoc = match[1];
				const funcName = match[2];

				// Clean JSDoc: strip leading whitespace + * from each line
				const body = rawDoc
					.split("\n")
					.map((line) => line.replace(/^\s*\*\s?/, ""))
					.join("\n")
					.trim();

				// Skip trivial/internal docs
				if (body.length < 20) continue;
				if (body.startsWith("@internal")) continue;

				const relPath = filePath.slice(ROOT.length + 1);
				chunks.push({
					title: `${funcName} (${folder})`,
					body,
					tags: `jsdoc,${folder}`,
					source: relPath,
				});
			}
		});
	}

	return chunks;
}

/** Recursively walk a directory, calling fn(filePath) for each file. */
function walkDir(dir, fn) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = resolve(dir, entry.name);
		if (entry.isDirectory()) {
			walkDir(fullPath, fn);
		} else {
			fn(fullPath);
		}
	}
}

// ─── Build FTS5 database ────────────────────────────────────────────────────

function buildFTS5(chunks, outPath) {
	mkdirSync(dirname(outPath), { recursive: true });
	if (existsSync(outPath)) unlinkSync(outPath);

	const db = new Database(outPath);

	try {
		// Schema matches roadmap spec: fts5(title, body, tags, source, tokenize='trigram')
		// Column indices: 0=title, 1=body, 2=tags, 3=source
		// Runtime query uses: snippet(docs, 1, ...) for body excerpts, rowid as id
		db.exec(`CREATE VIRTUAL TABLE docs USING fts5(title, body, tags, source, tokenize='trigram')`);

		const insert = db.prepare("INSERT INTO docs (title, body, tags, source) VALUES (?, ?, ?, ?)");

		const insertAll = db.transaction((chunks) => {
			for (const chunk of chunks) {
				insert.run(chunk.title, chunk.body, chunk.tags, chunk.source);
			}
		});

		insertAll(chunks);

		// Optimize the FTS5 index for read performance
		db.exec("INSERT INTO docs(docs) VALUES('optimize')");
	} finally {
		db.close();
	}
}

// ─── Main ───────────────────────────────────────────────────────────────────

const dryRun = process.argv.includes("--dry-run");

if (!existsSync(LLMS_FULL)) {
	console.error(`Error: ${LLMS_FULL} not found. Generate it first.`);
	process.exit(1);
}

const llmsChunks = parseLlmsFullTxt(LLMS_FULL);
const exampleChunks = parseExamples(EXAMPLES_DIR);
const recipeChunks = parseRecipes(RECIPES_DIR);
const jsdocChunks = extractJSDoc(JSDOC_DIRS);
const allChunks = [...llmsChunks, ...exampleChunks, ...recipeChunks, ...jsdocChunks];

console.log(`Collected ${allChunks.length} chunks:`);
console.log(`  llms-full.txt: ${llmsChunks.length} sections`);
console.log(`  examples:      ${exampleChunks.length} files`);
console.log(`  recipes:       ${recipeChunks.length} pages`);
console.log(`  jsdoc:         ${jsdocChunks.length} functions`);

if (dryRun) {
	console.log("\n--dry-run: skipping DB write.");
	process.exit(0);
}

buildFTS5(allChunks, OUT_PATH);

const size = statSync(OUT_PATH).size;
console.log(`\nWrote ${OUT_PATH}`);
console.log(`Size: ${(size / 1024).toFixed(1)} KB`);
