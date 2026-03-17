#!/usr/bin/env node
/**
 * Prints core ESM bundle gzip size in KB (for GHA env/output).
 * Run after `npm run build`. Bundles dist/index.js (entry + chunks) then gzips.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const entry = join(root, "dist", "index.js");

const result = await esbuild.build({
	entryPoints: [entry],
	bundle: true,
	format: "esm",
	minify: true,
	write: false,
	platform: "neutral",
});

const out = result.outputFiles[0];
if (!out) throw new Error("No output from esbuild");
const gzip = gzipSync(out.contents);
const kb = (gzip.length / 1024).toFixed(2);
console.log(kb);
