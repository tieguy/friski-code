# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Last verified: 2026-04-20

## Status

Phase 1 complete (foundation). The repo now has an Astro 6 skeleton, Zod content schemas for subjects/articles/sources/claims, subject-graph type surface, Vitest test infrastructure, and the `frisco-wiki` submodule wired at `src/content/wiki/`. No runtime content loader, reviewer, or deploy pipeline yet — those land in Phases 2–5 of the MVP implementation plan (`plans/implementation-plans/2026-04-20-mvp/`).

### Key code locations

- **Content schemas (normative surface):** `src/content.config.ts` exports `sourceSchema`, `claimSchema`, `subjectSchema`, `articleSchema` and matching TS types. Schema changes here are contract changes — update this CLAUDE.md and flag them.
- **Subject graph types:** `src/lib/subject-graph.ts` defines `SubjectGraph`, `SubjectNode`, `ArticleNode`, `ResolvedFootnote`, `ActiveClaim`. The Phase 2 loader will construct these; consumers should depend on these shapes.
- **P31 allowlist:** `config/allowed-types.yaml` — adding a subject of a new type requires adding its P31 value here.
- **Wiki content submodule:** `src/content/wiki/` → `https://github.com/tieguy/frisco-wiki.git`. Subjects and articles live in the submodule, not this repo.

## Normative references

**Technical architecture — `plans/design-plans/2026-04-20-mvp.md`** is the canonical reference for the MVP's scope, repo layout, data model, reviewer shape, and phased implementation. Read this before proposing code changes.

**Editorial policy — `plans/2026-04-19-plan-0.1.md` §2** remains normative for editorial principles (NPOV adaptation, source tiers, scope discipline, "releasable" criteria) until the principles are extracted into `docs/editorial-principles.md` in implementation Phase 4. The rest of that document's technical architecture is **superseded** by the design plan.

**Deferred thinking — `plans/deferred/archival-and-captures.md`** preserves the paywall-aware archival design (WARC captures, `frisco-archives` repo, browser-capture UX research) pulled out of MVP scope. Consult when Phase 1 archival work begins; don't rederive from scratch.

### Load-bearing constraints that survive across phases

- **Portability discipline** (existing plan §3.2). Codeberg mirror is planned. Avoid GitHub-specific features (Projects, Discussions, Codespaces, Copilot PR features, GitHub Pages). CI logic lives in portable Node/shell; forge YAML is a thin wrapper. Structured metadata goes in commit messages and PR bodies, not forge-native fields.
- **Claims are first-class.** Subjects own claims; articles are prose views. Editorial policies derive from the claim graph rather than sideband fields. If tempted to add a flat field, check whether the graph can express it.
- **Deterministic cross-references.** Every pointer (claim→source, footnote→source, article→subject) resolves by exact lookup. Reviewer check targets must never depend on fuzzy matching.

## Architecture snapshot (MVP)

See the design plan for full detail. One-line summary: three-repo split (`friski-code` holds the Astro 6 app + tooling, `frisco-wiki` holds `subjects/*.yaml` and `articles/*.md` consumed via git submodule at `src/content/wiki/`, `frisco-archives` is deferred). Subjects own claims; articles are prose views. A GitHub Actions reviewer runs three LLM-driven checks (claim coverage, source support, NPOV) on content PRs, advisory only. Merge to `frisco-wiki` main triggers an automated submodule bump and Netlify deploy.

## When making technical decisions

- MVP scope is locked down by the design plan. Surface deviations explicitly rather than quietly widening scope.
- Editorial principles (old plan §2) override technical convenience. If a design choice compromises NPOV, sourcing discipline, or scope rules, flag the tension before resolving it.
- Portability discipline is a hard constraint. If a proposed solution only works on GitHub, push back.
- Seed/example content should avoid unresolved editorial risk — see memory on which subjects to prefer in documentation.
