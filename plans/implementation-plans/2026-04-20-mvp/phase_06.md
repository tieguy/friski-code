# Friski MVP Implementation Plan — Phase 6: Reviewer MVP

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.
>
> **CONDITIONAL SKILL:** Activate `claude-api` when implementing the LLM client wrapper — it has current guidance on SDK usage, prompt caching, and model selection.

**Goal:** A Node-based reviewer that collects a PR's changed content, runs three LLM-backed checks (claim coverage, source support, NPOV), composes a single structured PR comment, and produces findings Luis judges actionable and honest on both the clean seed corpus and deliberately-flawed fixture PRs.

**Architecture:** Three independent check modules share a small LLM client wrapper (`scripts/reviewer/llm.ts`) that pins the model and temperature, applies prompt caching on every stable system block (per-check system prompt + the editorial-principles doc), and returns structured findings. The entry point (`scripts/reviewer/index.ts`) reads PR context from either GitHub Actions env vars or CLI flags, runs the three checks, and posts one comment (or prints it in `--dry-run`). Coverage runs first (cheap, no network); support runs second only on assertions that passed coverage; NPOV runs in parallel with coverage. **Content-hash-keyed caching is deferred past MVP** — the reviewer runs every check fresh. Anthropic's prompt caching (5-min TTL on the cached system blocks) gives most of the cost benefit with zero implementation effort; cross-run content caching is a future optimization, not Phase 0 scope.

**Methodology provenance — learning from wikidata-SIFT:** this reviewer adopts three load-bearing patterns from the sibling project `wikidata-SIFT` (open-graph-next/wikidata-SIFT, 500-edit labeled evaluation, 2026-04). Where Phase 6's earlier draft diverged from SIFT, SIFT wins; the gaps closed in this plan are:

1. **Six-class verdict ordinal** replaces the `info | warn | error` severity tri-level on every finding: `verified-high | verified-low | plausible | unverifiable | suspect | incorrect`. SIFT's core insight — *"failing to find a source is not the same as the source not existing"* — demands a vocabulary that distinguishes `unverifiable` (source silent or unreachable) from `incorrect` (source directly contradicts prose). This matters most on the support check but is applied uniformly across checks so the composer and downstream logs have one schema. NPOV findings will in practice be `suspect` (style) or `incorrect` (BLP failure); coverage findings typically `suspect` (unbacked/overreach) or `unverifiable` (claim partial).
2. **Direct-quote requirement on the support check.** SIFT mandates a direct quote from fetched source content whenever a model flags support or contradiction — *"This proves you read the actual page rather than relying on assumptions."* Cheapest anti-hallucination technique in the SIFT playbook. Phase 6 adopts it for the support prompt and surfaces quotes in the composer output.
3. **No-training-data guardrail on coverage and support.** SIFT prompts are emphatic: *"never render a verdict based solely on your training data."* Phase 6's coverage check must only use the provided claims YAML (not the model's memory of who Jackie Fielder is); the support check must only use the fetched source text (not background knowledge of the publication). Added as explicit instructions in both prompts.

**What Friski does NOT need from SIFT:** the tool-calling investigation phase (we pre-fetch all sources), `web_search` and `web_fetch` infrastructure (we operate on Wayback snapshots supplied in the YAML), the blocked-domain list (Wayback sidesteps this), ensemble fanout across open-weight models (Sonnet alone is the MVP model; ensemble is a documented future upgrade), and the systematic ground-truth eval loop (Phase 6's acceptance is operator-judged on four handcrafted fixtures; a labeled corpus is future work). Also **not inherited: blind-truncation source fetching.** SIFT truncates because it runs against small open-weight models with tight context budgets; Sonnet 4.6 handles the full article without truncation, so `defaultFetch` passes the entire source text to the support check.

**Tech Stack:** `@anthropic-ai/sdk`, `@octokit/rest`, native `fetch` for archive URLs, js-yaml for response parsing, existing content loaders from Phase 2.

**Scope:** 6 of 7 phases from `plans/design-plans/2026-04-20-mvp.md`.

**Codebase verified:** 2026-04-20 — plan-writing time. Phase 6 assumes Phases 1–5 executed: validator, subject graph, page templates, tooling, and real seed content in `frisco-wiki`.

**Model:** default to `claude-sonnet-4-6` (good cost/quality for editorial reasoning). Make the model pin a constant at the top of `scripts/reviewer/llm.ts` so upgrades are one-line.

---

## Task 1: Reviewer scaffolding + LLM client

**Files:**
- Modify: `package.json` (add `@anthropic-ai/sdk`, `@octokit/rest`)
- Create: `scripts/reviewer/types.ts`
- Create: `scripts/reviewer/llm.ts`
- Create: `scripts/reviewer/context.ts`
- Create: `tests/reviewer/llm.test.ts`

No `scripts/reviewer/cache/` directory; content-hash caching is deferred past MVP (see architecture note above).

**Step 1: Install deps**

```bash
npm install @anthropic-ai/sdk @octokit/rest
```

**Step 2: Create `scripts/reviewer/types.ts`**

```typescript
import type { SubjectGraph, ArticleNode } from '../../src/lib/subject-graph';

// SIFT 6-class ordinal. Ordered from "strongly supports" to "directly contradicts".
// `verified-high` and `verified-low` rarely appear in emitted findings (findings are
// problems worth surfacing), but the vocabulary is stable across checks so downstream
// composers and logs have one schema. See architecture note for mapping per check.
export type FindingVerdict =
  | 'verified-high'
  | 'verified-low'
  | 'plausible'
  | 'unverifiable'
  | 'suspect'
  | 'incorrect';

export interface Finding {
  check: 'coverage' | 'support' | 'npov';
  file: string;                    // e.g., "articles/jackie-fielder.md"
  line?: number;                   // optional; if the check can point at a line
  verdict: FindingVerdict;
  message: string;                 // short, actionable
  assertion?: string;              // the prose snippet being flagged, if applicable
  quote?: string;                  // direct quote from fetched source (support check only)
}

export interface CheckContext {
  graph: SubjectGraph;
  article: ArticleNode;
  articleFile: string;             // relative path from content root, for finding.file
  editorialPrinciples: string;     // text of docs/editorial-principles.md
}

export interface CheckResult {
  check: Finding['check'];
  findings: Finding[];
  errors: string[];                // transport errors, parse failures — NOT editorial findings
}

export interface ReviewResult {
  results: CheckResult[];
  totalFindings: number;
  hasErrors: boolean;
}
```

**Step 3: Create `scripts/reviewer/llm.ts`**

The wrapper: pins model and temperature, supports prompt caching on a system block, returns parsed YAML findings.

```typescript
import Anthropic from '@anthropic-ai/sdk';
import yaml from 'js-yaml';
import type { FindingVerdict } from './types';

export const REVIEWER_MODEL = 'claude-sonnet-4-6';
export const REVIEWER_TEMPERATURE = 0;
export const REVIEWER_MAX_TOKENS = 4096;

const VALID_VERDICTS: ReadonlyArray<FindingVerdict> = [
  'verified-high',
  'verified-low',
  'plausible',
  'unverifiable',
  'suspect',
  'incorrect',
];

export interface CallOptions {
  systemPrompt: string;
  cachedSystemContext?: string;  // e.g., editorial-principles.md — gets cache_control
  userPrompt: string;
}

export interface RawFinding {
  verdict: FindingVerdict;
  message: string;
  assertion?: string;
  quote?: string;
  line?: number;
}

export interface LLMClient {
  callForFindings(opts: CallOptions): Promise<{ findings: RawFinding[]; errors: string[] }>;
}

export function makeLLMClient(apiKey: string = process.env.ANTHROPIC_API_KEY ?? ''): LLMClient {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });

  return {
    async callForFindings(opts) {
      // Every stable system block gets cache_control. Anthropic allows up to 4
      // cache breakpoints per request; we use at most 2 here. Blocks below the
      // model's minimum cacheable size (Sonnet: 1024 tokens) are a no-op —
      // that's fine, it costs nothing to mark them.
      const system: Anthropic.TextBlockParam[] = [{
        type: 'text',
        text: opts.systemPrompt,
        cache_control: { type: 'ephemeral' },
      }];
      if (opts.cachedSystemContext) {
        system.push({
          type: 'text',
          text: opts.cachedSystemContext,
          cache_control: { type: 'ephemeral' },
        });
      }

      const response = await client.messages.create({
        model: REVIEWER_MODEL,
        max_tokens: REVIEWER_MAX_TOKENS,
        temperature: REVIEWER_TEMPERATURE,
        system,
        messages: [{ role: 'user', content: opts.userPrompt }],
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      return parseFindings(text);
    },
  };
}

// Parse the YAML block from a response. Accept both `findings: []` and bare list forms.
// If parsing fails, return an error (don't throw) — the caller will surface it.
export function parseFindings(text: string): { findings: RawFinding[]; errors: string[] } {
  // Extract YAML: either wrapped in ```yaml ... ``` or the entire message.
  const fenceMatch = text.match(/```(?:yaml)?\s*\n([\s\S]*?)\n```/);
  const yamlText = fenceMatch ? fenceMatch[1]! : text;

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlText);
  } catch (e) {
    return { findings: [], errors: [`YAML parse error: ${(e as Error).message}`] };
  }

  if (parsed == null) return { findings: [], errors: [] };

  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { findings?: unknown }).findings;

  if (!Array.isArray(list)) {
    return { findings: [], errors: ['Response did not contain an array of findings'] };
  }

  const findings: RawFinding[] = [];
  const errors: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const f = raw as Record<string, unknown>;
    if (typeof f.message !== 'string') {
      errors.push(`Skipping finding without message: ${JSON.stringify(f)}`);
      continue;
    }
    // Fall back to `plausible` (the middle/ambiguous verdict) when the model
    // emits something we don't recognize. This is a deliberately soft default:
    // unrecognized verdicts should surface to the reviewer, not be silently
    // dropped, but shouldn't be escalated to `suspect` or `incorrect` either.
    const verdict: FindingVerdict =
      typeof f.verdict === 'string' && (VALID_VERDICTS as readonly string[]).includes(f.verdict)
        ? (f.verdict as FindingVerdict)
        : 'plausible';
    findings.push({
      verdict,
      message: f.message,
      assertion: typeof f.assertion === 'string' ? f.assertion : undefined,
      quote: typeof f.quote === 'string' ? f.quote : undefined,
      line: typeof f.line === 'number' ? f.line : undefined,
    });
  }

  return { findings, errors };
}
```

**Step 4: Create `scripts/reviewer/context.ts`**

Helpers to load PR context from either GH Actions env or CLI args, and to build the shared `CheckContext` per article.

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { subjectSchema, articleSchema } from '../../src/content.config';
import { buildSubjectGraph } from '../../src/lib/subject-graph';
import type { CheckContext } from './types';

export interface PRContext {
  repo: { owner: string; name: string };
  prNumber: number;
  changedFiles: string[];
  dryRun: boolean;
}

export function loadPRContextFromEnv(): PRContext | null {
  // GitHub Actions populates these.
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!eventPath || !repo || !existsSync(eventPath)) return null;

  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const prNumber: number = event.pull_request?.number ?? event.number;
  if (!prNumber) return null;

  const [owner, name] = repo.split('/');
  return {
    repo: { owner: owner!, name: name! },
    prNumber,
    changedFiles: [],   // populated separately via octokit or a prior step
    dryRun: false,
  };
}

export interface LoadedContent {
  contextByArticle: Map<string, CheckContext>;
  editorialPrinciples: string;
}

export function loadContent(
  contentRoot: string,
  allowedTypesPath: string,
  editorialPrinciplesPath: string,
): LoadedContent {
  const allowedTypes = (
    yaml.load(readFileSync(allowedTypesPath, 'utf8')) as { allowed_types: string[] }
  ).allowed_types;

  const subjectsDir = join(contentRoot, 'subjects');
  const articlesDir = join(contentRoot, 'articles');

  const subjects = readdirSyncFiltered(subjectsDir, '.yaml', '.yml').map((f) => {
    const data = subjectSchema.parse(yaml.load(readFileSync(join(subjectsDir, f), 'utf8')));
    return { id: data.id, data };
  });

  const articles = readdirSyncFiltered(articlesDir, '.md').map((f) => {
    const parsed = matter(readFileSync(join(articlesDir, f), 'utf8'));
    const data = articleSchema.parse(parsed.data);
    return { id: data.slug, data, body: parsed.content, file: `articles/${f}` };
  });

  const graph = buildSubjectGraph(
    subjects,
    articles.map(({ id, data, body }) => ({ id, data, body })),
    allowedTypes,
  );

  const editorialPrinciples = readFileSync(editorialPrinciplesPath, 'utf8');

  const contextByArticle = new Map<string, CheckContext>();
  for (const a of articles) {
    const article = graph.articles.get(a.id);
    if (!article) continue;
    contextByArticle.set(a.file, {
      graph,
      article,
      articleFile: a.file,
      editorialPrinciples,
    });
  }

  return { contextByArticle, editorialPrinciples };
}

function readdirSyncFiltered(dir: string, ...exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  const fs = require('node:fs') as typeof import('node:fs');
  return fs.readdirSync(dir).filter((f) => exts.some((e) => f.endsWith(e)));
}

export { resolve };
```

**Step 5: Write a unit test for the parser at `tests/reviewer/llm.test.ts`**

```typescript
import { describe, expect, test } from 'vitest';
import { parseFindings } from '../../scripts/reviewer/llm';

describe('parseFindings', () => {
  test('parses fenced YAML array with SIFT verdict', () => {
    const text = '```yaml\n- verdict: suspect\n  message: "Missing claim for Fielder"\n```';
    const { findings, errors } = parseFindings(text);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toBe('Missing claim for Fielder');
    expect(findings[0]!.verdict).toBe('suspect');
    expect(errors).toEqual([]);
  });

  test('parses findings key form', () => {
    const text = 'findings:\n  - message: "x"\n    verdict: incorrect';
    const { findings } = parseFindings(text);
    expect(findings[0]!.verdict).toBe('incorrect');
  });

  test('defaults verdict to plausible when omitted or invalid', () => {
    const text = '- message: "y"\n- verdict: nonsense\n  message: "z"';
    const { findings } = parseFindings(text);
    expect(findings[0]!.verdict).toBe('plausible');
    expect(findings[1]!.verdict).toBe('plausible');
  });

  test('preserves direct quote from support-check findings', () => {
    const text = '- verdict: incorrect\n  message: "Source contradicts"\n  assertion: "won by landslide"\n  quote: "won the runoff 52-48"';
    const { findings } = parseFindings(text);
    expect(findings[0]!.quote).toBe('won the runoff 52-48');
    expect(findings[0]!.assertion).toBe('won by landslide');
  });

  test('accepts all six SIFT verdict values', () => {
    const verdicts = ['verified-high', 'verified-low', 'plausible', 'unverifiable', 'suspect', 'incorrect'];
    for (const v of verdicts) {
      const { findings } = parseFindings(`- verdict: ${v}\n  message: "x"`);
      expect(findings[0]!.verdict).toBe(v);
    }
  });

  test('returns errors for unparseable YAML', () => {
    const { findings, errors } = parseFindings('not: valid: yaml: here');
    expect(findings).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });

  test('empty response yields empty findings and no errors', () => {
    expect(parseFindings('')).toEqual({ findings: [], errors: [] });
  });
});
```

**Step 6: Run tests**

Run: `npm test -- reviewer/llm`
Expected: all 7 tests pass.

**Step 7: Commit**

```bash
git add package.json package-lock.json scripts/reviewer/ tests/reviewer/
git commit -m "feat: reviewer scaffolding, LLM client wrapper, response parser"
```

---

## Task 2: Claim coverage check

**Files:**
- Create: `scripts/reviewer/prompts/coverage.ts`
- Create: `scripts/reviewer/checks/coverage.ts`
- Create: `tests/reviewer/coverage.test.ts`

**Step 1: Create the coverage prompt at `scripts/reviewer/prompts/coverage.ts`**

```typescript
export const COVERAGE_SYSTEM = `You are an editorial reviewer for Friski, a structured civic wiki for San Francisco. Your job on the CLAIM COVERAGE check is narrow and specific:

For each factual assertion in the article prose, determine whether it is backed by at least one structured claim on one of the subjects the article references.

**Evidence discipline (non-negotiable):**
- Use ONLY the claims provided in the "Referenced subjects" YAML below as your basis for what is "backed."
- Do NOT rely on your training data or background knowledge about any of these subjects, people, or events. You may happen to "know" that a politician held a position or that an event occurred, but if it is not in the provided claims YAML, it is NOT backed for the purposes of this check.
- The goal is to flag assertions that the wiki's own structured data cannot support — not to fact-check the world.

**What to flag:**
- A "factual assertion" is a sentence or clause that states something about the world as if it were fact (dates, positions held, relationships, events, attributions).
- Opinion and characterization that a cited source itself voices — attributed clearly in the prose — is NOT a factual assertion Friski must back with a claim. (The source-support check handles that.)
- Prose may ASSERT MORE than any claim supports (overreach). Flag these.
- Prose may assert something the subject has no claim for. Flag these.

**Verdict vocabulary (SIFT 6-class ordinal):**
Each finding must carry a \`verdict\` from this set:
  - \`suspect\` — a factual assertion in the prose has no matching claim in the YAML, OR the prose overreaches beyond what the claim actually says
  - \`unverifiable\` — a claim exists on the right subject but is partial/ambiguous relative to the prose; worth flagging as "claim needs strengthening before this prose is defensible"
  - \`incorrect\` — the prose asserts something that directly contradicts an existing claim (rare; most mismatches are \`suspect\` or \`unverifiable\`)
  - \`plausible\` — borderline cases you want the reviewer to look at but are not confident are wrong

Do NOT emit \`verified-high\` or \`verified-low\` findings on this check — findings are problems worth surfacing, not confirmations.

**Output format:**
Return findings as a YAML array. Each finding:
  - assertion: short quote from the prose
  - verdict: one of the four values above
  - message: what's wrong (missing claim, overreach, etc.) — one sentence, actionable

If every assertion is properly backed by the provided claims, return an empty array.

Output ONLY the YAML, wrapped in \`\`\`yaml ... \`\`\` fences. No prose before or after.`;

export function coverageUserPrompt(
  articleFile: string,
  articleBody: string,
  referencedSubjectsYaml: string,
): string {
  return `Article file: ${articleFile}

=== Article prose ===
${articleBody}

=== Referenced subjects (with their claims and sources) ===
${referencedSubjectsYaml}

Review the prose against the claims. Return YAML findings.`;
}
```

**Step 2: Create the check at `scripts/reviewer/checks/coverage.ts`**

```typescript
import yaml from 'js-yaml';
import type { CheckContext, CheckResult, Finding } from '../types';
import type { LLMClient } from '../llm';
import { COVERAGE_SYSTEM, coverageUserPrompt } from '../prompts/coverage';

export async function runCoverageCheck(
  ctx: CheckContext,
  llm: LLMClient,
): Promise<CheckResult> {
  const referenced = ctx.article.subjects
    .map((sid) => ctx.graph.subjects.get(sid))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  const subjectsYaml = yaml.dump(
    referenced.map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      claims: s.claims,
      sources: s.sources.map((src) => ({
        id: src.id,
        publication: src.publication,
        date_published: src.date_published,
        tier: src.tier,
      })),
    })),
    { lineWidth: -1 },
  );

  const { findings: raw, errors } = await llm.callForFindings({
    systemPrompt: COVERAGE_SYSTEM,
    userPrompt: coverageUserPrompt(ctx.articleFile, ctx.article.body, subjectsYaml),
  });

  const findings: Finding[] = raw.map((r) => ({
    check: 'coverage' as const,
    file: ctx.articleFile,
    verdict: r.verdict,
    message: r.message,
    assertion: r.assertion,
    line: r.line,
  }));

  return { check: 'coverage', findings, errors };
}
```

**Step 3: Write failing test at `tests/reviewer/coverage.test.ts`**

```typescript
import { describe, expect, test } from 'vitest';
import { runCoverageCheck } from '../../scripts/reviewer/checks/coverage';
import type { LLMClient } from '../../scripts/reviewer/llm';
import type { CheckContext } from '../../scripts/reviewer/types';

import type { FindingVerdict } from '../../scripts/reviewer/types';

function mockLLM(findings: Array<{ verdict: FindingVerdict; message: string; assertion?: string }>): LLMClient {
  return {
    callForFindings: async () => ({ findings, errors: [] }),
  };
}

function fakeContext(): CheckContext {
  return {
    graph: {
      subjects: new Map(),
      articles: new Map(),
      activeClaims: () => [],
      isLivingPerson: () => false,
      articlesReferencing: () => [],
    },
    article: {
      title: 'Test', slug: 'test', subjects: ['jackie-fielder'],
      primary_subject: 'jackie-fielder', scope: [], tags: [],
      body: 'Test article body.',
      footnotes: [],
    },
    articleFile: 'articles/test.md',
    editorialPrinciples: 'irrelevant for this test',
  };
}

describe('runCoverageCheck', () => {
  test('propagates findings with check=coverage, file from context, and SIFT verdict', async () => {
    const llm = mockLLM([{ verdict: 'suspect', message: 'Missing claim for X', assertion: 'X happened' }]);
    const result = await runCoverageCheck(fakeContext(), llm);
    expect(result.check).toBe('coverage');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.file).toBe('articles/test.md');
    expect(result.findings[0]!.check).toBe('coverage');
    expect(result.findings[0]!.verdict).toBe('suspect');
  });

  test('empty findings when LLM returns empty', async () => {
    const llm = mockLLM([]);
    const result = await runCoverageCheck(fakeContext(), llm);
    expect(result.findings).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
```

**Step 4: Run tests**

Run: `npm test -- reviewer/coverage`
Expected: 2 tests pass.

**Step 5: Commit**

```bash
git add scripts/reviewer/prompts/coverage.ts scripts/reviewer/checks/coverage.ts tests/reviewer/coverage.test.ts
git commit -m "feat: reviewer claim-coverage check"
```

---

## Task 3: Source support check

**Files:**
- Create: `scripts/reviewer/prompts/support.ts`
- Create: `scripts/reviewer/checks/support.ts`
- Create: `tests/reviewer/support.test.ts`

**Step 1: Create prompt at `scripts/reviewer/prompts/support.ts`**

```typescript
export const SUPPORT_SYSTEM = `You are an editorial reviewer for Friski. Your job on the SOURCE SUPPORT check is narrow:

Given a prose excerpt that cites a specific source, plus the fetched text of that source, judge whether the source actually supports the cited assertion.

**Evidence discipline (non-negotiable):**
- Use ONLY the fetched source text provided below as your basis for what the source says. Do NOT rely on training-data memory of the publication, the reporter, the subject, or the event. If the fact is not in the fetched text in front of you, the source does not support it — full stop.
- Every finding that claims "the source says X" or "the source does not say X" MUST include a direct quote from the fetched text in the \`quote\` field. This is mandatory; a finding without a quote is invalid. Quote verbatim — do not paraphrase into the \`quote\` field. (If the source is genuinely silent on the assertion, quote the most nearly-relevant passage you can find, or leave \`quote\` empty and say "source silent" in the message — silence is evidence of absence only when you have read the whole text.)

**What to flag:**
- A source supports an assertion if its text makes the same (or a broader) claim.
- A source fails to support if it's silent on the assertion, implies something weaker, or contradicts it.
- Overreach ("the source says X; the prose says MORE than X") is a flag.

**Verdict vocabulary (SIFT 6-class ordinal):**
Each finding must carry a \`verdict\` from this set:
  - \`incorrect\` — the fetched source text directly contradicts the prose assertion. Quote the contradicting passage.
  - \`suspect\` — the source says less than the prose claims (overreach), OR the source says something adjacent but importantly different. Quote the relevant passage.
  - \`unverifiable\` — the source is silent on the assertion, or the fetched text is too incomplete to judge (e.g., the page was behind a paywall and only a teaser was captured). Failing to find support is NOT the same as contradiction. Use this verdict liberally rather than escalating to \`suspect\` or \`incorrect\`.
  - \`plausible\` — borderline cases worth a reviewer's attention but not confident mismatches.

Do NOT emit \`verified-high\` or \`verified-low\` findings on this check.

**Output format:**
Return findings as a YAML array. Each finding:
  - assertion: the specific prose claim (short verbatim quote from the article)
  - verdict: one of the four values above
  - message: what the source does or doesn't say — one sentence, actionable
  - quote: verbatim excerpt from the fetched source text that justifies the verdict (mandatory for \`suspect\` / \`incorrect\`; optional but encouraged for \`unverifiable\` / \`plausible\`)

Empty array if all citations are well-supported by the fetched text.

Output ONLY the YAML, wrapped in \`\`\`yaml ... \`\`\` fences.`;

export function supportUserPrompt(
  articleFile: string,
  articleBody: string,
  sourceId: string,
  sourcePublication: string,
  sourceText: string,
): string {
  // No truncation. Sonnet 4.6's 200k context handles full-article source text;
  // wikidata-SIFT truncates to 15k/30k because it targets small open-weight
  // models with tight context budgets. Friski does not inherit that constraint.
  return `Article file: ${articleFile}
Cited source: ${sourceId} (${sourcePublication})

=== Article prose (look for citations to ${sourceId}) ===
${articleBody}

=== Fetched source text ===
${sourceText}

Review whether the source supports the prose assertions citing it. Every finding about what the source does or does not say must include a verbatim \`quote\` from the fetched text above. Return YAML findings.`;
}
```

**Step 2: Create the check at `scripts/reviewer/checks/support.ts`**

```typescript
import type { CheckContext, CheckResult, Finding } from '../types';
import type { LLMClient } from '../llm';
import { SUPPORT_SYSTEM, supportUserPrompt } from '../prompts/support';

export async function runSupportCheck(
  ctx: CheckContext,
  llm: LLMClient,
  fetchSource: (url: string) => Promise<string> = defaultFetch,
): Promise<CheckResult> {
  const findings: Finding[] = [];
  const errors: string[] = [];

  // Unique sources cited in this article (via resolved footnotes).
  const citedSources = new Map<string, { id: string; publication: string; url: string }>();
  for (const fn of ctx.article.footnotes) {
    citedSources.set(fn.sourceId, {
      id: fn.sourceId,
      publication: fn.source.publication,
      url: fn.source.archive.url,
    });
  }

  for (const source of citedSources.values()) {
    let sourceText: string;
    try {
      sourceText = await fetchSource(source.url);
    } catch (e) {
      errors.push(`Failed to fetch ${source.id} (${source.url}): ${(e as Error).message}`);
      continue;
    }

    const { findings: raw, errors: parseErrs } = await llm.callForFindings({
      systemPrompt: SUPPORT_SYSTEM,
      userPrompt: supportUserPrompt(
        ctx.articleFile,
        ctx.article.body,
        source.id,
        source.publication,
        sourceText,
      ),
    });
    errors.push(...parseErrs);
    for (const r of raw) {
      findings.push({
        check: 'support',
        file: ctx.articleFile,
        verdict: r.verdict,
        message: `[${source.id}] ${r.message}`,
        assertion: r.assertion,
        quote: r.quote,
      });
    }
  }

  return { check: 'support', findings, errors };
}

async function defaultFetch(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'friski-reviewer/0.0' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  // Strip HTML tags for LLM consumption. Quick-and-dirty; good enough for Wayback HTML.
  return text.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

**Step 3: Write failing test at `tests/reviewer/support.test.ts`**

```typescript
import { describe, expect, test, vi } from 'vitest';
import { runSupportCheck } from '../../scripts/reviewer/checks/support';
import type { LLMClient } from '../../scripts/reviewer/llm';
import type { CheckContext, FindingVerdict } from '../../scripts/reviewer/types';

function mockLLM(responses: Array<Array<{ verdict: FindingVerdict; message: string; quote?: string; assertion?: string }>>): LLMClient {
  let callNum = 0;
  return {
    callForFindings: async () => {
      const findings = responses[callNum++] ?? [];
      return { findings, errors: [] };
    },
  };
}

function contextWithFootnote(): CheckContext {
  const source = {
    id: 'ml-fielder', url: 'https://web.archive.org/web/20260420/https://missionlocal.org/f',
    publication: 'Mission Local', tier: 1 as const,
    archive: {
      url: 'https://web.archive.org/web/20260420/https://missionlocal.org/f',
      method: 'wayback' as const,
      access: 'public' as const,
    },
  };
  return {
    graph: {
      subjects: new Map(), articles: new Map(),
      activeClaims: () => [], isLivingPerson: () => false, articlesReferencing: () => [],
    },
    article: {
      title: 'T', slug: 't', subjects: ['jackie-fielder'],
      primary_subject: 'jackie-fielder', scope: [], tags: [],
      body: 'Fielder served on the Board.[^ml]\n[^ml]: ml-fielder',
      footnotes: [{ label: 'ml', subjectId: 'jackie-fielder', sourceId: 'ml-fielder', source }],
    },
    articleFile: 'articles/t.md',
    editorialPrinciples: '',
  };
}

describe('runSupportCheck', () => {
  test('prefixes findings with source id and preserves verdict + quote', async () => {
    const llm = mockLLM([[{
      verdict: 'unverifiable',
      message: 'Source does not mention the district',
      quote: 'Fielder was elected.',
      assertion: 'Fielder represents District 9',
    }]]);
    const fetchSource = vi.fn().mockResolvedValue('Fielder was elected.');
    const result = await runSupportCheck(contextWithFootnote(), llm, fetchSource);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.message).toContain('[ml-fielder]');
    expect(result.findings[0]!.verdict).toBe('unverifiable');
    expect(result.findings[0]!.quote).toBe('Fielder was elected.');
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  test('passes untruncated source text to LLM', async () => {
    const callForFindings = vi.fn().mockResolvedValue({ findings: [], errors: [] });
    const llm: LLMClient = { callForFindings };
    const longSource = 'x'.repeat(80_000);
    const fetchSource = vi.fn().mockResolvedValue(longSource);

    await runSupportCheck(contextWithFootnote(), llm, fetchSource);

    const userPrompt = callForFindings.mock.calls[0]![0].userPrompt as string;
    expect(userPrompt).toContain(longSource);
    expect(userPrompt).not.toContain('[truncated]');
  });

  test('records fetch failure as an error, not a finding', async () => {
    const llm = mockLLM([[]]);
    const fetchSource = vi.fn().mockRejectedValue(new Error('timeout'));
    const result = await runSupportCheck(contextWithFootnote(), llm, fetchSource);
    expect(result.findings).toEqual([]);
    expect(result.errors[0]).toMatch(/timeout/);
  });
});
```

**Step 4: Run tests**

Run: `npm test -- reviewer/support`
Expected: 3 tests pass.

**Step 5: Commit**

```bash
git add scripts/reviewer/prompts/support.ts scripts/reviewer/checks/support.ts tests/reviewer/support.test.ts
git commit -m "feat: reviewer source-support check with per-citation fetching"
```

---

## Task 4: NPOV check

**Files:**
- Create: `scripts/reviewer/prompts/npov.ts`
- Create: `scripts/reviewer/checks/npov.ts`
- Create: `tests/reviewer/npov.test.ts`

**Step 1: Create prompt at `scripts/reviewer/prompts/npov.ts`**

```typescript
export const NPOV_SYSTEM = `You are an editorial reviewer for Friski. Your job on the NPOV check is specific:

Review the article prose against Friski's editorial principles (provided separately). Flag:
  - Loaded language: "notorious", "infamous", "controversial" without attribution, "actually", "supposedly"
  - Unattributed advocacy: "critics say", "many believe", "some argue" without naming who
  - First-person or exhortative language in the prose voice
  - Synthetic consensus: stating a conclusion as fact when sources disagree
  - BLP failures: unsourced or weakly-sourced biographical claims about living people

**Verdict vocabulary (SIFT 6-class ordinal, adapted for style review):**
Each finding must carry a \`verdict\` from this set:
  - \`incorrect\` — BLP failure: an unsourced or weakly-sourced biographical claim about a living person. These are the highest-severity NPOV findings because they carry legal and ethical risk.
  - \`suspect\` — a clear style violation (loaded language, unattributed advocacy, first-person voice, synthetic consensus). The reviewer should expect to rewrite the prose.
  - \`plausible\` — borderline phrasing that a human reviewer should look at but might reasonably keep.

Do NOT emit \`verified-high\`, \`verified-low\`, or \`unverifiable\` findings on this check — NPOV findings are problems in the prose, not uncertainty about facts.

Return findings as a YAML array with fields: verdict, message, assertion (prose excerpt being flagged). Empty array when the prose is clean.

Output ONLY the YAML, wrapped in \`\`\`yaml ... \`\`\` fences.`;

export function npovUserPrompt(articleFile: string, articleBody: string): string {
  return `Article file: ${articleFile}

=== Article prose ===
${articleBody}

Review against the editorial principles in the system context. Return YAML findings.`;
}
```

**Step 2: Create the check at `scripts/reviewer/checks/npov.ts`**

```typescript
import type { CheckContext, CheckResult, Finding } from '../types';
import type { LLMClient } from '../llm';
import { NPOV_SYSTEM, npovUserPrompt } from '../prompts/npov';

export async function runNpovCheck(
  ctx: CheckContext,
  llm: LLMClient,
): Promise<CheckResult> {
  const { findings: raw, errors } = await llm.callForFindings({
    systemPrompt: NPOV_SYSTEM,
    cachedSystemContext: ctx.editorialPrinciples,  // prompt caching kicks in here
    userPrompt: npovUserPrompt(ctx.articleFile, ctx.article.body),
  });

  const findings: Finding[] = raw.map((r) => ({
    check: 'npov' as const,
    file: ctx.articleFile,
    verdict: r.verdict,
    message: r.message,
    assertion: r.assertion,
  }));

  return { check: 'npov', findings, errors };
}
```

**Step 3: Write failing test at `tests/reviewer/npov.test.ts`**

```typescript
import { describe, expect, test, vi } from 'vitest';
import { runNpovCheck } from '../../scripts/reviewer/checks/npov';
import type { LLMClient } from '../../scripts/reviewer/llm';
import type { CheckContext } from '../../scripts/reviewer/types';

function fakeContext(body: string): CheckContext {
  return {
    graph: { subjects: new Map(), articles: new Map(), activeClaims: () => [], isLivingPerson: () => false, articlesReferencing: () => [] },
    article: { title: 't', slug: 't', subjects: [], primary_subject: undefined, scope: [], tags: [], body, footnotes: [] },
    articleFile: 'articles/t.md',
    editorialPrinciples: 'NPOV principles: attribute everything.',
  };
}

describe('runNpovCheck', () => {
  test('passes editorial-principles as cachedSystemContext', async () => {
    const callForFindings = vi.fn().mockResolvedValue({ findings: [], errors: [] });
    const llm: LLMClient = { callForFindings };

    await runNpovCheck(fakeContext('Body.'), llm);

    expect(callForFindings).toHaveBeenCalledOnce();
    const call = callForFindings.mock.calls[0]![0];
    expect(call.cachedSystemContext).toContain('NPOV');
  });

  test('propagates findings tagged as npov with SIFT verdict', async () => {
    const llm: LLMClient = {
      callForFindings: async () => ({
        findings: [{ verdict: 'suspect', message: 'Loaded language: "notorious"', assertion: 'a notorious developer' }],
        errors: [],
      }),
    };
    const result = await runNpovCheck(fakeContext('The notorious developer...'), llm);
    expect(result.findings[0]!.check).toBe('npov');
    expect(result.findings[0]!.verdict).toBe('suspect');
    expect(result.findings[0]!.message).toMatch(/loaded/i);
  });
});
```

**Step 4: Run tests**

Run: `npm test -- reviewer/npov`
Expected: 2 tests pass.

**Step 5: Commit**

```bash
git add scripts/reviewer/prompts/npov.ts scripts/reviewer/checks/npov.ts tests/reviewer/npov.test.ts
git commit -m "feat: reviewer NPOV check with cached editorial-principles context"
```

---

## Task 5: Entry point, comment composer, CLI + fixture integration

**Files:**
- Create: `scripts/reviewer/compose.ts`
- Create: `scripts/reviewer/index.ts`
- Create: `tests/reviewer/compose.test.ts`
- Create: `tests/reviewer-fixtures/clean-baseline/` (a tiny corpus copy that mirrors seed content)
- Create: `tests/reviewer-fixtures/claim-less-assertion/` (article prose that asserts unbacked facts)
- Create: `tests/reviewer-fixtures/overreach/` (prose that overreaches beyond cited source)
- Create: `tests/reviewer-fixtures/advocacy-voice/` (prose with NPOV violations)
- Create: `tests/reviewer/integration.test.ts`
- Modify: `package.json` (add `reviewer` script)

**Step 1: Create `scripts/reviewer/compose.ts`**

```typescript
import type { ReviewResult, CheckResult, FindingVerdict } from './types';

const CHECK_LABEL: Record<CheckResult['check'], string> = {
  coverage: 'Claim coverage',
  support: 'Source support',
  npov: 'NPOV',
};

// Map each SIFT verdict to a display icon. Escalation runs left-to-right:
// verified-high → verified-low → plausible → unverifiable → suspect → incorrect.
// Findings are problems (rarely verified-*), but the mapping covers all six for
// completeness and for future positive-signal reporting.
const VERDICT_ICON: Record<FindingVerdict, string> = {
  'verified-high': '✅',
  'verified-low': '☑',
  plausible: 'ℹ',
  unverifiable: '❓',
  suspect: '⚠',
  incorrect: '✗',
};

const VERDICT_LABEL: Record<FindingVerdict, string> = {
  'verified-high': 'verified-high',
  'verified-low': 'verified-low',
  plausible: 'plausible',
  unverifiable: 'unverifiable',
  suspect: 'suspect',
  incorrect: 'incorrect',
};

export function composeComment(review: ReviewResult, model: string): string {
  const lines: string[] = [];
  const status = review.totalFindings === 0 && !review.hasErrors ? 'clean' : 'review';
  lines.push(`**Friski reviewer** · advisory · model: \`${model}\` · status: ${status}`);
  lines.push('');

  for (const r of review.results) {
    lines.push(`### ${CHECK_LABEL[r.check]}`);
    if (r.findings.length === 0 && r.errors.length === 0) {
      lines.push('✅ No findings.');
    } else {
      for (const f of r.findings) {
        const icon = VERDICT_ICON[f.verdict] ?? '·';
        const where = f.line ? `${f.file}:${f.line}` : f.file;
        const assertion = f.assertion ? `  \n> ${f.assertion}` : '';
        const sourceQuote = f.quote ? `  \n> > source: ${f.quote}` : '';
        lines.push(`- ${icon} \`${where}\` · **${VERDICT_LABEL[f.verdict]}** — ${f.message}${assertion}${sourceQuote}`);
      }
      for (const e of r.errors) {
        lines.push(`- 🔧 reviewer error: ${e}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
```

**Step 2: Create `scripts/reviewer/index.ts`**

```typescript
#!/usr/bin/env tsx
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { Octokit } from '@octokit/rest';
import { makeLLMClient, REVIEWER_MODEL } from './llm';
import { loadContent, loadPRContextFromEnv } from './context';
import { runCoverageCheck } from './checks/coverage';
import { runSupportCheck } from './checks/support';
import { runNpovCheck } from './checks/npov';
import { composeComment } from './compose';
import type { CheckResult, ReviewResult } from './types';

interface RunOptions {
  contentRoot: string;
  allowedTypesPath: string;
  editorialPrinciplesPath: string;
  changedArticles?: string[];   // restrict review to these article files; default: all
}

export async function runReview(opts: RunOptions): Promise<ReviewResult> {
  const { contextByArticle } = loadContent(
    opts.contentRoot,
    opts.allowedTypesPath,
    opts.editorialPrinciplesPath,
  );

  const targets = opts.changedArticles
    ? opts.changedArticles.filter((f) => contextByArticle.has(f))
    : Array.from(contextByArticle.keys());

  const llm = makeLLMClient();
  const results: CheckResult[] = [];

  for (const file of targets) {
    const ctx = contextByArticle.get(file)!;
    const [cov, npov] = await Promise.all([
      runCoverageCheck(ctx, llm),
      runNpovCheck(ctx, llm),
    ]);
    const sup = await runSupportCheck(ctx, llm);
    results.push(cov, sup, npov);
  }

  const totalFindings = results.reduce((n, r) => n + r.findings.length, 0);
  const hasErrors = results.some((r) => r.errors.length > 0);
  return { results, totalFindings, hasErrors };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'content-root': { type: 'string', default: 'src/content/wiki' },
      'allowed-types': { type: 'string', default: 'config/allowed-types.yaml' },
      'editorial-principles': { type: 'string', default: 'docs/editorial-principles.md' },
      'changed-files': { type: 'string' },   // comma-separated article files
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const changedArticles = values['changed-files']
    ? values['changed-files'].split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  const review = await runReview({
    contentRoot: resolve(values['content-root']!),
    allowedTypesPath: resolve(values['allowed-types']!),
    editorialPrinciplesPath: resolve(values['editorial-principles']!),
    changedArticles,
  });

  const comment = composeComment(review, REVIEWER_MODEL);

  if (values['dry-run']) {
    console.log(comment);
    return;
  }

  // Post to GitHub
  const prCtx = loadPRContextFromEnv();
  if (!prCtx) {
    console.error('No PR context found; printing instead of posting.');
    console.log(comment);
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN not set; printing instead of posting.');
    console.log(comment);
    return;
  }

  const octokit = new Octokit({ auth: token });
  await octokit.issues.createComment({
    owner: prCtx.repo.owner,
    repo: prCtx.repo.name,
    issue_number: prCtx.prNumber,
    body: comment,
  });
  console.log(`Posted review to PR #${prCtx.prNumber}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

**Step 3: Add `reviewer` npm script to `package.json`**

```json
"reviewer": "tsx scripts/reviewer/index.ts"
```

**Step 4: Create fixture corpora in `tests/reviewer-fixtures/`**

Each fixture is a minimal `subjects/` + `articles/` + `allowed-types.yaml` + `editorial-principles.md` directory the integration test points at.

Structure:

```
tests/reviewer-fixtures/
├── clean-baseline/
│   ├── subjects/jackie-fielder.yaml        # copy from seed (or synthesized)
│   ├── articles/jackie-fielder.md          # well-formed; cites existing source
│   ├── allowed-types.yaml
│   └── editorial-principles.md             # copy of docs/editorial-principles.md
├── claim-less-assertion/
│   ├── subjects/jackie-fielder.yaml        # has P39 claim
│   ├── articles/jackie-fielder.md          # asserts "Fielder chairs Land Use" with NO claim for it
│   └── ...
├── overreach/
│   ├── ...                                 # source says "won runoff"; prose says "won by landslide"
└── advocacy-voice/
    ├── ...                                 # prose with "notorious developer", "critics argue"
```

Populate each with minimal YAML/Markdown matching the shape of the seed corpus but shaped to exercise the specific failure.

**Step 5: Write integration tests at `tests/reviewer/integration.test.ts`**

```typescript
import { describe, expect, test, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runReview } from '../../scripts/reviewer/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(__dirname, '..', 'reviewer-fixtures');

// Mock the LLM client module to return canned findings per fixture.
// This is an integration test of orchestration, NOT a live-API test.
vi.mock('../../scripts/reviewer/llm', async () => {
  const actual = await vi.importActual<typeof import('../../scripts/reviewer/llm')>('../../scripts/reviewer/llm');
  return {
    ...actual,
    makeLLMClient: () => ({
      callForFindings: async ({ systemPrompt, userPrompt }: { systemPrompt: string; userPrompt: string }) => {
        // Decide findings based on which check (system prompt) and which fixture (user prompt content).
        const isCoverage = systemPrompt.includes('CLAIM COVERAGE');
        const isSupport = systemPrompt.includes('SOURCE SUPPORT');
        const isNpov = systemPrompt.includes('NPOV');

        if (userPrompt.includes('claim-less-assertion') && isCoverage) {
          return { findings: [{ verdict: 'suspect', message: 'No claim backs this assertion', assertion: 'Fielder chairs' }], errors: [] };
        }
        if (userPrompt.includes('overreach') && isSupport) {
          return { findings: [{ verdict: 'suspect', message: 'Prose says more than source supports', assertion: 'landslide', quote: 'won the runoff 52-48' }], errors: [] };
        }
        if (userPrompt.includes('advocacy-voice') && isNpov) {
          return { findings: [{ verdict: 'suspect', message: 'Loaded language: "notorious"', assertion: 'notorious developer' }], errors: [] };
        }
        return { findings: [], errors: [] };
      },
    }),
  };
});

function fixturePaths(name: string) {
  const root = join(fixturesRoot, name);
  return {
    contentRoot: root,
    allowedTypesPath: join(root, 'allowed-types.yaml'),
    editorialPrinciplesPath: join(root, 'editorial-principles.md'),
  };
}

describe('reviewer integration (mocked LLM)', () => {
  test('clean baseline produces zero findings', async () => {
    const review = await runReview(fixturePaths('clean-baseline'));
    expect(review.totalFindings).toBe(0);
    expect(review.hasErrors).toBe(false);
  });

  test('claim-less-assertion fixture produces a coverage finding', async () => {
    const review = await runReview(fixturePaths('claim-less-assertion'));
    const coverage = review.results.find((r) => r.check === 'coverage');
    expect(coverage!.findings.length).toBeGreaterThan(0);
  });

  test('overreach fixture produces a support finding', async () => {
    const review = await runReview(fixturePaths('overreach'));
    const support = review.results.find((r) => r.check === 'support');
    expect(support!.findings.length).toBeGreaterThan(0);
  });

  test('advocacy-voice fixture produces an NPOV finding', async () => {
    const review = await runReview(fixturePaths('advocacy-voice'));
    const npov = review.results.find((r) => r.check === 'npov');
    expect(npov!.findings.length).toBeGreaterThan(0);
  });
});
```

Note: the `support` check in the overreach fixture will attempt a real network fetch unless the fixture source uses a mock URL that `defaultFetch` handles. The simplest workaround is to wire the integration test to inject a stub `fetchSource` via a second `runReview` variant or to mock `globalThis.fetch`. Executor: pick whichever is cleanest; the test must not hit the network.

**Step 6: Write composer test at `tests/reviewer/compose.test.ts`**

```typescript
import { describe, expect, test } from 'vitest';
import { composeComment } from '../../scripts/reviewer/compose';

describe('composeComment', () => {
  test('renders clean status on zero findings', () => {
    const out = composeComment(
      {
        results: [
          { check: 'coverage', findings: [], errors: [] },
          { check: 'support', findings: [], errors: [] },
          { check: 'npov', findings: [], errors: [] },
        ],
        totalFindings: 0,
        hasErrors: false,
      },
      'claude-sonnet-4-6',
    );
    expect(out).toMatch(/status: clean/);
    expect(out).toMatch(/No findings/);
  });

  test('renders finding with file, verdict icon + label, and assertion quote', () => {
    const out = composeComment(
      {
        results: [
          { check: 'coverage', findings: [{ check: 'coverage', file: 'articles/x.md', verdict: 'suspect', message: 'Missing claim', assertion: 'Fielder chairs Land Use' }], errors: [] },
          { check: 'support', findings: [], errors: [] },
          { check: 'npov', findings: [], errors: [] },
        ],
        totalFindings: 1,
        hasErrors: false,
      },
      'claude-sonnet-4-6',
    );
    expect(out).toContain('⚠');
    expect(out).toContain('suspect');
    expect(out).toContain('articles/x.md');
    expect(out).toContain('Missing claim');
    expect(out).toContain('> Fielder chairs Land Use');
  });

  test('renders source quote on support findings', () => {
    const out = composeComment(
      {
        results: [
          { check: 'coverage', findings: [], errors: [] },
          { check: 'support', findings: [{ check: 'support', file: 'articles/x.md', verdict: 'incorrect', message: '[ml-x] Source contradicts prose', assertion: 'won by landslide', quote: 'won the runoff 52-48' }], errors: [] },
          { check: 'npov', findings: [], errors: [] },
        ],
        totalFindings: 1,
        hasErrors: false,
      },
      'claude-sonnet-4-6',
    );
    expect(out).toContain('✗');
    expect(out).toContain('incorrect');
    expect(out).toContain('> won by landslide');
    expect(out).toContain('source: won the runoff 52-48');
  });

  test('renders unverifiable distinctly from suspect', () => {
    const out = composeComment(
      {
        results: [
          { check: 'coverage', findings: [], errors: [] },
          { check: 'support', findings: [{ check: 'support', file: 'articles/x.md', verdict: 'unverifiable', message: '[ml-x] Source silent on assertion', assertion: 'Fielder was endorsed by DSA' }], errors: [] },
          { check: 'npov', findings: [], errors: [] },
        ],
        totalFindings: 1,
        hasErrors: false,
      },
      'claude-sonnet-4-6',
    );
    expect(out).toContain('❓');
    expect(out).toContain('unverifiable');
    expect(out).not.toContain('suspect');
  });
});
```

**Step 7: Run the entire suite**

Run: `npm test`
Expected: all tests pass — earlier phase tests plus reviewer unit tests plus the four integration-fixture assertions.

**Step 8: Dry-run smoke against the seed corpus**

```bash
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY npm run reviewer -- --dry-run
```

(The operator needs a real `ANTHROPIC_API_KEY` in their environment or a `.env` the harness picks up.)

Expected: prints a `**Friski reviewer** ...` markdown comment. Luis judges findings *actionable and honest* — not flattery, not noise. Zero findings on clean seed content is acceptable.

**Step 9: Commit**

```bash
git add scripts/reviewer/ tests/reviewer/ tests/reviewer-fixtures/ package.json
git commit -m "feat: reviewer MVP with three checks, comment composer, and fixture tests"
```

---

## Done when

- `scripts/reviewer/` contains three independent check modules (`coverage`, `support`, `npov`) plus a shared LLM client wrapper with pinned model, `temperature: 0`, and prompt caching on every stable system block (per-check system prompt + editorial-principles where applicable).
- **SIFT 6-class verdict ordinal (`verified-high | verified-low | plausible | unverifiable | suspect | incorrect`) is the sole severity vocabulary across all three checks.** No finding carries an `info | warn | error` severity; the composer and all tests use the SIFT ordinal. The parser defaults unrecognized verdicts to `plausible`. Both `unverifiable` and `incorrect` are reachable and rendered distinctly in the composed comment (the "failing to find a source ≠ source contradicts" distinction must be preserved end-to-end).
- **Support-check findings include a `quote` field** carrying a verbatim excerpt from the fetched source text. The prompt mandates a quote for `suspect` and `incorrect` verdicts; the composer renders the quote below the flagged assertion. A composer test verifies source quotes are rendered.
- **No-training-data guardrail** is present in the coverage and support system prompts (explicit "use only the provided claims YAML / fetched source text; do not rely on training data").
- **No truncation on the support-check source text.** `supportUserPrompt` passes the full fetched source to the LLM; Sonnet 4.6's context window handles it. A unit test on `runSupportCheck` verifies an 80,000-character source is passed through without truncation.
- `npm run reviewer -- --dry-run` against the seed corpus produces a composed markdown comment; Luis judges the findings *actionable and honest* (not flattery, not noise). Zero findings on clean seed content is an acceptable outcome.
- Each of the four fixture corpora in `tests/reviewer-fixtures/` triggers at least one correctly-pointed finding from the check that was designed to catch it:
  - `claim-less-assertion` → coverage finding with `verdict: suspect` (or `unverifiable`)
  - `overreach` → support finding with `verdict: suspect` (or `incorrect`) and a source `quote`
  - `advocacy-voice` → NPOV finding with `verdict: suspect`
  - `clean-baseline` → zero findings
- The reviewer exits cleanly on: missing ANTHROPIC_API_KEY (fails fast with a clear error), LLM response that isn't valid YAML (recorded as a reviewer error, not a crash), source fetch failure (recorded as a reviewer error, check continues on other sources), missing PR context (falls back to printing the comment).
- The composed PR comment is well-formed GitHub-flavored markdown with per-check sections, verdict icons + verdict labels, file paths, quoted assertions, and source quotes for support findings.
- Unit tests cover the YAML parser (including all six verdict values and the `plausible` fallback), each individual check's orchestration (with mocked LLM), the untruncated-source-text pass-through on the support check, and the comment composer (including `unverifiable` rendering distinctly from `suspect`).
- Integration tests run the full `runReview()` orchestration with a mocked LLM against each fixture corpus.
- No test hits the live Anthropic API; the `--dry-run` smoke is an operator-run verification, not a CI step.
- Each task committed independently.
