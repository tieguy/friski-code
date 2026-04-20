# Archival Procedure (MVP)

Every source cited in a subject file must have an `archive.url` pointing at a
Wayback Machine (or equivalent) snapshot. `scripts/validate-content.ts`
enforces this, so a missing archive URL fails the build.

## Eligible outlets at MVP

MVP sources are restricted to outlets the Wayback Machine archives reliably:

- Mission Local (missionlocal.org)
- KQED (kqed.org) — text articles
- SF Public Press (sfpublicpress.org)
- 48 Hills (48hills.org)
- Bay City News (baycitynews.org / localnewsmatters.org)
- El Tecolote (eltecolote.org)
- Official government records: SF Clerk, Board of Supervisors legislation
  and minutes, PACER / CourtListener, campaign finance filings
- Wikidata (`wikidata.org`) — for Tier-2 seeded claims

## Outlets explicitly out of scope at MVP

Do not cite these at MVP. They require paywall-aware archival tooling
deferred to Phase 1 (see `plans/deferred/archival-and-captures.md`):

- SF Chronicle (sfchronicle.com) — paywall defeats anonymous capture
- SF Standard (sfstandard.com) — soft paywall, unreliable captures
- Any Substack or similar requiring subscription to read

If an assertion can only be sourced from an out-of-scope outlet, either
find alternative reporting at an eligible outlet or defer the assertion.

## Adding a source

If you are creating a new subject, use `npm run new-subject` (see Phase 4 tooling) to scaffold the YAML first — the scaffolder emits placeholder archive URLs that this procedure replaces.

1. Find the article URL. Read it as a human first — make sure it supports
   the specific claim you're about to cite.

2. Submit it to Wayback via the helper:

   ```sh
   npm run ensure-archived -- --file src/content/wiki/subjects/<slug>.yaml
   ```

   The script iterates the subject's sources, submits any source whose
   `archive.url` is still a placeholder (a `/web/[012]/...` pattern emitted
   by the scaffolder) to Wayback's Save Page Now, polls until capture
   completes (typically under 2 minutes), writes the snapshot URL back into
   the file. It sets `archive.method: wayback` and leaves `archive.access:
   public` (the default).

3. Commit the subject file.

4. Run `npm run validate` locally; the reviewer will run it in CI.

## Rate limits

Save Page Now limits:

- Anonymous: 3 captures per minute.
- Authenticated: 6 captures per minute. Set `ARCHIVE_ORG_S3_KEY` and
  `ARCHIVE_ORG_S3_SECRET` in `.env` from https://archive.org/account/s3.php.
  The helper picks them up automatically.

Adding one subject typically needs 2–5 captures, so anonymous works fine
at MVP pace.

## When Wayback fails

Occasional capture failures happen — Wayback may time out on slow sites,
hit a transient error, or refuse a URL. Try once more:

```sh
npm run ensure-archived -- --url "https://missionlocal.org/..."
```

If the second try still fails, the source is either out-of-scope for MVP or
needs Phase 1 tooling. For MVP: choose a different source.

## Checking an existing snapshot

```sh
npm run ensure-archived -- --url "https://missionlocal.org/..."
```

(`--url` takes one URL and prints the snapshot URL if one exists or
triggers a capture if not. Doesn't write to any file; useful for
spot-checks.)

## Future scope

Paywall-aware capture (SingleFile / WARC / browser extension) lands in
Phase 1. See `plans/deferred/archival-and-captures.md` for the full
decision record. Nothing in the MVP schema needs to change to enable that
later — `archive.method` already accepts `friski_warc` as a value.
