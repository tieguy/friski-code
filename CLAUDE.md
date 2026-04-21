# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Last verified: 2026-04-20 (Phase 6 close)

## Status

Phases 1–6 complete; Phase 7 (deploy pipeline) next. Phase 6 shipped the reviewer MVP: three LLM-driven checks (claim coverage, source support, NPOV) plus a comment composer and CLI (`npm run reviewer -- --dry-run ...`), all gated behind mocked-LLM tests with four realistic fixture corpora (`clean-baseline`, `claim-less-assertion`, `overreach`, `advocacy-voice`). Methodology borrows three load-bearing patterns from the sibling `open-graph-next/wikidata-SIFT` project: the SIFT 6-class verdict ordinal (`verified-high | verified-low | plausible | unverifiable | suspect | incorrect`), a direct-quote requirement on the support check, and explicit no-training-data / no-truncation guardrails. No GitHub Action YAML wired yet, and no live Anthropic smoke run yet — both are operator followups for Phase 7 integration. Phase 5 shipped a live seed corpus: 6 subjects (Jackie Fielder, SF Board of Supervisors, Mission District, Mission Local, DPW corruption scandal, DBI / Santos corruption case) and 5 article stubs, all sources with concrete Wayback snapshots. `frisco-wiki` main is pushed at tieguy/frisco-wiki HEAD `7f1cb86`; friski-code has the submodule-pointer bump at `15f7206`. Phase 4 shipped authoring tooling + editorial docs. Phase 3's render pipeline ships a shared `BaseLayout`, minimal CSS, three reusable components (`SubjectRef`, `Citation`, `ClaimsTable`), article pages (`/[slug]`), subject pages (`/subjects/[id]`), a content-listing homepage, and a query-derived index (`/index/current-supervisors`); `astro build` produces a static site (13 pages from the current corpus). Phase 4 adds two authoring CLIs (`new-subject`, `ensure-archived`) backed by pure cores in `src/lib/` (Wikidata fetch, Wayback Save Page Now client), plus extracted editorial docs (`docs/editorial-principles.md`, `docs/archival-procedure.md`). Deploy pipeline (Phase 7) is the remaining MVP work (`plans/implementation-plans/2026-04-20-mvp/`).

### Phase 5 outcome

All Done-when criteria met except **Lighthouse accessibility scoring**, which remains operator-followup (flatpak Chrome sandbox blocks headless automation on the dev env). Run `npx lighthouse` against the served `dist/` from a machine with system Chrome to close that gap.

Clean-checkout smoke (`rm -rf node_modules dist .astro src/content/wiki && git submodule update --init && npm ci && npm run typecheck && npm test && npm run validate && npm run build`) passes end-to-end: 43 tests green, 0 typecheck errors, validator reports 6 subjects / 5 articles / 0 errors, build produces 13 pages.

### Phase 5 learnings (operator + CI-design implications)

- **Wayback SPN is no longer anonymously submittable.** `docs/archival-procedure.md` still claims "anonymous 3/min" — that is stale and must be corrected before publishing docs. See memory `wayback-spn-auth-required.md`.
- **Authenticated SPN trips an IP-level TCP-refuse after ~3-5 rapid submits**, clearing in minutes. Implication for Phase 6 CI: the reviewer GitHub Action **should not submit captures**. It should only validate that source URLs are either already resolved to concrete snapshots or flag placeholder URLs for operator follow-up. Details in memory `wayback-rate-limit-pattern.md`.
- **`ensure-archived` has no availability-API preflight** (deferred Phase 4 Minor #2). It always submits, which burns quota against already-archived URLs. Phase 6 CI-wiring must decide whether to integrate this CLI or keep it strictly operator-local; leaning operator-only until a preflight is added.
- **Phase 1-4 test fixtures use fictitious Wikidata QIDs** that happen to point at unrelated entities (e.g. `Q99524088` is a beetle taxonomy article). Schema regex can't catch this. Real production QIDs used in the Phase 5 seed corpus are captured in memory `test-fixture-qids-not-real.md`; use those — not fixture values — when writing docs or new examples.

### Phase 6 outcome

Reviewer MVP shipped: `scripts/reviewer/` module tree (entry point + LLM client + context loader + composer + three checks + three prompt modules) plus `tests/reviewer/` unit + integration suites and four fixture corpora under `tests/reviewer-fixtures/`. Test count: 43 → 65 (22 new tests across reviewer units, composer, and integration). Integration tests mock the LLM via `vi.mock('../../scripts/reviewer/llm')` and mock network via `vi.stubGlobal('fetch', ...)` with `afterAll` teardown — **no live API or network in CI**.

Three deliberate divergences from the original Phase 6 plan draft, all borrowed from the sibling wikidata-SIFT project:

1. **SIFT 6-class verdict ordinal** (`FindingVerdict` in `scripts/reviewer/types.ts`). Replaces a bool/tri-state with a stable ordinal shared across all three checks, so composers/logs/future dashboards have one schema. Findings are typically problems (rare `verified-*`), but the full vocabulary is defined for completeness. Unknown values fall back to `plausible` (the soft middle) rather than being silently dropped.
2. **Direct-quote requirement on support.** The support check's `Finding.quote` field carries a verbatim snippet from the fetched source body, preventing the model from supporting assertions via hallucinated paraphrase.
3. **No-training-data / no-truncation guardrails.** Coverage and support system prompts explicitly forbid reliance on model training data and forbid truncating returned findings lists.

Operator followup: the `--dry-run` live smoke against Anthropic (Task 5 Step 8) requires `ANTHROPIC_API_KEY` and was **not** run in-environment. Run it post-merge before wiring the Phase 7 GitHub Action. Precedent: same shape as Phase 5's Lighthouse-accessibility gap.

### Phase 6 learnings

- **P31 enforcement stays with the validator**, not the reviewer. The `--allowed-types` CLI flag was dropped from the reviewer; `scripts/reviewer/context.ts` intentionally does not load `config/allowed-types.yaml`. The reviewer validates editorial quality against an already-validated graph.
- **Prompt caching applies only to the NPOV check's editorial-principles block.** `makeLLMClient` supports `cachedSystemContext` and flags any provided block with `cache_control: ephemeral`; in practice, coverage and support pass only the system prompt, while NPOV also passes the full `docs/editorial-principles.md` body. Blocks below Sonnet's 1024-token cacheable minimum are a no-op — still safe to mark.
- **Fixture editorial-principles is a copy, not a paraphrase.** Each `tests/reviewer-fixtures/*/editorial-principles.md` is byte-identical to `docs/editorial-principles.md` so the NPOV check sees the real policy during tests. When updating `docs/editorial-principles.md`, resync all four fixture copies or the integration test will drift.

### Key code locations

- **Content schemas (canonical, normative surface):** `src/content-schemas.ts` is the **single source of truth** for `sourceSchema`, `claimSchema`, `subjectSchema`, `articleSchema` and their inferred TS types. Schema changes here are contract changes — update this CLAUDE.md and flag them. Both the Astro content layer and the standalone validator import from this module.
- **Astro content-collection wiring:** `src/content.config.ts` registers the `subjects` and `articles` collections against `src/content/wiki/` and wraps the schemas for Astro's loader. See "zod v3/v4 seam" below.
- **Footnote parser:** `src/lib/footnote-parser.ts` exports `extractFootnotes(markdown)` — AST-based GFM parse returning `{ label: body }` for every `[^label]: body` definition.
- **Subject graph:** `src/lib/subject-graph.ts` exports `buildSubjectGraph(subjects, articles)` returning a `SubjectGraph` with `subjects`/`articles` maps and derived predicates (`activeClaims`, `isLivingPerson`, `articlesReferencing`). Throws `FootnoteResolutionError` on unresolvable footnotes; the validator catches and reformats these.
- **Content validator CLI:** `scripts/validate-content.ts` exports `validate(contentRoot, allowedTypesPath)` and runs via `npm run validate`. Rule names in its `ValidationError.rule` field (`schema.*`, `subject-id-unique`, `source-id-unique-within-subject`, `claim-source-resolves`, `p31-present`, `p31-allowlist`, `article-subjects-unique`, `primary-subject-in-subjects`, `no-orphan-subjects`, `footnote-no-match`, `footnote-ambiguous`) are a **stable API** — CI and humans grep for them, so rename only with care. (Note: `schema.*` is a prefix; field-level errors emit e.g. `schema.sources.0.tier` or `schema.sources.0.archive.url`.)
- **P31 allowlist:** `config/allowed-types.yaml` — adding a subject of a new type requires adding its P31 value here.
- **Wiki content submodule:** `src/content/wiki/` → `https://github.com/tieguy/frisco-wiki.git`. Subjects and articles live in the submodule, not this repo.
- **Graph access at render time:** `src/lib/get-graph.ts` exports `getGraph(): Promise<SubjectGraph>` — module-level cached imperative shell that calls `getCollection('subjects' | 'articles')` and hands off to `buildSubjectGraph`. **All pages and components read the graph via `getGraph()`**; do not re-invoke `buildSubjectGraph` from pages, and do not call `getCollection` directly from components. The cache is per-module-instance (fine for Astro's static build; revisit if SSR is added).
- **Pages and components:** `src/layouts/BaseLayout.astro` (shared HTML shell), `src/components/{SubjectRef,Citation,ClaimsTable}.astro` (prose/subject rendering primitives), `src/pages/[slug].astro` (article renderer), `src/pages/subjects/[id].astro` (subject page: claims table + backlinks), `src/pages/index.astro` (content listing), `src/pages/index/current-supervisors.astro` (query-derived index — pattern for future derived indices). Site CSS lives in `public/style.css`.
- **Authoring tooling (Phase 4).** Two CLIs backed by pure cores:
  - `src/lib/wikidata.ts` exports `fetchWikidataEntity(qid)` → `{ label, description, instanceOf[] }`. Sends a descriptive User-Agent; tested against `tests/fixtures/wikidata-q99524088.json`.
  - `src/lib/wayback.ts` exports `captureViaWayback(url, opts)` (Save Page Now submit+poll). `CaptureOptions` honors `s3Key`/`s3Secret`; env vars `ARCHIVE_ORG_S3_KEY` / `ARCHIVE_ORG_S3_SECRET` enable authenticated captures (6/min vs 3/min anonymous). `timeoutMs` is a hard deadline on the poll loop.
  - `scripts/new-subject.ts` exports `scaffoldSubject({ qid, slug, outputDir })`; run as `npm run new-subject`. Writes a subject YAML seeded from Wikidata with **placeholder archive URLs** of the form `https://web.archive.org/web/[012]/<original-url>`.
  - `scripts/ensure-archived.ts` exports `ensureArchivedInFile(filePath, opts)`; run as `npm run ensure-archived` with `--url` or `--file` modes. Recognizes placeholder URLs via `/^https:\/\/web\.archive\.org\/web\/[012]\//` and replaces them with concrete Wayback snapshots. **Partial-failure persistence:** successful captures in a batch are written even if later captures fail, via tmp-file + `renameSync` (POSIX-atomic replace).
  - **Contract between the two scripts:** the placeholder-URL regex is the handoff. `new-subject` must emit URLs matching it; `ensure-archived` must treat any URL matching it as "not yet captured." Change the pattern in one place and the other breaks silently.
- **Reviewer tooling (Phase 6).** LLM-driven editorial reviewer split into a functional core (checks + composer + parser) and an imperative shell (entry point + context loader + LLM client). Module tree under `scripts/reviewer/`:
  - `scripts/reviewer/types.ts` — the **normative type surface**: `FindingVerdict` (SIFT 6-class ordinal, ordered strongly-supports → directly-contradicts), `Finding`, `CheckContext`, `CheckResult`, `ReviewResult`. These types are contracts across the reviewer; change them here and all downstream consumers update.
  - `scripts/reviewer/index.ts` — exports `runReview(opts)` and provides the CLI (`npm run reviewer -- [--content-root ...] [--editorial-principles ...] [--changed-files ...] [--dry-run]`). With `--dry-run`, prints the composed comment to stdout; otherwise posts via Octokit to the PR identified by `GITHUB_EVENT_PATH` + `GITHUB_REPOSITORY` + `GITHUB_TOKEN` (env vars). If PR context or `GITHUB_TOKEN` is missing, falls back to stdout with a warning — safe default.
  - `scripts/reviewer/llm.ts` — exports `makeLLMClient(apiKey?)` (requires `ANTHROPIC_API_KEY`, uses `REVIEWER_MODEL = 'claude-sonnet-4-6'`, temperature 0, max tokens 4096) and the pure `parseFindings(text)` YAML parser. `callForFindings` applies `cache_control: ephemeral` to both `systemPrompt` and optional `cachedSystemContext`. Unknown verdicts fall back to `plausible` — a deliberately soft default that surfaces to the reviewer without escalating.
  - `scripts/reviewer/context.ts` — exports `loadContent(contentRoot, editorialPrinciplesPath)` (builds a `SubjectGraph` and per-article `CheckContext` map) and `loadPRContextFromEnv()` (reads `GITHUB_EVENT_PATH`, `GITHUB_REPOSITORY`). **P31 allowlist enforcement is the validator's job**, not the reviewer's — `context.ts` intentionally does not load `config/allowed-types.yaml`.
  - `scripts/reviewer/checks/{coverage,support,npov}.ts` — each exports `run{Coverage,Support,Npov}Check(ctx, llm, ...)` → `CheckResult`. `runSupportCheck` takes an optional `fetchSource` injection (defaults to global `fetch` with HTML-tag stripping) so tests can stub network. Support fetches each cited source once per article and attaches `[sourceId]` prefixes and `quote` fields to its findings.
  - `scripts/reviewer/prompts/{coverage,support,npov}.ts` — system prompts + user-prompt builders. Coverage and support prompts include no-training-data / no-truncation guardrails; support mandates a direct `quote` field. NPOV passes `docs/editorial-principles.md` as `cachedSystemContext` — the only check that uses prompt-cache on a second system block.
  - `scripts/reviewer/compose.ts` — exports `composeComment(review, model)` producing a markdown PR comment with per-check sections, verdict icons, and assertion/quote blockquotes. Status line reports `clean` vs `review` based on `totalFindings` + `hasErrors`.
  - **Test fixtures:** `tests/reviewer-fixtures/{clean-baseline, claim-less-assertion, overreach, advocacy-voice}/` — four minimal subjects+articles corpora, each designed to exercise one of the three checks. Each directory contains `editorial-principles.md` byte-identical to `docs/editorial-principles.md`; resync all four when editing the canonical copy.
  - **New dependencies:** `@anthropic-ai/sdk` (LLM calls), `@octokit/rest` (PR comment posting). Both gated by env vars so CI without credentials falls back gracefully to dry-run.

### Architectural constraints (Phase 2–3)

- **FCIS (functional core, imperative shell).** Pure logic (schemas, footnote parser, graph builder) lives in `src/content-schemas.ts` and `src/lib/*` with no I/O. The imperative shell (`scripts/validate-content.ts`, `src/content.config.ts`) handles filesystem reads and framework wiring. Preserve this split when adding new logic — new pure code goes in `src/lib/`, not in scripts.
- **Zod v3 / v4 seam.** This project depends on standalone `zod@3`, but `astro:content`'s type surface expects an `astro/zod` (v4) schema. `src/content.config.ts` narrow-casts via `BaseSchema` at the single call site. Runtime validation works (safeParseAsync); `astro check`/`astro build` emit a non-fatal JSON-schema-generation warning per collection. Do not pull `astro/zod` into `src/content-schemas.ts` — the standalone zod@3 module must stay importable from the validator without Astro's runtime.
  - Downstream consequence: `entry.data` from `getCollection` is typed `unknown` in this project, so `src/lib/get-graph.ts` and `src/pages/[slug].astro` use targeted `as Subject` / `as Article` casts. This is the same root cause as the `BaseSchema` cast above — treat it as a known seam, not a smell.

### Phase 3 gotchas

- **Stale content cache between builds.** Astro caches content-collection output under `node_modules/.astro`. When smoke-testing with a swapped fixture (copy fixtures → build → revert submodule), `rm -rf node_modules/.astro` between builds is required or the cache masks the new inputs. Documented in `plans/implementation-plans/2026-04-20-mvp/phase_03.md`.
- **Lighthouse accessibility check is operator-followup.** Flatpak Chrome on the dev environment doesn't support headless automation, so accessibility scoring isn't part of the automated phase verification; run Lighthouse manually when vetting a deploy candidate.

## Normative references

**Technical architecture — `plans/design-plans/2026-04-20-mvp.md`** is the canonical reference for the MVP's scope, repo layout, data model, reviewer shape, and phased implementation. Read this before proposing code changes.

**Editorial policy — `docs/editorial-principles.md`** is the normative reference for editorial principles (NPOV adaptation, source tiers, scope discipline). Extracted from `plans/2026-04-19-plan-0.1.md` §2 in Phase 4. The rest of that document's technical architecture is **superseded** by the design plan.

**Deferred thinking — `plans/deferred/archival-and-captures.md`** preserves the paywall-aware archival design (WARC captures, `frisco-archives` repo, browser-capture UX research) pulled out of MVP scope. Consult when Phase 1 archival work begins; don't rederive from scratch.

### Load-bearing constraints that survive across phases

- **Portability discipline** (existing plan §3.2). Codeberg mirror is planned. Avoid GitHub-specific features (Projects, Discussions, Codespaces, Copilot PR features, GitHub Pages). CI logic lives in portable Node/shell; forge YAML is a thin wrapper. Structured metadata goes in commit messages and PR bodies, not forge-native fields.
- **Claims are first-class.** Subjects own claims; articles are prose views. Editorial policies derive from the claim graph rather than sideband fields. If tempted to add a flat field, check whether the graph can express it.
- **Deterministic cross-references.** Every pointer (claim→source, footnote→source, article→subject) resolves by exact lookup. Reviewer check targets must never depend on fuzzy matching.

## Architecture snapshot (MVP)

See the design plan for full detail. One-line summary: three-repo split (`friski-code` holds the Astro 6 app + tooling, `frisco-wiki` holds `subjects/*.yaml` and `articles/*.md` consumed via git submodule at `src/content/wiki/`, `frisco-archives` is deferred). Subjects own claims; articles are prose views. Content is validated by a standalone CLI (`npm run validate`) and loaded into an in-memory `SubjectGraph` for downstream consumers. The reviewer (`npm run reviewer -- --dry-run ...`, Phase 6) runs three LLM-driven checks (claim coverage, source support, NPOV) on content PRs, advisory only; the GitHub Action wrapper lands in Phase 7 alongside the deploy pipeline (merge to `frisco-wiki` main triggers an automated submodule bump and Netlify deploy).

## When making technical decisions

- MVP scope is locked down by the design plan. Surface deviations explicitly rather than quietly widening scope.
- Editorial principles (old plan §2) override technical convenience. If a design choice compromises NPOV, sourcing discipline, or scope rules, flag the tension before resolving it.
- Portability discipline is a hard constraint. If a proposed solution only works on GitHub, push back.
- Seed/example content should avoid unresolved editorial risk — see memory on which subjects to prefer in documentation.
