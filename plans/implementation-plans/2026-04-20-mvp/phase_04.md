# Friski MVP Implementation Plan — Phase 4: Authoring Tooling & Editorial Docs

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Make adding a subject cheap and humane. Two CLI scripts (`new-subject.ts`, `ensure-archived.ts`) plus two reviewer-consumable docs (`docs/editorial-principles.md`, `docs/archival-procedure.md`) cover the authoring loop from Wikidata lookup through Wayback archival.

**Architecture:** Two thin CLI wrappers around focused library helpers — `src/lib/wikidata.ts` (entity fetcher) and `src/lib/wayback.ts` (Save Page Now submit + poll). CLIs use Node's built-in `parseArgs` for flags, no external argparse dep. Unit tests mock `globalThis.fetch`; integration-smoke tests are gated behind an opt-in env flag so CI stays offline. Docs are prose, extracted from the superseded `plans/2026-04-19-plan-0.1.md` §2 and the archival thinking decided during design.

**Tech Stack:** Native Node 22 `fetch`, `node:util.parseArgs`, `js-yaml` (already installed), Vitest with `vi.spyOn(globalThis, 'fetch')`.

**Scope:** 4 of 7 phases from `plans/design-plans/2026-04-20-mvp.md`.

**Codebase verified:** 2026-04-20 — plan-writing time. Phase 4 assumes Phases 1–3 are in place: schemas + validator + graph builder + page templates + `tsx` dev dep + js-yaml runtime dep. No additional npm deps required for this phase.

---

## Task 1: Editorial principles + archival procedure docs

**Files:**
- Create: `docs/editorial-principles.md`
- Create: `docs/archival-procedure.md`

These are prose. No code; no tests. They exist because Phase 6's reviewer prompts consume `editorial-principles.md` directly, and contributors (starting with Luis) consume `archival-procedure.md` when adding sources.

**Step 1: Create `docs/editorial-principles.md`**

Extract from `plans/2026-04-19-plan-0.1.md` §2 into terse, rule-shaped prose the reviewer can anchor on.

```markdown
# Editorial Principles

These rules govern what Friski will assert and how it attributes assertions.
They are the normative reference for editorial disagreements and the input the
LLM reviewer uses to flag NPOV problems in prose.

## Core principles

1. **Attribute early and often.** Prefer "Mission Local reported in 2024 that
   the development drew opposition from Calle 24 advocates" over "the
   development was controversial." Attribution shifts the epistemic frame from
   "here is the truth" to "here is what specific sources reported."

2. **Name the disputants, not the dispute.** Avoid framing like "critics
   argue" or "supporters claim" without naming who. For local disputes the
   specific actors matter — residents of a particular block, a named
   merchants' association, a specific advocacy group.

3. **Represent multiple framings when they exist.** If two reputable sources
   cover the same dispute and reach different conclusions, carry both
   framings with attribution. Don't synthesize an artificial consensus.

4. **Distinguish reporting from opinion.** Editorials, op-eds, and columnists'
   takes are acceptable for attributed opinion claims ("the Chronicle
   editorial board endorsed X"), never for factual claims.

5. **Acknowledge uncertainty.** When sources disagree on simple facts, say
   so: "Sources differ on the vote count (Mission Local: 8–3; SF Standard:
   7–4)."

6. **Be cautious with living people.** Biographical claims about living
   people require Tier 1 or Tier 2 sourcing (see sourcing tiers below). No
   unsourced biographical detail. No claims relayed from social media or
   unnamed sources except in narrowly scoped cases.

7. **No advocacy voice.** Friski articles do not argue for policies or
   outcomes. An article can document that Calle 24 advocates argued for
   specific preservation policies; it does not itself argue that those
   policies are correct. First-person or exhortative language is a reviewer
   flag.

## Sourcing tiers

Every `source.tier` must be in `{1, 2, 3, 4}`. Tiers do not constrain which
sources can be cited, but the reviewer uses them when judging adequacy —
especially for claims about living people.

- **Tier 1 — Primary reliable.** Bylined professional local journalism with
  visible editorial practices: Mission Local, SF Public Press, SF Standard,
  SF Chronicle, KQED, 48 Hills (with awareness of editorial stance).
  Regional professional journalism. Peer-reviewed research. Court filings.

- **Tier 2 — Primary sources requiring context.** Government records (SF
  Planning Department filings, Board of Supervisors legislation, campaign
  finance), organizational websites for non-controversial facts about the
  organization itself, public meeting transcripts, Wikidata.

- **Tier 3 — Heightened scrutiny.** Personal blogs of named journalists or
  researchers with relevant expertise; Substack and similar with clear
  bylines; neighborhood association newsletters; SF Weekly, SFist, Hoodline
  (check the era).

- **Tier 4 — Narrow use.** Social media posts from verified public figures,
  only as primary evidence of *what that person said* (never as evidence of
  external facts). Archived defunct publications. Community platforms are
  not acceptable except as evidence of public discourse with heavy
  attribution.

## Failure modes the reviewer should flag

- Assertions not backed by any claim on a referenced subject (claim coverage).
- Citations to sources whose text doesn't support the prose (source support).
- Loaded language: "notorious," "infamous," "controversial" without
  attribution, "actually," "supposedly."
- Unattributed aggregation: "critics say," "many believe," "some argue."
- First-person or exhortative language in prose.
- Synthetic consensus — stating a conclusion as fact when sources disagree.
- BLP failures — unsourced or weakly-sourced biographical claims about
  living people.

## Scope

Hyperlocal: San Francisco proper, with occasional necessary Bay Area context.
Neighborhoods, institutions, events, and people of genuine civic relevance
are in scope. Living private individuals are not subjects of articles; public
figures acting in public roles are in scope for their public roles.
```

**Step 2: Create `docs/archival-procedure.md`**

```markdown
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

1. Find the article URL. Read it as a human first — make sure it supports
   the specific claim you're about to cite.

2. Submit it to Wayback via the helper:

   ```sh
   npm run ensure-archived -- --file src/content/wiki/subjects/<slug>.yaml
   ```

   The script iterates the subject's sources, submits any source without
   `archive.url` to Wayback's Save Page Now, polls until capture completes
   (typically under 2 minutes), and writes the resulting snapshot URL back
   into the file. It sets `archive.method: wayback` and leaves
   `archive.access: public` (the default).

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
```

**Step 3: Commit**

```bash
git add docs/
git commit -m "docs: editorial principles and MVP archival procedure"
```

No automated verification — these are prose. The operator should skim both for accuracy before committing.

---

## Task 2: Wikidata helper + `new-subject.ts` CLI

**Files:**
- Create: `src/lib/wikidata.ts`
- Create: `scripts/new-subject.ts`
- Create: `tests/wikidata.test.ts`
- Create: `tests/new-subject.test.ts`
- Create: `tests/fixtures/wikidata-q99524088.json` (canned response)
- Modify: `package.json` (add `new-subject` script)

**Step 1: Write failing test at `tests/wikidata.test.ts`**

```typescript
import { describe, expect, test, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchWikidataEntity } from '../src/lib/wikidata';

const __dirname = dirname(fileURLToPath(import.meta.url));

function cannedResponse(name: string) {
  const path = join(__dirname, 'fixtures', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

afterEach(() => vi.restoreAllMocks());

describe('fetchWikidataEntity', () => {
  test('extracts label, description, and P31 values', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(cannedResponse('wikidata-q99524088')), { status: 200 }),
    );

    const entity = await fetchWikidataEntity('Q99524088');

    expect(entity.qid).toBe('Q99524088');
    expect(entity.label).toBe('Jackie Fielder');
    expect(entity.description).toMatch(/American politician/i);
    expect(entity.instanceOf).toContain('Q5');
  });

  test('throws on non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(fetchWikidataEntity('Q000')).rejects.toThrow(/404/);
  });
});
```

**Step 2: Create the canned fixture**

Create `tests/fixtures/wikidata-q99524088.json` with the minimal subset of fields `fetchWikidataEntity` touches:

```json
{
  "entities": {
    "Q99524088": {
      "labels": { "en": { "value": "Jackie Fielder" } },
      "descriptions": { "en": { "value": "American politician and educator" } },
      "claims": {
        "P31": [
          {
            "mainsnak": {
              "datavalue": { "value": { "id": "Q5" }, "type": "wikibase-entityid" }
            }
          }
        ]
      }
    }
  }
}
```

(The real Wikidata response is larger; the fixture strips to the shape `fetchWikidataEntity` consumes.)

**Step 3: Run test to verify it fails**

Run: `npm test -- wikidata`
Expected: FAIL — `fetchWikidataEntity` not defined.

**Step 4: Implement `src/lib/wikidata.ts`**

```typescript
export interface WikidataEntity {
  qid: string;
  label: string;
  description: string;
  instanceOf: string[];
}

interface WikidataResponse {
  entities: Record<string, RawEntity>;
}

interface RawEntity {
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, Array<{
    mainsnak?: { datavalue?: { value?: { id?: string } } };
  }>>;
}

export async function fetchWikidataEntity(qid: string): Promise<WikidataEntity> {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'friski-scaffolder/0.0' },
  });
  if (!response.ok) {
    throw new Error(`Wikidata fetch for ${qid} failed: HTTP ${response.status}`);
  }

  const json = (await response.json()) as WikidataResponse;
  const entity = json.entities?.[qid];
  if (!entity) throw new Error(`Entity ${qid} not found in response`);

  const label = entity.labels?.en?.value ?? qid;
  const description = entity.descriptions?.en?.value ?? '';
  const instanceOf: string[] = [];
  for (const claim of entity.claims?.P31 ?? []) {
    const id = claim.mainsnak?.datavalue?.value?.id;
    if (id) instanceOf.push(id);
  }

  return { qid, label, description, instanceOf };
}
```

**Step 5: Run test to verify it passes**

Run: `npm test -- wikidata`
Expected: both tests pass.

**Step 6: Write failing test for `new-subject.ts`**

Create `tests/new-subject.test.ts`:

```typescript
import { describe, expect, test, vi, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { subjectSchema } from '../src/content.config';
import { scaffoldSubject } from '../scripts/new-subject';

const __dirname = dirname(fileURLToPath(import.meta.url));

afterEach(() => vi.restoreAllMocks());

describe('scaffoldSubject', () => {
  test('writes a schema-valid YAML for a fetched Wikidata entity', async () => {
    const canned = JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'wikidata-q99524088.json'), 'utf8'),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(canned), { status: 200 }),
    );

    const outDir = mkdtempSync(join(tmpdir(), 'scaffold-'));
    try {
      const outPath = await scaffoldSubject({
        qid: 'Q99524088',
        slug: 'jackie-fielder',
        outputDir: outDir,
      });

      expect(existsSync(outPath)).toBe(true);

      const raw = readFileSync(outPath, 'utf8');
      const parsed = yaml.load(raw) as unknown;
      const result = subjectSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(`scaffolded YAML failed schema: ${JSON.stringify(result.error.issues, null, 2)}`);
      }
      expect(result.success).toBe(true);
      expect(result.data.id).toBe('jackie-fielder');
      expect(result.data.wikidata_qid).toBe('Q99524088');
      expect(result.data.claims.some((c) => c.property === 'P31' && c.value === 'Q5')).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  test('throws when target file already exists', async () => {
    const canned = JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'wikidata-q99524088.json'), 'utf8'),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(canned), { status: 200 }),
    );

    const outDir = mkdtempSync(join(tmpdir(), 'scaffold-'));
    try {
      await scaffoldSubject({ qid: 'Q99524088', slug: 'jackie-fielder', outputDir: outDir });
      await expect(
        scaffoldSubject({ qid: 'Q99524088', slug: 'jackie-fielder', outputDir: outDir }),
      ).rejects.toThrow(/already exists/i);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
```

**Step 7: Run test to verify it fails**

Run: `npm test -- new-subject`
Expected: FAIL — `scaffoldSubject` not exported.

**Step 8: Implement `scripts/new-subject.ts`**

```typescript
#!/usr/bin/env tsx
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import yaml from 'js-yaml';
import { fetchWikidataEntity } from '../src/lib/wikidata';
import { subjectSchema } from '../src/content.config';

export interface ScaffoldOptions {
  qid: string;
  slug: string;
  outputDir: string;
}

export async function scaffoldSubject(opts: ScaffoldOptions): Promise<string> {
  const outPath = join(opts.outputDir, `${opts.slug}.yaml`);
  if (existsSync(outPath)) {
    throw new Error(`Target file already exists: ${outPath}`);
  }
  mkdirSync(opts.outputDir, { recursive: true });

  const entity = await fetchWikidataEntity(opts.qid);

  const wikidataSourceId = `wd-${opts.slug}`;
  const seedData = {
    id: opts.slug,
    wikidata_qid: opts.qid,
    label: entity.label,
    description: entity.description || 'DESCRIPTION NEEDED',
    scope: [] as string[],
    claims: entity.instanceOf.map((typeValue, i) => ({
      id: `C${String(i).padStart(3, '0')}`,
      property: 'P31',
      value: typeValue,
      source: wikidataSourceId,
    })),
    sources: [
      {
        id: wikidataSourceId,
        url: `https://www.wikidata.org/wiki/${opts.qid}`,
        publication: 'Wikidata',
        tier: 2 as const,
        archive: {
          url: `https://web.archive.org/web/2/https://www.wikidata.org/wiki/${opts.qid}`,
          method: 'wayback' as const,
          access: 'public' as const,
        },
      },
    ],
  };

  // Validate before writing
  const validated = subjectSchema.parse(seedData);

  const header = [
    '# Scaffolded from Wikidata. Fill in description and add subject-specific claims.',
    `# Source: https://www.wikidata.org/wiki/${opts.qid}`,
    '',
  ].join('\n');

  writeFileSync(outPath, header + yaml.dump(validated, { lineWidth: -1, sortKeys: false }), 'utf8');
  return outPath;
}

// CLI entry ------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      qid: { type: 'string' },
      slug: { type: 'string' },
      'output-dir': { type: 'string', default: 'src/content/wiki/subjects' },
    },
  });

  if (!values.qid || !values.slug) {
    console.error('Usage: new-subject --qid <QID> --slug <slug> [--output-dir <dir>]');
    process.exit(2);
  }

  try {
    const outPath = await scaffoldSubject({
      qid: values.qid,
      slug: values.slug,
      outputDir: values['output-dir']!,
    });
    console.log(`✓ wrote ${outPath}`);
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

Note: the `archive.url` for the Wikidata source uses a `/web/2/...` Wayback pattern that matches any snapshot. The `ensure-archived` helper can later replace it with a concrete snapshot URL, or the schema validator will accept it as-is because it's a valid URL.

**Step 9: Add `new-subject` npm script to `package.json`**

Add to `scripts`:

```json
"new-subject": "tsx scripts/new-subject.ts"
```

**Step 10: Run tests**

Run: `npm test -- new-subject`
Expected: both tests pass.

**Step 11: Commit**

```bash
git add src/lib/wikidata.ts scripts/new-subject.ts tests/wikidata.test.ts tests/new-subject.test.ts tests/fixtures/wikidata-q99524088.json package.json
git commit -m "feat: Wikidata scaffolder for new subjects"
```

---

## Task 3: Wayback helper + `ensure-archived.ts` CLI

**Files:**
- Create: `src/lib/wayback.ts`
- Create: `scripts/ensure-archived.ts`
- Create: `tests/wayback.test.ts`
- Create: `tests/ensure-archived.test.ts`
- Modify: `package.json` (add `ensure-archived` script)

**Step 1: Write failing test for the Wayback helper at `tests/wayback.test.ts`**

```typescript
import { describe, expect, test, vi, afterEach } from 'vitest';
import { captureViaWayback } from '../src/lib/wayback';

afterEach(() => vi.restoreAllMocks());

describe('captureViaWayback', () => {
  test('submits URL, polls, returns snapshot URL on success', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    // Call 1: POST /save/ returns job_id.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ job_id: 'job-123' }), { status: 200 }),
    );
    // Call 2: first poll — still pending.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'pending' }), { status: 200 }),
    );
    // Call 3: second poll — success with timestamp.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'success',
          timestamp: '20260420153000',
          original_url: 'https://missionlocal.org/example',
        }),
        { status: 200 },
      ),
    );

    const result = await captureViaWayback('https://missionlocal.org/example', {
      pollIntervalMs: 1,
      timeoutMs: 5000,
    });

    expect(result.archivedUrl).toBe(
      'https://web.archive.org/web/20260420153000/https://missionlocal.org/example',
    );
    expect(result.timestamp).toBe('20260420153000');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('throws on SPN error status', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ job_id: 'job-456' }), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'error', message: 'robots.txt blocks' }), {
        status: 200,
      }),
    );

    await expect(
      captureViaWayback('https://blocked.example.org/', { pollIntervalMs: 1, timeoutMs: 5000 }),
    ).rejects.toThrow(/robots/);
  });

  test('adds Authorization header when S3 keys provided', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ job_id: 'job-789' }), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: 'success', timestamp: '20260420', original_url: 'https://x.y/' }),
        { status: 200 },
      ),
    );

    await captureViaWayback('https://x.y/', {
      pollIntervalMs: 1,
      s3Key: 'KEY',
      s3Secret: 'SECRET',
    });

    const firstCall = fetchMock.mock.calls[0]!;
    const init = firstCall[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('LOW KEY:SECRET');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- wayback`
Expected: FAIL — `captureViaWayback` not defined.

**Step 3: Implement `src/lib/wayback.ts`**

```typescript
export interface CaptureResult {
  originalUrl: string;
  archivedUrl: string;
  timestamp: string;
  jobId: string;
}

export interface CaptureOptions {
  s3Key?: string;
  s3Secret?: string;
  timeoutMs?: number;       // default 120000 (2 min)
  pollIntervalMs?: number;  // default 5000
}

interface SubmitResponse { job_id: string }

interface StatusResponse {
  status: 'pending' | 'success' | 'error';
  timestamp?: string;
  original_url?: string;
  message?: string;
}

const SPN_SUBMIT = 'https://web.archive.org/save/';
const SPN_STATUS = (jobId: string) => `https://web.archive.org/save/status/${jobId}`;

function authHeaders(opts: CaptureOptions): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.s3Key && opts.s3Secret) {
    headers['Authorization'] = `LOW ${opts.s3Key}:${opts.s3Secret}`;
  }
  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function captureViaWayback(
  url: string,
  opts: CaptureOptions = {},
): Promise<CaptureResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 5_000;
  const headers = authHeaders(opts);

  const body = new URLSearchParams({ url, capture_outlinks: '0' });
  const submit = await fetch(SPN_SUBMIT, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!submit.ok) {
    throw new Error(`Wayback submit failed: HTTP ${submit.status}`);
  }
  const { job_id: jobId } = (await submit.json()) as SubmitResponse;
  if (!jobId) throw new Error('Wayback submit response missing job_id');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const status = await fetch(SPN_STATUS(jobId), { headers });
    if (!status.ok) continue; // transient — retry
    const info = (await status.json()) as StatusResponse;

    if (info.status === 'success' && info.timestamp && info.original_url) {
      return {
        originalUrl: info.original_url,
        archivedUrl: `https://web.archive.org/web/${info.timestamp}/${info.original_url}`,
        timestamp: info.timestamp,
        jobId,
      };
    }
    if (info.status === 'error') {
      throw new Error(`Wayback capture failed: ${info.message ?? 'unknown error'} (job ${jobId})`);
    }
  }

  throw new Error(`Wayback capture timed out after ${timeoutMs}ms (job ${jobId})`);
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- wayback`
Expected: 3 tests pass.

**Step 5: Write failing test for `ensure-archived.ts`**

Create `tests/ensure-archived.test.ts`:

```typescript
import { describe, expect, test, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { ensureArchivedInFile } from '../scripts/ensure-archived';

const __dirname = dirname(fileURLToPath(import.meta.url));

afterEach(() => vi.restoreAllMocks());

function makeSubjectWithPlaceholder(tmpRoot: string): string {
  mkdirSync(tmpRoot, { recursive: true });
  const subjectPath = join(tmpRoot, 'test-subject.yaml');

  // A subject with one source carrying an obvious placeholder archive URL
  // that ensureArchivedInFile should replace.
  const subject = {
    id: 'test-subject',
    label: 'Test Subject',
    description: 'Test description.',
    claims: [{ id: 'C000', property: 'P31', value: 'Q5', source: 'src1' }],
    sources: [{
      id: 'src1',
      url: 'https://missionlocal.org/example',
      publication: 'Mission Local',
      tier: 1,
      archive: {
        url: 'https://web.archive.org/web/2/https://missionlocal.org/example',  // placeholder
        method: 'wayback',
        access: 'public',
      },
    }],
  };
  writeFileSync(subjectPath, yaml.dump(subject), 'utf8');
  return subjectPath;
}

describe('ensureArchivedInFile', () => {
  test('replaces placeholder archive URLs with real snapshots', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ job_id: 'j1' }), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'success',
          timestamp: '20260420000000',
          original_url: 'https://missionlocal.org/example',
        }),
        { status: 200 },
      ),
    );

    const tmpRoot = mkdtempSync(join(tmpdir(), 'archival-'));
    try {
      const subjectPath = makeSubjectWithPlaceholder(tmpRoot);
      const result = await ensureArchivedInFile(subjectPath, { pollIntervalMs: 1 });

      expect(result.captured).toHaveLength(1);
      expect(result.skipped).toHaveLength(0);

      const after = yaml.load(readFileSync(subjectPath, 'utf8')) as { sources: Array<{ archive: { url: string } }> };
      expect(after.sources[0]!.archive.url).toBe(
        'https://web.archive.org/web/20260420000000/https://missionlocal.org/example',
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('leaves concrete snapshot URLs untouched', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const tmpRoot = mkdtempSync(join(tmpdir(), 'archival-'));
    try {
      const subjectPath = join(tmpRoot, 'already-archived.yaml');
      const subject = {
        id: 'already-archived',
        label: 'Already Archived',
        description: '.',
        claims: [{ id: 'C000', property: 'P31', value: 'Q5', source: 's' }],
        sources: [{
          id: 's',
          url: 'https://missionlocal.org/x',
          publication: 'Mission Local',
          tier: 1,
          archive: {
            url: 'https://web.archive.org/web/20240101120000/https://missionlocal.org/x',
            method: 'wayback',
            access: 'public',
          },
        }],
      };
      writeFileSync(subjectPath, yaml.dump(subject), 'utf8');

      const result = await ensureArchivedInFile(subjectPath, { pollIntervalMs: 1 });
      expect(result.captured).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
```

**Step 6: Implement `scripts/ensure-archived.ts`**

```typescript
#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import yaml from 'js-yaml';
import { subjectSchema } from '../src/content.config';
import { captureViaWayback, type CaptureOptions } from '../src/lib/wayback';

// A "placeholder" archive URL has no concrete timestamp: Wayback's /web/2/<url>
// or /web/0/<url> patterns, or just doesn't point at web.archive.org at all.
const PLACEHOLDER_TIMESTAMP = /^https:\/\/web\.archive\.org\/web\/[012]\//;

function isPlaceholderArchive(archiveUrl: string): boolean {
  return PLACEHOLDER_TIMESTAMP.test(archiveUrl);
}

interface EnsureResult {
  captured: Array<{ sourceId: string; archivedUrl: string }>;
  skipped: Array<{ sourceId: string; reason: string }>;
}

export async function ensureArchivedInFile(
  filePath: string,
  opts: CaptureOptions = {},
): Promise<EnsureResult> {
  const raw = readFileSync(filePath, 'utf8');
  const data = yaml.load(raw);
  const subject = subjectSchema.parse(data);

  const captureOpts: CaptureOptions = {
    s3Key: process.env.ARCHIVE_ORG_S3_KEY,
    s3Secret: process.env.ARCHIVE_ORG_S3_SECRET,
    ...opts,
  };

  const result: EnsureResult = { captured: [], skipped: [] };

  for (const source of subject.sources) {
    if (!isPlaceholderArchive(source.archive.url)) {
      result.skipped.push({ sourceId: source.id, reason: 'already has concrete archive URL' });
      continue;
    }
    const capture = await captureViaWayback(source.url, captureOpts);
    source.archive.url = capture.archivedUrl;
    source.archive.method = 'wayback';
    result.captured.push({ sourceId: source.id, archivedUrl: capture.archivedUrl });
  }

  if (result.captured.length > 0) {
    const header = [
      '# Updated by ensure-archived — captured snapshot URLs written into source records.',
      '',
    ].join('\n');
    writeFileSync(filePath, header + yaml.dump(subject, { lineWidth: -1, sortKeys: false }), 'utf8');
  }

  return result;
}

// CLI entry ------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      url: { type: 'string' },
    },
  });

  if (values.url) {
    try {
      const capture = await captureViaWayback(values.url, {
        s3Key: process.env.ARCHIVE_ORG_S3_KEY,
        s3Secret: process.env.ARCHIVE_ORG_S3_SECRET,
      });
      console.log(capture.archivedUrl);
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`);
      process.exit(1);
    }
    return;
  }

  if (values.file) {
    try {
      const result = await ensureArchivedInFile(values.file);
      for (const c of result.captured) console.log(`✓ ${c.sourceId} → ${c.archivedUrl}`);
      for (const s of result.skipped) console.log(`· ${s.sourceId} (${s.reason})`);
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`);
      process.exit(1);
    }
    return;
  }

  console.error('Usage: ensure-archived --file <subject.yaml> | --url <url>');
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

**Step 7: Add `ensure-archived` npm script to `package.json`**

Add to `scripts`:

```json
"ensure-archived": "tsx scripts/ensure-archived.ts"
```

**Step 8: Run tests**

Run: `npm test -- ensure-archived`
Expected: 2 tests pass.

Run: `npm test`
Expected: the entire suite passes.

**Step 9: Manual live smoke (optional, gated)**

Not run in CI. Operator verifies once on a dev machine:

```bash
# Pick a URL that isn't already archived frequently.
npm run ensure-archived -- --url "https://missionlocal.org/$(date +%s)-nonexistent"
```

Expected: exits with an error message from Wayback (404 or capture failed) — no flaky passing test needed.

A positive-path live check, if desired:

```bash
npm run ensure-archived -- --url "https://missionlocal.org/"
```

Expected: prints a `https://web.archive.org/web/<timestamp>/https://missionlocal.org/` URL.

**Step 10: Commit**

```bash
git add src/lib/wayback.ts scripts/ensure-archived.ts tests/wayback.test.ts tests/ensure-archived.test.ts package.json
git commit -m "feat: Wayback Save Page Now helper and ensure-archived CLI"
```

---

## Done when

- `docs/editorial-principles.md` exists, derived from `plans/2026-04-19-plan-0.1.md` §2, phrased as terse reviewer-consumable rules (NPOV principles, sourcing tiers, failure modes, scope).
- `docs/archival-procedure.md` exists, documenting the MVP Wayback-only archival flow, eligible-outlet list, out-of-scope outlets, and when to pick a different source.
- `npm run new-subject -- --qid Q99524088 --slug jackie-fielder --output-dir /tmp/scaffold-test` produces `/tmp/scaffold-test/jackie-fielder.yaml` that passes `subjectSchema.safeParse()` (the unit test proves this with a mocked fetch; the manual smoke proves it against live Wikidata).
- `npm run ensure-archived -- --url https://missionlocal.org/` prints a valid `https://web.archive.org/web/<timestamp>/...` URL (manual smoke).
- `npm run ensure-archived -- --file <path>` replaces placeholder archive URLs (matching `https://web.archive.org/web/[012]/...`) with concrete snapshot URLs, preserves sources already pointing at concrete snapshots, and writes the subject file back atomically.
- Unit tests cover: Wikidata response parsing (including error cases), scaffolded output schema validity, Wayback submit/poll success path, Wayback error-status handling, S3-auth header formation, archived placeholder detection, concrete-URL preservation.
- Tests use mocked `fetch`; the CI suite never hits Wayback or Wikidata.
- Each task committed independently.
