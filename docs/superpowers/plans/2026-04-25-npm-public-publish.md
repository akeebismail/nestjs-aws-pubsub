# Public npm release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `nestjs-aws-pubsub` (or an approved scoped/renamed package) to **registry.npmjs.org** so it satisfies S1–S4 in `docs/superpowers/specs/2026-04-25-npm-public-publish-design.md`—especially a tarball that **includes `dist/**`** and a post-publish smoke install.

**Architecture:** Single repo, **no code feature work**; packaging + verification gates (`npm view` → fix `.npmignore` → `npm pack` inspect → `npm publish` → temp-dir smoke test). If the unscoped name is taken, re-run the **Task 3a alternate** (scoped + `publishConfig`) **before** publish.

**Tech stack:** npm CLI, `tar`/`tar -tf` (or `bsdtar`) on macOS, Node.js.

**Primary spec:** `docs/superpowers/specs/2026-04-25-npm-public-publish-design.md`

---

## File map (touch)

| Path | Action |
|------|--------|
| `/.npmignore` | **Modify** — remove rules that ignore `dist/` and `build/` (spec §2.1, S3). |
| `package.json` | **Optionally** bump `version`; **conditionally** add `name` + `publishConfig` if using scoped name (Task 3a). |
| `package-lock.json` | **Optionally** update with `npm install` if `version` in `package.json` changes. |
| `docs/superpowers/specs/2026-04-25-npm-public-publish-design.md` | **Read only** (requirements). |

**Do not** commit `~/.npmrc` with tokens. **Do not** add GitHub Actions in this plan (spec out of scope).

---

### Task 1: Name availability (`npm view`)

**Spec:** §3.1, S1 prerequisite.

**Files:** none (commands only)

- [ ] **Step 1: From the repo root** (`/Users/akeebismail/works/kibb/packages/nest-sqs-event` or your clone), run:

```bash
cd /path/to/nest-sqs-event
npm view nestjs-aws-pubsub 2>&1
```

- [ ] **Step 2: Interpret the result**

  - If you see `404` / “Not found” / no `version` field: **unscoped `nestjs-aws-pubsub` is likely free** for first publish → continue with **Task 2**.
  - If you see a `version` (e.g. `"0.0.1"`): the name is **taken** by someone else. **Do not** publish. Either:
    - (a) Request access from the owner, **or**
    - (b) **Switch to Task 3a** (scoped package) and pick an org you control on npm (e.g. `@your-org/nestjs-aws-pubsub`).

- [ ] **Step 3: (no commit)** Record the outcome in your release notes (one line).

---

### Task 2: Fix `.npmignore` so `dist` ships

**Spec:** §2.1, S3, S2.

**Files:**

- Modify: `/.npmignore` (path from repo root: `nest-sqs-event/.npmignore`)

- [ ] **Step 1: Open** `.npmignore` and **delete** these two lines (and the blank line between the comment and the next block if you prefer, but keep the `# Build artifacts` comment optional):

```gitignore
dist/
build/
```

**Keep** the `# Build artifacts` **comment** or replace the whole “Build artifacts” block with a single **comment** line that documents why `dist` is *not* listed:

```gitignore
# dist/ is NOT ignored: package.json "files" ships dist; ignoring dist would break the published tarball.
```

- [ ] **Step 2: Remove redundant risk** — the line `*.ts` in `.npmignore` does not affect `dist/**/*.js`, but to avoid any edge-case, **leave it** unless `npm pack` in Task 4 still omits `dist` (if so, remove `*.ts` and re-pack).

- [ ] **Step 3: Commit**

```bash
git add .npmignore
git commit -m "chore: stop ignoring dist/ in .npmignore for npm publish (spec 2.1)"
```

---

### Task 3a (conditional): Scoped package if unscoped is unavailable

**Spec:** §3.2 — only if Task 1 found an existing `nestjs-aws-pubsub` you do **not** own.

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Set `name` and `publishConfig`**

  Replace the top-level `"name": "nestjs-aws-pubsub"` with your scoped name, e.g.:

```json
  "name": "@YOUR_ORG/nestjs-aws-pubsub",
  "publishConfig": {
    "access": "public"
  },
```

(Replace `YOUR_ORG` with the npm org — create the org on [npmjs.com](https://www.npmjs.com) if required.)

- [ ] **Step 2: Reconcile lockfile (if you use it)**

```bash
npm install
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: use scoped package name for npm publish"
```

- [ ] **Step 4: Use the scoped name** in all later tasks instead of `nestjs-aws-pubsub` (e.g. `npm view @YOUR_ORG/nestjs-aws-pubsub`).

**If** Task 1 was clear, **skip** Task 3a entirely.

---

### Task 4: Green test, build, and `npm pack` inspection

**Spec:** §5 steps 1–3 and 5; S2, S3, S4.

**Files:** none (commands; `dist` generated, not usually committed if gitignored)

- [ ] **Step 1: Install and verify**

```bash
cd /path/to/nest-sqs-event
npm install
npm test
npm run build
```

**Expected:** `npm test` exits `0`, and `ls dist/index.js dist/index.d.ts` shows both files exist (paths per `tsconfig` `outDir: ./dist` and `include: lib/**`).

- [ ] **Step 2: Pack and list tarball contents (macOS / BSD `tar`)**

```bash
npm pack
# Creates e.g. nestjs-aws-pubsub-0.0.1.tgz in cwd (or @scope-name-version.tgz for scoped)
tar -tf nestjs-aws-pubsub-0.0.1.tgz | head -40
```

If your `package.json` `name` is scoped, the filename is like `your-org-nestjs-aws-pubsub-0.0.1.tgz` (npm normalizes the `/`). Use `ls *.tgz` to get the exact filename, then `tar -tf <that-file>`.

- [ ] **Step 3: Grep the listing for `dist`**

```bash
tar -tf …your.tgz… | grep 'package/dist' | head -20
```

**Required:** you must see `package/dist/index.js` and `package/dist/index.d.ts` (and ideally `.js.map` if built).

- [ ] **Step 4: Failure path**

  If `package/dist` is **missing** or empty, **do not** publish. Re-check **Task 2**, `package.json` `files` array, and re-run `npm run build` before packing again.

- [ ] **Step 5: Delete the test tarball (optional, avoids clutter)**

```bash
rm -f *.tgz
```

- [ ] **Step 6:** (no commit unless you changed source).

---

### Task 5: Version in `package.json` (if not already set)

**Spec:** §4.

**Files:**

- Modify: `package.json` (and `package-lock.json` if present)

- [ ] **Step 1:** If you are publishing the **first** time at **`0.0.1`**, ensure `"version": "0.0.1"` in `package.json` matches the artifact you want (no change if already `0.0.1`).

- [ ] **Step 2:** If you need **bump** (e.g. a prior `0.0.1` already exists on npm for your name), set to **`0.0.2`**, `0.1.0`, etc.:

```bash
# Option A: npm version (creates a git tag if a git repo — review before pushing)
npm version patch --no-git-tag-version
# or: npm version 0.1.0 --no-git-tag-version
```

Then:

```bash
npm install
```

- [ ] **Step 3: Commit** if `version` changed

```bash
git add package.json package-lock.json
git commit -m "chore: bump version for npm release"
```

---

### Task 6: Login and publish (human step)

**Spec:** §5 steps 6–8; §5.1 (2FA)

**Files:** none

- [ ] **Step 1: Who am I?**

```bash
npm whoami
```

**Expected:** your npm username. If it fails, `npm login` in this terminal, complete **OTP/2FA** in the browser, then re-run `npm whoami`.

- [ ] **Step 2: Publish (from clean tree with committed `.npmignore` and intended `version`)**

`prepublishOnly` will run `npm run build` automatically. Ensure you are in the **correct** package directory and not at monorepo root (this repo is the **package** root).

**Unscoped:**

```bash
npm publish
```

**Scoped (after Task 3a):**

```bash
npm publish --access public
```

- [ ] **Step 3: Expected** — npm prints the package + version; no error about missing files. If `403` / name collision, re-read **Task 1** and **3a**; if `OT`, complete 2FA.

- [ ] **Step 4: Do not** commit the resulting pack file if generated; clean `rm -f *.tgz` if any.

**Note:** You cannot automate OTP in the plan; the human runs this step.

---

### Task 7: Post-publish registry check (S1)

**Spec:** S1, §1.2

**Files:** none

- [ ] **Step 1: Verify version on the registry** (unscoped)

```bash
npm view nestjs-aws-pubsub version
```

Or scoped:

```bash
npm view @YOUR_ORG/nestjs-aws-pubsub version
```

**Expected:** prints the same version you published in Task 6 (e.g. `0.0.1`).

---

### Task 8: Smoke install in a **fresh** temp directory (S2)

**Spec:** S1 design §1.2 S2, spec §5 step 9

**Files:** new temp dir only (anywhere **outside** the git repo; delete after)

- [ ] **Step 1: Create temp and install the published package**

```bash
mkdir -p /tmp/nestjs-pubsub-smoke && cd /tmp/nestjs-pubsub-smoke
npm init -y
npm install nestjs-aws-pubsub@0.0.1
```

(Use your **exact** `name@version` string if scoped: `npm install @YOUR_ORG/nestjs-aws-pubsub@0.0.1`.)

- [ ] **Step 2: Verify `dist` exists under `node_modules`**

```bash
ls node_modules/nestjs-aws-pubsub/dist/index.js node_modules/nestjs-aws-pubsub/dist/index.d.ts
```

(For scoped, path is `node_modules/@YOUR_ORG/nestjs-aws-pubsub/dist/...`.)

- [ ] **Step 3: (optional) one-line ESM resolution check**

```bash
node -e "require('nestjs-aws-pubsub'); console.log('ok')"
```

If scoped, use:

```bash
node -e "require('@YOUR_ORG/nestjs-aws-pubsub'); console.log('ok')"
```

**Expected:** prints `ok` with no `MODULE_NOT_FOUND` for the package’s main entry (may still warn if a peer is missing; installing Nest peers is **not** required to pass the **tarball** presence check in S2).

- [ ] **Step 4:** Remove the temp directory when done.

```bash
rm -rf /tmp/nestjs-pubsub-smoke
```

---

### Task 9: Document consumer `dependencies` in README (optional, spec §6)

**Spec:** §6

**Files:**

- Modify: `README.md` (e.g. add a **“Install from npm”** subsection at the top of **Installation**)

- [ ] **Step 1:** Add one fenced block, using the **published** `name@version` you actually used:

```markdown
### Install from npm

\`\`\`bash
npm install nestjs-aws-pubsub@0.0.1
\`\`\`
```

(For scoped, use the scoped install line.)

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add npm install line for published package"
```

---

## Plan self-review (vs spec)

| Spec section / criterion | Plan tasks |
|----------------------------|------------|
| S1 | Task 6, 7 |
| S2 | Task 8 |
| S3 | Task 2, 4 |
| S4 | `prepublishOnly` in `package.json` (existing) + Task 4 `npm run build` before confidence |
| §2.1 `.npmignore` | Task 2 |
| §3 name / scoped | Task 1, 3a |
| §4 version | Task 5 |
| §5.1 2FA | Task 6 (narrated) |
| §6 consumer snippet | Task 9 (optional) |
| **Placeholder scan** | None — all steps use exact paths, commands, or explicit branch labels. |
| **Scope** | No CI, no new library features (matches spec out of scope). |

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-04-25-npm-public-publish.md`. Two execution options:

**1. Subagent-Driven (recommended):** a fresh subagent per task, review between tasks, fast iteration. **REQUIRED SUB-SKILL:** `superpowers:subagent-driven-development` (or project equivalent).

**2. Inline execution:** work through the checklists in this session in order (Tasks 1 → 2 → 4 → 5 → 6–8 → optional 9), with a checkpoint after **Task 4** (pack) and before **Task 6** (publish).

**Which approach do you want?**

---

## Manual execution note (single maintainer)

You can run **Task 1 → 2 → 4 → 5** without publishing; only **Task 6+** need npm credentials and a live registry write.
