# Friski MVP Implementation Plan — Phase 5: Seed Corpus

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Populate `frisco-wiki` with 2–3 real subjects and 2 real articles that pass validation, render correctly, and cross-reference each other — built *using* Phases 2–4 tooling, not hand-authored. Adding content must feel repeatable.

**Architecture:** This phase exercises the whole pipeline end-to-end on real content: `new-subject.ts` scaffolds from Wikidata, the author enriches claims and sources, `ensure-archived.ts` pins Wayback snapshots, the validator passes, the renderer produces live pages. The executor collaborates with Luis on editorial decisions (which subjects, which sources, what the prose says); all mechanical steps are automated.

**Tech Stack:** Scripts from Phase 4, validator from Phase 2, renderer from Phase 3. No new dependencies.

**Scope:** 5 of 7 phases from `plans/design-plans/2026-04-20-mvp.md`.

**Codebase verified:** 2026-04-20 — plan-writing time. Phase 5 assumes Phases 1–4 are in place: `scripts/new-subject.ts`, `scripts/ensure-archived.ts`, `scripts/validate-content.ts`, subject graph, page templates, and empty `frisco-wiki` submodule.

---

## Editorial decisions to confirm with Luis before starting

This phase produces real content that ships publicly. Before scaffolding, confirm with Luis:

1. **Third subject choice.** The design plan calls for at least one non-person subject. Recommended: `calle-24-latino-cultural-district` (place) — demonstrates the `F-` namespace if Wikidata lacks a clean QID, appears throughout the editorial-principles discussion, and has good Mission Local coverage. Alternatives Luis may prefer:
   - `sf-planning-commission` (institution)
   - A specific BoS vote or event with a clear news hook
2. **Second article choice.** Must reference the third subject. Recommended: a short article about Calle 24's formal designation, or about its ongoing cultural-district work.
3. **Source outlet picks.** All must be Wayback-friendly per `docs/archival-procedure.md`. For Fielder: Mission Local's 2024 runoff coverage is the richest. For Calle 24: SF Public Press or 48 Hills on the 2014 designation.

If Luis prefers different subjects or sources, substitute throughout the tasks below — the mechanics don't change.

---

## Task 1: Scaffold and enrich subjects

**Files affected:**
- Creates/modifies (in the `frisco-wiki` submodule): `subjects/jackie-fielder.yaml`, `subjects/sf-board-of-supervisors.yaml`, `subjects/calle-24-latino-cultural-district.yaml`

**Step 1: Confirm the submodule is clean and on `main`**

```bash
cd src/content/wiki
git status
git checkout main
git pull
cd -
```

Expected: working tree clean; on `main`; up to date with origin.

**Step 2: Scaffold Jackie Fielder from Wikidata**

```bash
npm run new-subject -- --qid Q99524088 --slug jackie-fielder --output-dir src/content/wiki/subjects
```

Expected: writes `src/content/wiki/subjects/jackie-fielder.yaml` with P31→Q5 claim and Wikidata as the sole source. If the real QID differs from Q99524088, substitute it (Luis can look it up via `https://www.wikidata.org/wiki/Special:Search?search=Jackie+Fielder`).

**Step 3: Scaffold SF Board of Supervisors from Wikidata**

```bash
npm run new-subject -- --qid Q1128418 --slug sf-board-of-supervisors --output-dir src/content/wiki/subjects
```

Expected: writes `sf-board-of-supervisors.yaml` with P31 (likely Q1752939 or Q43229) and Wikidata source.

**Step 4: Create Calle 24 subject (likely no direct Wikidata QID)**

If `https://www.wikidata.org/wiki/Special:Search?search=Calle+24+Latino+Cultural+District` returns a QID, use it via `new-subject`. Otherwise, create the file by hand using the schema shape:

```yaml
# Hand-authored — no direct Wikidata entry.
id: calle-24-latino-cultural-district
label: Calle 24 Latino Cultural District
description: |
  A San Francisco cultural district along 24th Street in the Mission,
  formally designated by the Board of Supervisors in 2014.
scope: [place, cultural-district, mission]

claims:
  - id: C000
    property: P31
    value: F-cultural-district   # F-namespace; must be added to allowed-types.yaml
    source: sfpublicpress-calle24-designation
  # Add a claim about designation date once a Mission Local or
  # SF Public Press source is pinned (see Step 5).

sources:
  - id: sfpublicpress-calle24-designation
    url: https://www.sfpublicpress.org/... # fill in real URL
    publication: SF Public Press
    date_published: 2014-05-01   # approximate; fill in actual article date
    tier: 1
    archive:
      url: https://web.archive.org/web/2/https://www.sfpublicpress.org/...
      method: wayback
      access: public
```

If `F-cultural-district` is a new allowlist value, add it to `config/allowed-types.yaml` in `friski-code`:

```yaml
# Append to friski-code's config/allowed-types.yaml
  - F-cultural-district
```

**Step 5: Enrich each subject with real claims and sources**

This is **editorial work**. For each subject, the executor should:

1. Search the outlet's website for the specific article that supports each claim. Read it as a human; confirm it actually supports the claim.
2. Add the source to the subject's `sources` list with a descriptive `id` (e.g., `missionlocal-2024-11-07-fielder-runoff`), real `url`, `publication`, `author` (if bylined), `date_published`, `tier`.
3. Leave `archive.url` as a placeholder `https://web.archive.org/web/2/<url>` — Task 2 will capture the real snapshot.
4. Add corresponding `claims[]` entries pointing at the new source.

**For Jackie Fielder**, add at minimum:
- `P39` (position held) = `F-SF-D9-Supervisor`, start = `2025-01-08`, source = Mission Local's election-result article.
- `P108` (employer) = `Q1128418` (SF Board of Supervisors), start = `2025-01-08`, same source.
- Optionally `P569` (birth date) if Wikidata has it reliably and the QID claim carries it (already scaffolded from Wikidata if so).

That gets Fielder to 4 claims (including the scaffolded P31), satisfying the "≥3 claims" requirement.

**For SF Board of Supervisors**, the scaffold's P31 claim is sufficient — no further claims needed at MVP; the subject exists to be backlinked.

**For Calle 24**, add at minimum:
- `P571` (inception / founding date) = `2014-05-27` (or real designation date), source = SF Public Press or 48 Hills designation coverage.
- `P131` (located in administrative entity) = `F-sf-mission-district` or `Q62` (San Francisco), source same.

**Step 6: Validate locally**

```bash
npm run validate
```

Expected: passes. If failures, fix per the error messages (missing archive URL is expected before Task 2; all other failures are editorial errors to correct now).

If `validate-content.ts` flags missing archive URLs only, that's expected — proceed to Task 2. If it flags other issues, fix those now.

**Step 7: Commit inside `frisco-wiki`** (not yet pushed)

```bash
cd src/content/wiki
git add subjects/
git commit -m "Seed: jackie-fielder, sf-board-of-supervisors, calle-24-latino-cultural-district"
cd -
```

---

## Task 2: Replace placeholder archive URLs with real Wayback snapshots

**Files affected:** each subject YAML file (archive URLs get rewritten).

**Step 1: Ensure `.env` has the archive.org S3 key if available**

Not required but reduces rate-limit friction:

```bash
# .env (gitignored)
ARCHIVE_ORG_S3_KEY=...
ARCHIVE_ORG_S3_SECRET=...
```

Get from https://archive.org/account/s3.php after signing in.

**Step 2: Archive each subject's sources**

```bash
npm run ensure-archived -- --file src/content/wiki/subjects/jackie-fielder.yaml
npm run ensure-archived -- --file src/content/wiki/subjects/sf-board-of-supervisors.yaml
npm run ensure-archived -- --file src/content/wiki/subjects/calle-24-latino-cultural-district.yaml
```

Expected: each run prints captured snapshot URLs and rewrites the subject file. Each capture takes 10–120 seconds.

**Step 3: If a capture fails**

Try once more. If it still fails, the source is either flaky-on-Wayback or out-of-scope at MVP. Consult `docs/archival-procedure.md` — pick a different source covering the same claim.

**Step 4: Re-validate**

```bash
npm run validate
```

Expected: passes with zero errors.

**Step 5: Commit the archived URLs**

```bash
cd src/content/wiki
git add subjects/
git commit -m "Archive: real Wayback snapshots for all sources"
cd -
```

---

## Task 3: Author articles

**Files affected** (in `frisco-wiki`):
- Create: `articles/jackie-fielder.md`
- Create: `articles/calle-24-latino-cultural-district.md` (or matching the chosen second subject)

**Step 1: Draft `articles/jackie-fielder.md`**

Keep it short. MVP's target is 3–5 short paragraphs — demonstration, not comprehensive coverage. Each factual assertion must be backed by both a claim on Fielder (or on SF BoS) AND a cited source.

Template:

```markdown
---
title: Jackie Fielder
slug: jackie-fielder
primary_subject: jackie-fielder
subjects: [jackie-fielder, sf-board-of-supervisors]
scope: [person, politician]
tags: [district-9, board-of-supervisors]
---

Jackie Fielder is a member of the San Francisco Board of Supervisors,
representing District 9 since January 2025.[^fielder-elected]

Fielder was elected in the November 2024 runoff.[^fielder-elected]

[^fielder-elected]: <source-id from Task 1>
```

The executor should draft 2–4 paragraphs of prose, each assertion cited via a footnote that resolves to a source on Fielder's subject (or on SF BoS). Surface the draft to Luis for editorial review before the commit.

**Step 2: Draft the second article**

Same shape: short prose, footnote citations that resolve to sources on the referenced subjects. At least one cross-subject reference — the article's `subjects[]` lists at least two subject ids. Calle 24's designation by the Board of Supervisors is a natural cross-reference.

**Step 3: Validate**

```bash
npm run validate
```

Expected: passes including footnote resolution for every cited source.

If `footnote-no-match` errors fire, the prose is citing a source id that doesn't exist on any referenced subject — either add the source to the subject or fix the footnote body.

**Step 4: Commit in `frisco-wiki`**

```bash
cd src/content/wiki
git add articles/
git commit -m "Seed: two articles — Jackie Fielder and Calle 24"
cd -
```

---

## Task 4: Build locally, preview, push, bump submodule

**Step 1: Build the static site**

```bash
npm run build
```

Expected: succeeds; `dist/` contains homepage, both article pages, three subject pages, and the current-supervisors index page.

**Step 2: Preview locally**

```bash
npm run preview
```

Open the printed URL. Visually verify:

- Homepage lists both articles and all three subjects.
- Each article renders with prose + "Sources cited" listing real publications and working archive links.
- Each subject page shows its claims table and backlinks to the articles that reference it.
- The current-supervisors index shows Fielder at D9.

Stop the preview server when done.

**Step 3: Lighthouse accessibility check**

```bash
npx http-server dist -p 4321 --silent &
sleep 1
for path in / /jackie-fielder /subjects/jackie-fielder /index/current-supervisors; do
  npx lighthouse "http://localhost:4321${path}" \
    --only-categories=accessibility \
    --chrome-flags="--headless" --quiet \
    --output=json --output-path=stdout \
    | jq '.categories.accessibility.score'
done
kill %1 2>/dev/null || true
```

Expected: each path reports ≥ 0.85. If any page drops below, fix the issue before pushing.

**Step 4: Push `frisco-wiki`**

```bash
cd src/content/wiki
git push origin main
cd -
```

Expected: push succeeds. Luis may need to authorize if this is the first push.

**Step 5: Bump the submodule pointer in `friski-code`**

```bash
git add src/content/wiki
git status
```

Expected: `git status` shows `src/content/wiki` as a modified submodule pointing at a new commit.

**Step 6: Update `config/allowed-types.yaml` if Calle 24 needed `F-cultural-district`**

If Task 1 Step 4 required adding a new F-namespace type, include that file in the same commit so the bump PR carries both changes.

```bash
git add config/allowed-types.yaml  # if modified
```

**Step 7: Commit in `friski-code`**

```bash
git commit -m "Seed corpus: Fielder, SF BoS, Calle 24 (frisco-wiki submodule bump)"
```

**Step 8: Verify the bumped build succeeds from a clean state**

```bash
rm -rf node_modules dist .astro
npm ci
git submodule update --init --recursive
npm run typecheck
npm run test
npm run validate
npm run build
```

Expected: every step succeeds. The build emits pages for the seeded content.

---

## Done when

- `frisco-wiki/subjects/` contains 3 subjects: `jackie-fielder.yaml`, `sf-board-of-supervisors.yaml`, and a third (place or institution; Calle 24 is the recommended default).
- `frisco-wiki/articles/` contains 2 articles; at least one references 2+ subjects (cross-reference requirement satisfied).
- At least one subject has ≥3 claims (Fielder, expected to have 4).
- Every source has a concrete `archive.url` pointing at a real `web.archive.org` snapshot — no `/web/2/` placeholder patterns.
- `npm run validate` passes with zero errors.
- `npm run build` in `friski-code` succeeds; `dist/` contains rendered pages for every article and subject plus the current-supervisors index.
- `npm run preview` renders all pages correctly in a browser; "Sources cited" sections show real publication metadata and working archive links.
- Lighthouse accessibility ≥ 0.85 on homepage, an article page, a subject page, and the index page.
- `frisco-wiki` main has been pushed to the remote; `friski-code` has a commit bumping the `src/content/wiki` submodule pointer.
- From a clean checkout: `npm ci && git submodule update --init && npm run typecheck && npm test && npm run validate && npm run build` all succeed.
- Luis has personally walked the full authoring loop for at least one subject-and-article pair: scaffold → archive → draft prose → validate → preview → commit. The walkthrough took ≤ 30 minutes of active time.
