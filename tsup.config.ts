import { defineConfig } from "tsup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/extra/index.ts",
		"src/extra/interval.ts",
		"src/extra/fromIter.ts",
		"src/extra/fromEvent.ts",
		"src/extra/fromPromise.ts",
		"src/extra/fromObs.ts",
		"src/extra/take.ts",
		"src/extra/skip.ts",
		"src/extra/merge.ts",
		"src/extra/combine.ts",
		"src/extra/concat.ts",
		"src/extra/flat.ts",
		"src/extra/forEach.ts",
		"src/extra/share.ts",
		"src/extra/map.ts",
		"src/extra/filter.ts",
		"src/extra/scan.ts",
	],
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	minify: true,
	sourcemap: true,
});
