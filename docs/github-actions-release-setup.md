# GitHub Actions: releases (Trusted Publishing + GitHub App)

This repo publishes **without a long-lived npm token**: **npm Trusted Publishing (OIDC)** from GitHub Actions, and uses a **GitHub App** installation token so semantic-release can push to `main` (changelog, version bump) when branch protection blocks the default `GITHUB_TOKEN`.

CI uses **Node 24** (`.node-version`). The Release workflow must stay named **`release.yml`** — npm’s trusted-publisher config matches that filename exactly.

---

## 1. npm Trusted Publishing (OIDC)

Replaces automation tokens and avoids npm’s warning about token risk for CI. Requires **npm CLI ≥ 11.5.1** and **Node ≥ 22.14** (this repo uses **24**).

### On npmjs.com

1. Open the package → **Settings** (or package admin).
2. **Trusted publishing** → choose **GitHub Actions**.
3. Set:
   - **Organization or user** — e.g. `Callbag-Recharge`
   - **Repository** — e.g. `callbag-recharge`
   - **Workflow filename** — **`release.yml`** (only the filename, with `.yml`; must match [`.github/workflows/release.yml`](../.github/workflows/release.yml)).

Save. npm does **not** validate the link until the first publish.

### Strongly recommended after it works

Under package **Publishing access**, restrict token-based publishes (e.g. disallow write tokens) so only trusted publishing can publish — see [npm: trusted publishers](https://docs.npmjs.com/trusted-publishers).

### Requirements

- **GitHub-hosted runners** (OIDC not supported on self-hosted yet for this path).
- Workflow permission **`id-token: write`** (already set in `release.yml`).
- **`@semantic-release/npm` v13+** + **semantic-release v25+** (OIDC-aware verify/publish).

No **`NPM_TOKEN`** or **`NODE_AUTH_TOKEN`** is set for publish. If you later add **private npm dependencies**, use a **read-only** granular token only for `pnpm install` (see npm docs — not needed for this public repo today).

---

## 2. GitHub App (pushes + GitHub Release)

semantic-release needs a token that can **push** to `main` and talk to the GitHub API. A **GitHub App** installation token is used for that.

### Create the app

1. GitHub → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**.
2. **Name** — e.g. `callbag-recharge-release`.
3. **Webhook** — inactive unless you need it.
4. **Repository permissions:**
   - **Contents:** Read and write  
   - **Metadata:** Read  
   - **Issues** / **Pull requests:** Read and write (for release comments, if enabled).
5. **Where can this GitHub App be installed?** — your org/user.
6. Create the app → note **App ID**.
7. **Generate a private key** (`.pem`).

### Install the app

**Install** on the org/user → **Only select repositories** → **`callbag-recharge`** (or the repo name you use).

### GitHub Actions secrets

Repo → **Settings** → **Secrets and variables** → **Actions**:

| Secret | Value |
|--------|--------|
| **`RELEASE_APP_ID`** | Numeric App ID |
| **`RELEASE_APP_PRIVATE_KEY`** | Full PEM text (`-----BEGIN … PRIVATE KEY-----` …) |

---

## 3. First release / tags

If **`0.1.0`** is already on npm, add a matching tag so semantic-release continues from there:

```bash
git tag v0.1.0 <commit-sha>
git push origin v0.1.0
```

---

## 4. Docs workflow (`git push`)

**Deploy Docs** still uses the default `GITHUB_TOKEN` for README / `llms.txt` commits. If those pushes fail on a protected `main`, either allow **GitHub Actions** to bypass rules for that path or extend the docs job with the same App token pattern as Release.

---

## Checklist

| Item | Done when |
|------|-----------|
| Trusted publisher on npm | `release.yml`, correct org/repo |
| GitHub App installed on repo | Single-repo install |
| **`RELEASE_APP_ID`** + **`RELEASE_APP_PRIVATE_KEY`** | Actions secrets |
| Optional | Restrict npm token publishing after first successful OIDC publish |

---

## Troubleshooting

| Issue | Check |
|-------|--------|
| Publish auth failed | Workflow name on npm is exactly **`release.yml`**; repo/org spelling; `id-token: write`. |
| semantic-release push failed | App has **Contents: write**; app installed on **this** repo. |
| OIDC / exchange errors | Runner is **GitHub-hosted**; Node 24 + global **npm ≥ 11.5.1** (workflow installs it). |
