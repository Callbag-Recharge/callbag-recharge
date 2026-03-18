import { defineConfig } from "vitest/config";

export default defineConfig({
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
