/**
 * @type {import('semantic-release').GlobalConfig}
 */
export default {
	branches: ["main"],
	repositoryUrl: "https://github.com/Callbag-Recharge/callbag-recharge.git",
	tagFormat: "v${version}",
	plugins: [
		[
			"@semantic-release/commit-analyzer",
			{
				preset: "angular",
				releaseRules: [
					{ type: "docs", release: "patch" },
					{ type: "refactor", release: "patch" },
					{ type: "perf", release: "patch" },
				],
				parserOpts: {
					noteKeywords: ["BREAKING CHANGE", "BREAKING CHANGES"],
				},
			},
		],
		[
			"@semantic-release/release-notes-generator",
			{
				preset: "angular",
				writerOpts: { commitsSort: ["scope", "subject"] },
			},
		],
		["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }],
		["@semantic-release/npm", { npmPublish: true }],
		"@semantic-release/github",
		[
			"@semantic-release/git",
			{
				assets: ["CHANGELOG.md", "package.json", "pnpm-lock.yaml"],
				message:
					"chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
			},
		],
	],
};
