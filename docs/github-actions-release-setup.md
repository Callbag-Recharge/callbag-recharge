# GitHub Actions: npm publish & semantic-release

One-time maintainer setup so **Release** (and CI) work on `main`.

## 1. Node version

CI and Release use **`.node-version`** (currently **24**). No matrix of older Node versions.

---

## 2. NPM_TOKEN (required to publish)

semantic-release publishes with **`npm`**; the registry needs an automation token.

### Create the token (npmjs.com)

1. Log in at [npmjs.com](https://www.npmjs.com).
2. Avatar → **Access Tokens** (or [npmjs.com/settings/~/tokens](https://www.npmjs.com/settings/~/tokens)).
3. **Generate New Token** → choose **Granular Access Token** (recommended) or **Classic**:
   - **Granular:** type *Automation*, package *callbag-recharge* (or your scope), permission **Read and write**.
   - **Classic:** type *Automation* (works with 2FA on publish).
4. Copy the token once (it won’t be shown again).

### Add to GitHub

1. Repo → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret** → name **`NPM_TOKEN`**, value = pasted token.

`NODE_AUTH_TOKEN` in the workflow is set from the same secret for `setup-node` registry auth.

### npm package access

The npm user that owns the token must have **publish rights** on `callbag-recharge` (owner or maintainer on npm).

---

## 3. Pushing to `main` (@semantic-release/git)

semantic-release commits **CHANGELOG.md**, **package.json**, and **pnpm-lock.yaml** and pushes to `main`. The default **`GITHUB_TOKEN`** often **cannot push** if `main` is **branch-protected**.

Pick **one** approach.

### Option A — Allow GitHub Actions (simplest)

1. Repo → **Settings** → **Rules** → **Rulesets** (or **Branches**).
2. Edit the rule protecting `main`.
3. Under **Bypass list**, add **Repository admin** or explicitly allow **GitHub Actions** (wording varies by UI version).
4. Ensure the **Release** workflow’s actor can push (sometimes “Allow specified actors to bypass” includes `github-actions[bot]`).

No extra secrets.

### Option B — Personal Access Token (PAT)

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens**.
2. **Fine-grained**: resource = this repo, permissions **Contents: Read and write** (and **Metadata: Read**).
   Or **Classic**: scope **`repo`**.
3. Repo → **Actions** secrets → **`SEMANTIC_RELEASE_GITHUB_TOKEN`** = the PAT.

The Release workflow uses:

`secrets.SEMANTIC_RELEASE_GITHUB_TOKEN || secrets.GITHUB_TOKEN`

So if the PAT secret exists, pushes and GitHub API use it; otherwise the default Actions token is used.

**Rotate the PAT** before expiry; update the secret.

---

## 4. GitHub App (optional, instead of PAT)

Use a **GitHub App** when org policy prefers apps over long-lived PATs.

### Create the app

1. GitHub (org or user) → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**.
2. **GitHub App name:** e.g. `callbag-recharge-release`.
3. **Webhook:** inactive (uncheck active) unless you need it.
4. **Permissions → Repository:**
   - **Contents:** Read and write  
   - **Metadata:** Read  
   - **Issues** / **Pull requests:** Read & write (semantic-release may comment on released issues/PRs).
5. **Where can this GitHub App be installed?** — Only on this account/org, or any account (your choice).
6. Create app → note **App ID** (numeric).
7. **Generate a private key** → download the `.pem` file. Paste the full PEM into a secret (newlines are fine; the action normalizes them).

### Install the app

1. App page → **Install App** → select org/user → **Only select repositories** → choose **`callbag-recharge`**.

### Wire into Actions

1. Repo → **Settings** → **Secrets and variables** → **Actions**:
   - **`RELEASE_APP_ID`** = App ID (numeric string). You may use a **variable** instead if you prefer it non-secret.
   - **`RELEASE_APP_PRIVATE_KEY`** = full `.pem` text (including `-----BEGIN … PRIVATE KEY-----` lines).

2. **Variables** → **Actions** → **New repository variable**:
   - Name **`SEMANTIC_RELEASE_USE_GITHUB_APP`**, value **`true`**.

The Release workflow runs `actions/create-github-app-token` when that variable is `true`, then sets **`GITHUB_TOKEN`** to the installation token for semantic-release.

To **turn off** the app path: delete the variable or set it to anything other than `true` (then PAT or default token applies).

### App vs PAT

Do **not** set **`SEMANTIC_RELEASE_USE_GITHUB_APP=true`** and rely on **`SEMANTIC_RELEASE_GITHUB_TOKEN`** for the same job in conflicting ways. Prefer **one** of: bypass, PAT only, or App only.

---

## 5. First release / tags

If **`0.1.0`** is already on npm, create a matching tag so semantic-release continues from there:

```bash
git tag v0.1.0 <commit-sha-that-matched-publish>
git push origin v0.1.0
```

Otherwise semantic-release infers from commit history (can jump version if many `feat:` commits exist).

---

## 6. Docs workflow (`git push`)

The **Deploy Docs** job also pushes README / `llms.txt` commits. If that push fails, apply the **same** bypass or PAT/App pattern to that workflow (today it uses default `GITHUB_TOKEN` only). Easiest fix: **branch bypass** for Actions on `main`.

---

## Checklist

| Step | Secret / variable |
|------|-------------------|
| Publish to npm | `NPM_TOKEN` |
| Push protected `main` (PAT) | `SEMANTIC_RELEASE_GITHUB_TOKEN` |
| Push protected `main` (App) | `SEMANTIC_RELEASE_USE_GITHUB_APP=true`, `RELEASE_APP_ID`, `RELEASE_APP_PRIVATE_KEY` |
| Or | Branch rule bypass for `github-actions[bot]` |
