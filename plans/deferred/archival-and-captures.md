# Deferred: Archival beyond Wayback (Phase 1+)

**Status:** Raw notes, not a plan. Captures thinking from the 2026-04 brainstorm so it doesn't have to be rederived when Phase 1 reopens archival.

**Why deferred:** MVP (Phase 0) constrains sources to outlets with good Wayback Machine coverage (Mission Local, KQED, SF Public Press, 48 Hills, government records). The `archive.url` field in source records points at a Wayback snapshot; that's it. This works until we want to cite sources Wayback can't capture well — principally paywalled commercial news (SF Chronicle, SF Standard) and authenticated content.

## The paywall problem

Wayback Machine captures are typically anonymous fetches. For paywalled outlets:
- Chronicle's paywall defeats anonymous capture; the snapshot renders as a paywall wall, not article content.
- Standard's soft paywall means some captures succeed, most don't, unpredictably.
- Substacks vary.

If we want to cite these outlets — and we will, sooner or later — we need a Plan B.

## Plan B options, evaluated

**archive.today / archive.ph** — different technical approach, often succeeds on paywalls Wayback can't handle. Free, rate-limited, no API. Useful as a second public option but still not a full answer (some sites block it too, and it's single-operator with uncertain longevity).

**WARC capture** — ISO 28500, the reference web-archive format. Tools: ArchiveWeb.page browser extension (Webrecorder), Browsertrix Crawler, wget --warc. Replayable via pywb or ReplayWeb.page. Captures authenticated content by using the author's logged-in session. Principled; heavier tooling.

**SingleFile** — single HTML file with embedded resources. Lower fidelity than WARC (loses some JS-driven content) but dramatically simpler. Mature browser extension. A reasonable pragmatic minimum.

**PDF print capture** — lowest complexity, lowest fidelity. Useful as belt-and-suspenders, not a primary archive.

**Quote excerpts in the source record** — cheap but gameable (author could paste fabricated text). Luis flagged this as unacceptable as a primary mechanism; may be usable as supplementary evidence alongside an actual capture.

## Research framing: archival UX as an experiment output

Luis's framing: the capture workflow is itself part of Friski's research contribution, not just infrastructure. "What's the minimum-friction archival that still produces trustworthy artifacts?" is a research question, not just a tooling question.

That means Phase 1's deliverable isn't just "archival works" — it's "archival works and we learned what the editor UX costs." Measurable dimensions:
- Time-to-capture per source
- Abandonment rate (authors who read a source but don't capture it)
- Error rate (captures that fail to verify against their stated hash)
- Author willingness under different UX friction levels

## `frisco-archives` repo design (from the brainstorm)

Separate private repo, distinct from `frisco-wiki` so captures stay private when they contain paywalled or authenticated content.

Layout:
```
frisco-archives/
├── captures/
│   └── <hh>/<hash>.warc            # hh = first two chars of hash
└── metadata/
    └── <hh>/<hash>.yaml            # captured_at, captured_by, source_url,
                                    # capture_method, tool, referenced_by[]
```

Captures hash-addressable (sha256). Duplicate URLs captured at different times are distinct files (useful — captures the temporal state).

Access control at Phase 1: maintainers only have write. Reviewer (in CI) has read via deploy key. No contributor write access at Phase 1; contributors submit content to `frisco-wiki`, maintainers capture on their behalf.

## Schema forward-compatibility

Phase 0's source schema is already forward-compatible:

```yaml
archive:
  url: https://...        # public-facing archive URL (optional)
  hash: sha256:...        # tamper-evident pointer to local capture (optional)
  method: wayback | archive_today | friski_warc | official_record
  access: public | private
```

Phase 1 just starts populating `hash` + `method: friski_warc` + (sometimes) `access: private`. No schema migration required. Renderer already knows to suppress the archive link when `access: private`.

## Storage scaling path

At Phase 1 MVP scale (~100 captures × ~1 MB): in-git works. Past that:

- **Git LFS** — keeps git-native workflow; breaks Codeberg mirroring (no LFS). Reject for portability reasons.
- **Object storage (R2 / B2 / S3)** — scales fine, cheap, portable (S3-compatible everywhere). Introduces non-git dependency but `hash`-keyed URLs make migration mechanical (copy files, swap URL prefix in reviewer config).

Recommendation when it hurts: object storage. Schema-compatible migration.

## Authoring tooling arc

Phase 1 minimum: document the manual capture procedure. Author uses SingleFile or ArchiveWeb.page extension → hashes the output → commits to `frisco-archives` → pastes stub into source record. Friction is real and measurable.

Phase 2 deliverable (possibly): a "Friski capture" browser extension that automates capture → hash → upload → source-record-stub. UX research output: how much did friction drop?

Phase 3+: maybe a capture UI integrated with the git-backed CMS (Decap / Pages CMS / Keystatic).

## Rate limits and API keys

Wayback Save Page Now: 3/min anonymous, 6/min authenticated. Authenticated key (from `https://archive.org/account/s3.php`) lives in `.env` for authoring tools. MVP uses this key for the `ensure-archived.ts` helper that calls Save Page Now on new sources. Phase 1 archival doesn't need it (WARC capture is local).

## Copyright / fair-use posture

Storing full captures of paywalled commercial content for verifiability raises copyright questions. Private storage (`access: private`) is the posture we're betting on — captures are held for verifiability, not redistribution. Renderer never links to private captures publicly. Needs a documented position before Phase 1 ships; probably not a legal opinion, but a clear statement of intent and scope.

## Open questions to resolve at Phase 1 kickoff

- Does archive.today hold up as a public fallback for Chronicle? Test empirically.
- WARC vs SingleFile as the primary format? Probably both — WARC for durability, SingleFile for portability/preview.
- Where do contributor captures come from when contributors don't have `frisco-archives` write access? Reviewer-as-capturer, or dedicated capture service?
- Copyright posture doc — does it need lawyer review or is "good faith + private + verifiability-only" sufficient?
