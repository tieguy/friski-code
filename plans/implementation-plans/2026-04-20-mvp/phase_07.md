# Friski MVP Implementation Plan — Phase 7: CI, Deploy & Round-Trip Verification

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Wire the pieces from Phases 1–6 into an end-to-end flow. Validator and reviewer run automatically on PRs to `frisco-wiki`; merging `frisco-wiki` triggers an automated submodule-bump PR in `friski-code`; merging the bump PR triggers a Netlify build that deploys to `frisco.wiki`. Prove the full round-trip on a post-seed subject+article+capture.

**Architecture:** Six GitHub Actions workflow files split across two repos, plus a Netlify site pointing at `friski-code`'s `main` branch, plus DNS pointing `frisco.wiki` at Netlify. Cross-repo coordination uses `repository_dispatch` (the content repo notifies the code repo on merge). Secrets — Anthropic API key, optionally the archive.org S3 keys, and a fine-grained PAT for cross-repo PR creation — live as repository secrets in the repo that needs them.

**Tech Stack:** GitHub Actions (`actions/checkout@v4`, `actions/setup-node@v4`, `peter-evans/create-pull-request@v6`), Netlify, the repo's DNS provider.

**Scope:** 7 of 7 phases from `plans/design-plans/2026-04-20-mvp.md`.

**Codebase verified:** 2026-04-20 — plan-writing time. Phase 7 assumes Phases 1–6 are in place and the seed corpus is pushed.

---

## Task 1: `friski-code` workflows

**Files:**
- Create: `.github/workflows/validate.yml`
- Create: `.github/workflows/build.yml`
- Create: `.github/workflows/submodule-bump.yml`

**Step 1: Create `.github/workflows/validate.yml`**

Runs on every PR and on pushes to `main`. Fast-fail pipeline: typecheck, test, validate, no deploy.

```yaml
name: validate
on:
  pull_request:
  push:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run validate
```

**Step 2: Create `.github/workflows/build.yml`**

Parallel to validate — ensures the static build succeeds in a clean environment. Netlify independently builds on deploy; this catches build errors before Netlify gets involved.

```yaml
name: build
on:
  pull_request:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist-${{ github.sha }}
          path: dist/
          retention-days: 7
```

**Step 3: Create `.github/workflows/submodule-bump.yml`**

Receives a `repository_dispatch` event from `frisco-wiki` when its `main` advances. Opens a PR bumping the submodule pointer.

```yaml
name: submodule-bump
on:
  repository_dispatch:
    types: [wiki-main-updated]

jobs:
  bump:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
          token: ${{ secrets.SUBMODULE_BUMP_TOKEN }}
      - name: Update submodule
        run: |
          cd src/content/wiki
          git fetch origin main
          git checkout ${{ github.event.client_payload.sha }}
          cd -
      - name: Create PR
        uses: peter-evans/create-pull-request@v6
        with:
          token: ${{ secrets.SUBMODULE_BUMP_TOKEN }}
          branch: bump-wiki-${{ github.event.client_payload.sha }}
          commit-message: "chore: bump frisco-wiki submodule to ${{ github.event.client_payload.sha }}"
          title: "Bump frisco-wiki to ${{ github.event.client_payload.short_sha }}"
          body: |
            Automated submodule bump from frisco-wiki main.

            **Wiki commit:** ${{ github.event.client_payload.sha }}
            **Wiki PR:** ${{ github.event.client_payload.pr_url }}

            Merging this will trigger a Netlify build.
          labels: submodule-bump
```

**Step 4: Add `SUBMODULE_BUMP_TOKEN` as a repo secret**

Manual step (GitHub UI):

1. Create a fine-grained PAT scoped to the `friski-code` repo with permissions: `contents: write`, `pull_requests: write`.
2. Add it to `friski-code` → Settings → Secrets and variables → Actions → New repository secret, name: `SUBMODULE_BUMP_TOKEN`.

Document this in `docs/ops.md` (create if needed, or append to `README.md`).

**Step 5: Commit**

```bash
git add .github/workflows/
git commit -m "ci: validate, build, and submodule-bump workflows"
```

**Step 6: Verify workflows register**

Push the branch; on GitHub the Actions tab should list the three workflows under `phase-0-mvp`.

---

## Task 2: `frisco-wiki` workflows

These live in the `frisco-wiki` repo, not `friski-code`. The executor switches to the `frisco-wiki` checkout (at `src/content/wiki/` in friski-code, or a separate clone) to add these.

**Files** (all in `frisco-wiki`):
- Create: `.github/workflows/validate.yml`
- Create: `.github/workflows/review.yml`
- Create: `.github/workflows/notify-code.yml`

**Step 1: Set up a sibling clone of `frisco-wiki`**

```bash
GH_USER=$(gh api user -q '.login')
gh repo clone "${GH_USER}/frisco-wiki" ../frisco-wiki
cd ../frisco-wiki
```

**Step 2: Create `.github/workflows/validate.yml`** (in `frisco-wiki`)

Checks out `friski-code` main, uses its validator against the PR's content.

```yaml
name: validate
on:
  pull_request:
  push:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout friski-code (main)
        uses: actions/checkout@v4
        with:
          repository: ${{ github.repository_owner }}/friski-code
          ref: main
          path: friski-code
      - name: Checkout frisco-wiki content
        uses: actions/checkout@v4
        with:
          path: friski-code/src/content/wiki
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: friski-code/package-lock.json
      - name: Install
        working-directory: friski-code
        run: npm ci
      - name: Validate
        working-directory: friski-code
        run: npm run validate
```

**Step 3: Create `.github/workflows/review.yml`** (in `frisco-wiki`)

Invokes the reviewer from `friski-code` main against changed articles. Advisory only — does not block merge.

```yaml
name: review
on:
  pull_request:

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout friski-code (main)
        uses: actions/checkout@v4
        with:
          repository: ${{ github.repository_owner }}/friski-code
          ref: main
          path: friski-code
      - name: Checkout frisco-wiki content (PR head)
        uses: actions/checkout@v4
        with:
          path: friski-code/src/content/wiki
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: friski-code/package-lock.json
      - name: Install
        working-directory: friski-code
        run: npm ci
      - name: Compute changed article files
        id: changed
        working-directory: friski-code/src/content/wiki
        run: |
          base="${{ github.event.pull_request.base.sha }}"
          changed=$(git diff --name-only "$base" HEAD | grep '^articles/.*\.md$' | paste -sd ',' - || true)
          echo "articles=$changed" >> "$GITHUB_OUTPUT"
          echo "Changed articles: $changed"
      - name: Run reviewer
        if: steps.changed.outputs.articles != ''
        working-directory: friski-code
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # GITHUB_REPOSITORY and GITHUB_EVENT_PATH are set automatically by the
          # runner — do NOT set them explicitly. They already point at this
          # frisco-wiki PR, which is what we want the reviewer to post to.
        run: npm run reviewer -- --changed-files="${{ steps.changed.outputs.articles }}"
```

**Step 4: Create `.github/workflows/notify-code.yml`** (in `frisco-wiki`)

Triggers a `repository_dispatch` in `friski-code` after a merge to `main`.

```yaml
name: notify-code
on:
  push:
    branches: [main]

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - name: Fire repository_dispatch in friski-code
        env:
          GH_TOKEN: ${{ secrets.FRISKI_CODE_DISPATCH_TOKEN }}
        run: |
          gh api \
            --method POST \
            /repos/${{ github.repository_owner }}/friski-code/dispatches \
            -f event_type=wiki-main-updated \
            -f "client_payload[sha]=${{ github.sha }}" \
            -f "client_payload[short_sha]=$(echo ${{ github.sha }} | cut -c1-7)" \
            -f "client_payload[pr_url]=https://github.com/${{ github.repository }}/commits/${{ github.sha }}"
```

**Step 5: Add required secrets to `frisco-wiki`**

Manual steps in GitHub UI:

1. `ANTHROPIC_API_KEY` — Claude API key. Used by `review.yml`.
2. `FRISKI_CODE_DISPATCH_TOKEN` — fine-grained PAT scoped to `friski-code` with `contents: write`. Used by `notify-code.yml`. (Can reuse `SUBMODULE_BUMP_TOKEN` from Task 1 if scope permits.)
3. Optional: `ARCHIVE_ORG_S3_KEY` and `ARCHIVE_ORG_S3_SECRET` — not used by CI at MVP; document them for future phases.

**Step 6: Commit and push in `frisco-wiki`**

```bash
git add .github/workflows/
git commit -m "ci: validate, review, and notify-code workflows"
git push
cd -   # back to friski-code
```

**Step 7: Verify workflows register**

On GitHub, visit the `frisco-wiki` repo → Actions. The three workflows should appear.

---

## Task 3: Netlify site + DNS (manual)

**No code.** Document these steps in `docs/ops.md` (create if not present) and walk them with Luis.

**Step 1: Create a Netlify site for `friski-code`**

1. Log into Netlify (https://app.netlify.com).
2. "Add new site" → "Import from Git" → connect GitHub if not already → select `<GH_USER>/friski-code`.
3. Branch to deploy: `main`.
4. Build command: `npm run build`.
5. Publish directory: `dist`.
6. Advanced → submodule setup: set env var `GIT_SUBMODULE_STRATEGY=recursive` (Netlify may also need a deploy key for the public submodule; verify after first build).
7. Save and trigger an initial deploy; confirm it succeeds.

**Step 2: Add the custom domain**

1. In Netlify site settings → Domain management → Add custom domain → `frisco.wiki`.
2. Follow Netlify's DNS instructions. Typically:
   - Add a CNAME record: `frisco.wiki` → `<site-name>.netlify.app`.
   - Or use Netlify's DNS if preferred.
3. Enable HTTPS (Netlify issues a Let's Encrypt cert automatically once DNS resolves).

**Step 3: Verify `https://frisco.wiki` resolves and renders the current deploy**

Visit the URL. It should show the seed homepage (listing Fielder, BoS, Calle 24, etc.).

**Step 4: Confirm deploy-on-merge**

Push a trivial change to `friski-code` main (e.g., whitespace tweak to `README.md`), confirm Netlify auto-deploys within a few minutes.

**Step 5: Write `docs/ops.md`** documenting:

- How the site is hosted (Netlify, `main` branch, `npm run build`, `dist/`).
- DNS: registrar, records.
- Secrets: where each lives, what it does.
- Rotation procedure for API keys.

**Step 6: Commit `docs/ops.md` in `friski-code`**

```bash
git add docs/ops.md
git commit -m "docs: ops runbook for Netlify, DNS, and repo secrets"
```

---

## Task 4: README update + round-trip verification

**Files:**
- Modify: `README.md` (replace the current one-liner with MVP overview + links)

**Step 1: Replace `README.md`**

```markdown
# friski-code

Application code for [Friski](https://frisco.wiki) — a hyperlocal, structured
civic wiki for San Francisco.

Content lives in [frisco-wiki](https://github.com/${GH_USER}/frisco-wiki) and
is consumed here as a git submodule at `src/content/wiki/`.

## Workflow

1. Scaffold a new subject: `npm run new-subject -- --qid <Q> --slug <slug>`
2. Capture sources: `npm run ensure-archived -- --file src/content/wiki/subjects/<slug>.yaml`
3. Write article prose in `frisco-wiki/articles/`.
4. Validate locally: `npm run validate`
5. Commit + push in `frisco-wiki`. CI runs the reviewer and validator.
6. Once the reviewer's advisory comment is addressed and the PR merges:
   - `frisco-wiki` fires a `repository_dispatch` to this repo.
   - This repo opens a submodule-bump PR.
   - Merging that bump triggers a Netlify build, deploying to https://frisco.wiki.

## Design and planning

- `plans/design-plans/2026-04-20-mvp.md` — canonical MVP design.
- `plans/implementation-plans/2026-04-20-mvp/phase_*.md` — how MVP was built.
- `plans/deferred/archival-and-captures.md` — Phase 1 archival thinking.
- `docs/editorial-principles.md` — editorial rules the reviewer enforces.
- `docs/archival-procedure.md` — how to archive sources at MVP.
- `docs/ops.md` — hosting, DNS, secrets, rotation.

## Local development

```sh
npm ci
git submodule update --init --recursive
npm run typecheck
npm test
npm run validate
npm run dev          # local dev server
npm run build        # static build to dist/
```

## License

No license set. See [plans/2026-04-19-plan-0.1.md](plans/2026-04-19-plan-0.1.md)
for the reasoning.
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with MVP workflow and links"
```

**Step 3: Execute the round-trip verification**

This proves the Definition of Done from `plans/design-plans/2026-04-20-mvp.md`. Pick a **new** (post-seed) subject + article + source. Suggested: a second neighborhood (e.g., SF Planning Commission, or a specific BoS vote with coverage).

From `friski-code` (on `main` after Task 1's workflows landed):

```bash
# 1. Scaffold the new subject
cd src/content/wiki
git checkout -b new-subject-<slug>
cd -
npm run new-subject -- --qid <QID> --slug <slug> --output-dir src/content/wiki/subjects

# 2. Enrich the subject YAML by hand (add real claims + sources),
#    then pin archive URLs
npm run ensure-archived -- --file src/content/wiki/subjects/<slug>.yaml

# 3. Write the article markdown at src/content/wiki/articles/<slug>.md

# 4. Validate locally
npm run validate

# 5. Commit in frisco-wiki and push
cd src/content/wiki
git add subjects/ articles/
git commit -m "Add <slug>"
git push -u origin new-subject-<slug>
cd -

# 6. Open a PR on GitHub, observe reviewer comment
gh pr create --repo $(gh api user -q '.login')/frisco-wiki --base main --head new-subject-<slug> --title "Add <slug>" --body "Adds subject and article for <slug>."
```

Watch the PR in GitHub. Expected within a few minutes:

- `validate` workflow passes.
- `review` workflow posts an advisory comment from the Friski reviewer. Luis reviews it; findings (if any) are actionable.

Merge the PR. Expected within a minute:

- `notify-code` workflow in `frisco-wiki` fires.
- `submodule-bump` workflow in `friski-code` opens a PR titled "Bump frisco-wiki to <short-sha>".

Merge the bump PR. Expected within a few minutes:

- Netlify starts a deploy.
- `https://frisco.wiki` renders the new article, the new subject page, and any index pages that include it.

**Step 4: Measure end-to-end wall-clock**

From PR-opened on `frisco-wiki` to content-live on `frisco.wiki`. Record in `docs/ops.md`. Target: under ~15 minutes (reviewer latency dominates; Netlify build is <2 min).

If any step in the round-trip requires reading these implementation docs to recover, surface that to Luis — it means the workflow documentation in `docs/ops.md` needs improvement before Phase 0 is truly complete.

**Step 5: Final commit (no-op if nothing changed)**

```bash
# Any cleanup, docs tweaks the round-trip surfaced
```

---

## Done when

- `friski-code` has `.github/workflows/validate.yml`, `.github/workflows/build.yml`, and `.github/workflows/submodule-bump.yml`. All register on GitHub.
- `frisco-wiki` has `.github/workflows/validate.yml`, `.github/workflows/review.yml`, and `.github/workflows/notify-code.yml`. All register on GitHub.
- Required secrets are set:
  - `friski-code`: `SUBMODULE_BUMP_TOKEN`.
  - `frisco-wiki`: `ANTHROPIC_API_KEY`, `FRISKI_CODE_DISPATCH_TOKEN`.
- Netlify site for `friski-code` builds `main` on push and deploys `dist/` to `frisco.wiki`. DNS + HTTPS are green.
- `README.md` documents the MVP workflow.
- `docs/ops.md` documents Netlify config, DNS, secrets, and rotation.
- The round-trip verification works end-to-end on a post-seed subject+article:
  1. PR to `frisco-wiki` runs validate + review; reviewer posts an actionable advisory comment.
  2. Merging the PR fires `notify-code`, triggering `submodule-bump` in `friski-code`.
  3. Merging the bump PR triggers a Netlify deploy.
  4. `https://frisco.wiki` renders the new article, subject page, and affected index pages.
- Total wall-clock from PR-opened to content-live is under ~15 minutes.
- A *second* subject+article round-trip, performed after the first, completes without referencing implementation docs — Luis drives it from memory or from the terse `README.md` and `docs/` files alone.
- Each task committed independently.
