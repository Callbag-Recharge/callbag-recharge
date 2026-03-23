import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			// Catch-all: callbag-recharge/foo/bar → src/foo/bar.ts (or src/foo/bar/index.ts)
			// Specific subpaths must come before the catch-all
			{ find: /^callbag-recharge\/(.+)$/, replacement: path.resolve(__dirname, "src/$1") },
			{ find: "callbag-recharge", replacement: path.resolve(__dirname, "src/index.ts") },
		],
	},
	test: {
		include: ["src/**/*.test.ts"],
		exclude: ["**/node_modules/**", "dist/**", "**/*.bench.ts"],
		environment: "node",
	},
	benchmark: {
		include: ["src/__bench__/**/*.bench.ts"],
		environment: "node",
	},
});
