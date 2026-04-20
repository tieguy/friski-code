# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Last verified: 2026-04-20

## Status

Phase 2 complete (schemas + graph + validator). The repo has an Astro 6 skeleton with registered content collections (subjects, articles), a canonical Zod schema module, a GFM footnote parser, a working `buildSubjectGraph` implementation, and a standalone validator CLI (`npm run validate`) covered by 25 Vitest tests. No reviewer or deploy pipeline yet — those land in Phases 3–5 of the MVP implementation plan (`plans/implementation-plans/2026-04-20-mvp/`).

### Key code locations

- **Content schemas (canonical, normative surface):** `src/content-schemas.ts` is the **single source of truth** for `sourceSchema`, `claimSchema`, `subjectSchema`, `articleSchema` and their inferred TS types. Schema changes here are contract changes — update this CLAUDE.md and flag them. Both the Astro content layer and the standalone validator import from this module.
- **Astro content-collection wiring:** `src/content.config.ts` registers the `subjects` and `articles` collections against `src/content/wiki/` and wraps the schemas for Astro's loader. See "zod v3/v4 seam" below.
- **Footnote parser:** `src/lib/footnote-parser.ts` exports `extractFootnotes(markdown)` — AST-based GFM parse returning `{ label: body }` for every `[^label]: body` definition.
- **Subject graph:** `src/lib/subject-graph.ts` exports `buildSubjectGraph(subjects, articles)` returning a `SubjectGraph` with `subjects`/`articles` maps and derived predicates (`activeClaims`, `isLivingPerson`, `articlesReferencing`). Throws `FootnoteResolutionError` on unresolvable footnotes; the validator catches and reformats these.
- **Content validator CLI:** `scripts/validate-content.ts` exports `validate(contentRoot, allowedTypesPath)` and runs via `npm run validate`. Rule names in its `ValidationError.rule` field (`schema.*`, `subject-id-unique`, `source-id-unique-within-subject`, `claim-source-resolves`, `p31-present`, `p31-allowlist`, `article-subjects-unique`, `primary-subject-in-subjects`, `no-orphan-subjects`, `footnote-no-match`, `footnote-ambiguous`) are a **stable API** — CI and humans grep for them, so rename only with care. (Note: `schema.*` is a prefix; field-level errors emit e.g. `schema.sources.0.tier` or `schema.sources.0.archive.url`.)
- **P31 allowlist:** `config/allowed-types.yaml` — adding a subject of a new type requires adding its P31 value here.
- **Wiki content submodule:** `src/content/wiki/` → `https://github.com/tieguy/frisco-wiki.git`. Subjects and articles live in the submodule, not this repo.

### Architectural constraints introduced in Phase 2

- **FCIS (functional core, imperative shell).** Pure logic (schemas, footnote parser, graph builder) lives in `src/content-schemas.ts` and `src/lib/*` with no I/O. The imperative shell (`scripts/validate-content.ts`, `src/content.config.ts`) handles filesystem reads and framework wiring. Preserve this split when adding new logic — new pure code goes in `src/lib/`, not in scripts.
- **Zod v3 / v4 seam.** This project depends on standalone `zod@3`, but `astro:content`'s type surface expects an `astro/zod` (v4) schema. `src/content.config.ts` narrow-casts via `BaseSchema` at the single call site. Runtime validation works (safeParseAsync); `astro check`/`astro build` emit a non-fatal JSON-schema-generation warning per collection. Do not pull `astro/zod` into `src/content-schemas.ts` — the standalone zod@3 module must stay importable from the validator without Astro's runtime.

## Normative references

**Technical architecture — `plans/design-plans/2026-04-20-mvp.md`** is the canonical reference for the MVP's scope, repo layout, data model, reviewer shape, and phased implementation. Read this before proposing code changes.

**Editorial policy — `plans/2026-04-19-plan-0.1.md` §2** remains normative for editorial principles (NPOV adaptation, source tiers, scope discipline, "releasable" criteria) until the principles are extracted into `docs/editorial-principles.md` in implementation Phase 4. The rest of that document's technical architecture is **superseded** by the design plan.

**Deferred thinking — `plans/deferred/archival-and-captures.md`** preserves the paywall-aware archival design (WARC captures, `frisco-archives` repo, browser-capture UX research) pulled out of MVP scope. Consult when Phase 1 archival work begins; don't rederive from scratch.

### Load-bearing constraints that survive across phases

- **Portability discipline** (existing plan §3.2). Codeberg mirror is planned. Avoid GitHub-specific features (Projects, Discussions, Codespaces, Copilot PR features, GitHub Pages). CI logic lives in portable Node/shell; forge YAML is a thin wrapper. Structured metadata goes in commit messages and PR bodies, not forge-native fields.
- **Claims are first-class.** Subjects own claims; articles are prose views. Editorial policies derive from the claim graph rather than sideband fields. If tempted to add a flat field, check whether the graph can express it.
- **Deterministic cross-references.** Every pointer (claim→source, footnote→source, article→subject) resolves by exact lookup. Reviewer check targets must never depend on fuzzy matching.

## Architecture snapshot (MVP)

See the design plan for full detail. One-line summary: three-repo split (`friski-code` holds the Astro 6 app + tooling, `frisco-wiki` holds `subjects/*.yaml` and `articles/*.md` consumed via git submodule at `src/content/wiki/`, `frisco-archives` is deferred). Subjects own claims; articles are prose views. Content is validated by a standalone CLI (`npm run validate`) and loaded into an in-memory `SubjectGraph` for downstream consumers. A GitHub Actions reviewer runs three LLM-driven checks (claim coverage, source support, NPOV) on content PRs, advisory only. Merge to `frisco-wiki` main triggers an automated submodule bump and Netlify deploy.

## When making technical decisions

- MVP scope is locked down by the design plan. Surface deviations explicitly rather than quietly widening scope.
- Editorial principles (old plan §2) override technical convenience. If a design choice compromises NPOV, sourcing discipline, or scope rules, flag the tension before resolving it.
- Portability discipline is a hard constraint. If a proposed solution only works on GitHub, push back.
- Seed/example content should avoid unresolved editorial risk — see memory on which subjects to prefer in documentation.
