# Contributing

## Setup

```bash
corepack enable   # once per machine
pnpm install      # or: mise run bootstrap
```

Node version: **24** (see `.node-version`). CI and Release use that only. Package manager: **pnpm 10** (pinned via `packageManager` in `package.json`).

## Scripts (root)

| Command | Purpose |
| ------- | ------- |
| `pnpm run build` | Library build (`dist/`) |
| `pnpm test` | Vitest |
| `pnpm run lint` | Biome check |
| `pnpm run docs:dev` | VitePress dev (`site/`) |

## Commit messages (releases)

Releases on `main` use **semantic-release** with an **Angular-style** analyzer. Use lowercase types and a colon:

| Intent | Example |
| ------ | ------- |
| New feature | `feat: add windowCount operator` |
| Bug fix | `fix: correct diamond settle order` |
| Performance | `perf: skip bitmask for single dep` |
| Docs only | `docs: clarify batch semantics` |
| Refactor | `refactor: extract shared sink helper` |
| Tests | `test: cover operator teardown` |
| Chore / CI | `chore: update workflow cache` |
| Style / format | `style: biome format` |
| Breaking change | `feat!: rename Store.subscribe` or footer `BREAKING CHANGE: ...` |
| Optional scope | `feat(core): batch flush hook` |

**Patch releases** from this repo also treat **`docs`**, **`refactor`**, and **`perf`** as releasable (see `release.config.mjs`). **`chore`**, **`test`**, **`style`** do not bump the version unless breaking.

**Maintainers — one-time Actions setup:** [docs/github-actions-release-setup.md](./github-actions-release-setup.md) — **npm Trusted Publishing (OIDC)** + **GitHub App** (`RELEASE_APP_ID`, `RELEASE_APP_PRIVATE_KEY`); no publish token.
