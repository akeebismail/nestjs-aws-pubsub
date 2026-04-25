# Design: Public npm release — nestjs-aws-pubsub

**Status:** Design  
**Package:** `nestjs-aws-pubsub` (repo: `nest-sqs-event` / `nestjs-aws-pubsub` on GitHub)  
**Date:** 2026-04-25  
**Scope:** First (or next) **public** publish to **registry.npmjs.org** so other projects can `npm install` the package.

---

## 1. Purpose and success criteria

### 1.1 Purpose

Make the library **installable from the public npm registry** for consumers (e.g. Kibb apps or any Node/Nest project), without relying on `file:` or Git `package.json` dependencies for normal workflows.

### 1.2 Success criteria

| # | Criterion |
|---|------------|
| S1 | `npm view <published-name> version` returns the published version. |
| S2 | A **fresh** temp directory can run `npm init -y` and `npm i <published-name>@<version>` with **no 404** and a non-empty `node_modules/<published-name>/` containing **`dist/index.js`** (and `.d.ts` as declared in `package.json`). |
| S3 | The published tarball is verified **before** `npm publish`: tarball lists **`dist/**`** outputs, not an empty or source-only tree. |
| S4 | `prepublishOnly` has run a successful build so the published `dist` matches the tagged release intent. |

### 1.3 Out of scope (this spec)

- Automated **GitHub Actions** release on tag (optional follow-up).  
- New library **features** or API changes (semver policy may reference `0.x` as needed).  
- **Private** npm org billing or **GitHub Packages** (user chose public npm).

---

## 2. Current packaging snapshot (2026-04-25)

| Item | Value |
|------|--------|
| `name` | `nestjs-aws-pubsub` |
| `version` | `0.0.1` (or bump per §4) |
| `main` / `types` | `dist/index.js`, `dist/index.d.ts` |
| `files` | `dist/**/*.js`, `dist/**/*.d.ts`, `dist/**/*.js.map` |
| `prepublishOnly` | `npm run build` |
| `repository` | `https://github.com/akeebismail/nestjs-aws-pubsub.git` |

### 2.1 Critical issue: `.npmignore` vs `dist`

`/.npmignore` **includes** `dist/` and `build/` under “Build artifacts.” npm applies **`files` in `package.json` and `.npmignore` together**; ignore patterns can **exclude** files that would otherwise ship. **Requirement:** before any publish, **remove the `dist/` and `build/` lines** from `.npmignore` (or replace `.npmignore` with a minimal set that does not ignore `dist`), then **confirm** with `npm pack` (§5).

**Secondary:** the pattern `*.ts` in `.npmignore` is redundant if only `files` / `dist` ship, but it must not accidentally interact with published artifacts; the implementation plan will verify the packed tree.

---

## 3. Package name and access (public)

### 3.1 Unscoped

- **Target name:** `nestjs-aws-pubsub` (current `package.json` `name`).  
- **Prerequisite:** the name is **unclaimed** on npm, **or** the maintainer is already a collaborator. Verify with:  
  `npm view nestjs-aws-pubsub`  
  - 404 or empty → typically safe to use for first publish (subject to npm name policy).  
  - Existing version → do **not** publish over it; use patch/minor/major per semver **or** choose a new name.

### 3.2 Scoped alternative (if unscoped is taken or org policy requires it)

- Example: `@kibb/nestjs-aws-pubsub` or `@<org>/nestjs-aws-pubsub`.  
- `package.json` must include:  
  `"publishConfig": { "access": "public" }`  
- First publish: `npm publish --access public` (or rely on `publishConfig`).

**Decision rule:** start with **`npm view nestjs-aws-pubsub`**; document the outcome in the implementation plan. If the name is unavailable, the plan switches to a scoped or renamed package **before** any `npm publish`.

---

## 4. Versioning

- **Default:** keep **`0.0.1`** for first public if this is the first `npm` release and the API matches current `main` / release branch.  
- **Optional:** set **`0.1.0`** to signal a first public “product” line (no API change required by this spec—**maintainer choice**).  
- All future public updates follow **semver** (e.g. fixes → patch, non-breaking features → minor, breaking → major; **0.x** is allowed to move fast per npm convention).

---

## 5. Recommended release approach (checklist, not ad hoc)

Per brainstorming: use **`npm pack`** (or `npm pack --dry-run` where supported) and **inspect the tarball** before `npm publish`.

1. `npm ci` or `npm install` (lockfile consistent if committed).  
2. `npm test` **green**.  
3. `npm run build` → `dist/**` present locally.  
4. Fix **`.npmignore`** so `dist` is not excluded (§2.1).  
5. `npm pack` in repo root; list archive contents and confirm `package/dist/...` includes `.js` / `.d.ts`.  
6. `npm whoami` (logged in, correct org/user for the package name).  
7. `npm version` (optional) or hand-edit `version` in `package.json` + lockfile if used.  
8. `npm publish` for unscoped public (and `--access public` if scoped or if npm prompts).  
9. **Smoke test:** new temp dir, `npm i nestjs-aws-pubsub@<ver>`, import from package entry, TypeScript/Node resolution OK.

### 5.1 Account and security

- **npm** account; **2FA** enabled where npm requires it for publish.  
- **Never** commit `~/.npmrc` tokens; use **environment / CI secret** for future automation.

### 5.2 Errors and rollback

- **Wrong tarball:** catch at step 5; do not publish.  
- **Accidental publish:** `npm unpublish` is **heavily restricted** and often **not** allowed for public packages after a short window; prefer `npm deprecate` and a corrective semver bump. (Document awareness only—no `unpublish` in the default plan.)

---

## 6. Post-publish: consumer `package.json`

```json
"dependencies": {
  "nestjs-aws-pubsub": "^0.0.1"
}
```

(Align version with the published one.)

---

## 7. Implementation handoff

After this spec is **reviewed and approved** by the maintainer, the next step is **writing-plans** for a **single** implementation plan file that contains: exact commands, `.npmignore` diff, `npm pack` inspection steps, and optional `publishConfig` block if scoped. **No `npm publish` in the spec itself**—only in the plan after local verification.

---

## 8. Self-review (spec quality)

- **Placeholders:** Name availability is not assumed; the plan will run `npm view` (explicit).  
- **Consistency:** Success criteria S1–S4 align with §2 packaging and §5 checklist.  
- **Scope:** Single public-first release; CI automation explicitly out of scope.  
- **Ambiguity:** Scoped vs unscoped: **unscoped first**; if blocked, use §3.2.  

---

## Document history

| Version | Date | Note |
|---------|------|------|
| 1.0 | 2026-04-25 | Initial public publish design (brainstorming approval) |
