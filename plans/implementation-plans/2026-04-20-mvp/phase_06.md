# Friski MVP Implementation Plan — Phase 6: Reviewer MVP

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.
>
> **CONDITIONAL SKILL:** Activate `claude-api` when implementing the LLM client wrapper — it has current guidance on SDK usage, prompt caching, and model selection.

**Goal:** A Node-based reviewer that collects a PR's changed content, runs three LLM-backed checks (claim coverage, source support, NPOV), composes a single structured PR comment, and produces findings Luis judges actionable and honest on both the clean seed corpus and deliberately-flawed fixture PRs.

**Architecture:** Three independent check modules share a small LLM client wrapper (`scripts/reviewer/llm.ts`) that pins the model and temperature, applies prompt caching for the editorial-principles doc, and returns structured findings. The entry point (`scripts/reviewer/index.ts`) reads PR context from either GitHub Actions env vars or CLI flags, runs the three checks, and posts one comment (or prints it in `--dry-run`). Coverage runs first (cheap, no network); support runs second only on assertions that passed coverage; NPOV runs in parallel with coverage. **Content-hash-keyed caching is deferred past MVP** — the reviewer runs every check fresh. Anthropic's prompt caching (5-min TTL on the `cached_system_context` block) gives most of the cost benefit with zero implementation effort; cross-run content caching is a future optimization, not Phase 0 scope.

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

export type FindingSeverity = 'info' | 'warn' | 'error';

export interface Finding {
  check: 'coverage' | 'support' | 'npov';
  file: string;                    // e.g., "articles/jackie-fielder.md"
  line?: number;                   // optional; if the check can point at a line
  severity: FindingSeverity;
  message: string;                 // short, actionable
  assertion?: string;              // the prose snippet being flagged, if applicable
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

export const REVIEWER_MODEL = 'claude-sonnet-4-6';
export const REVIEWER_TEMPERATURE = 0;
export const REVIEWER_MAX_TOKENS = 4096;

export interface CallOptions {
  systemPrompt: string;
  cachedSystemContext?: string;  // e.g., editorial-principles.md — gets cache_control
  userPrompt: string;
}

export interface RawFinding {
  severity: 'info' | 'warn' | 'error';
  message: string;
  assertion?: string;
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
      const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: opts.systemPrompt }];
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
    const severity = (f.severity === 'info' || f.severity === 'warn' || f.severity === 'error')
      ? f.severity
      : 'warn';
    findings.push({
      severity,
      message: f.message,
      assertion: typeof f.assertion === 'string' ? f.assertion : undefined,
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
  test('parses fenced YAML array', () => {
    const text = '```yaml\n- severity: warn\n  message: "Missing claim for Fielder"\n```';
    const { findings, errors } = parseFindings(text);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toBe('Missing claim for Fielder');
    expect(findings[0]!.severity).toBe('warn');
    expect(errors).toEqual([]);
  });

  test('parses findings key form', () => {
    const text = 'findings:\n  - message: "x"\n    severity: error';
    const { findings } = parseFindings(text);
    expect(findings[0]!.severity).toBe('error');
  });

  test('defaults severity to warn when omitted or invalid', () => {
    const text = '- message: "y"';
    const { findings } = parseFindings(text);
    expect(findings[0]!.severity).toBe('warn');
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
Expected: all 5 tests pass.

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

- A "factual assertion" is a sentence or clause that states something about the world as if it were fact (dates, positions held, relationships, events, attributions).
- Opinion and characterization that a cited source itself voices — attributed clearly in the prose — is NOT a factual assertion Friski must back with a claim. (The source-support check handles that.)
- Prose may ASSERT MORE than any claim supports (overreach). Flag these.
- Prose may assert something the subject has no claim for. Flag these.

Return findings as a YAML array. Each finding has:
  - assertion: short quote from the prose
  - message: what's wrong (missing claim, overreach, etc.)
  - severity: 'warn' for unbacked or overreached; 'info' for borderline cases worth a look

If every assertion is properly backed, return an empty array.

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
    severity: r.severity,
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

function mockLLM(findings: Array<{ severity: 'warn' | 'error' | 'info'; message: string; assertion?: string }>): LLMClient {
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
  test('propagates findings with check=coverage and file from context', async () => {
    const llm = mockLLM([{ severity: 'warn', message: 'Missing claim for X', assertion: 'X happened' }]);
    const result = await runCoverageCheck(fakeContext(), llm);
    expect(result.check).toBe('coverage');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.file).toBe('articles/test.md');
    expect(result.findings[0]!.check).toBe('coverage');
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

- A source supports an assertion if its text makes the same (or a broader) claim.
- A source fails to support if it's silent on the assertion, implies something weaker, or contradicts it.
- Overreach ("the source says X; the prose says MORE than X") is a flag.

Return findings as a YAML array. Each finding:
  - assertion: the specific prose claim
  - message: what the source does or doesn't say
  - severity: 'warn' for mismatches/overreaches; 'error' if the source actively contradicts the prose

Empty array if all citations are well-supported.

Output ONLY the YAML, wrapped in \`\`\`yaml ... \`\`\` fences.`;

export function supportUserPrompt(
  articleFile: string,
  articleBody: string,
  sourceId: string,
  sourcePublication: string,
  sourceText: string,
): string {
  return `Article file: ${articleFile}
Cited source: ${sourceId} (${sourcePublication})

=== Article prose (look for citations to ${sourceId}) ===
${articleBody}

=== Fetched source text ===
${sourceText.slice(0, 30000)}
${sourceText.length > 30000 ? '\n[truncated]' : ''}

Review whether the source supports the prose assertions citing it. Return YAML findings.`;
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
        severity: r.severity,
        message: `[${source.id}] ${r.message}`,
        assertion: r.assertion,
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
import type { CheckContext } from '../../scripts/reviewer/types';

function mockLLM(responses: Array<Array<{ severity: 'warn' | 'error' | 'info'; message: string }>>): LLMClient {
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
  test('prefixes findings with source id', async () => {
    const llm = mockLLM([[{ severity: 'warn', message: 'Source does not mention the district' }]]);
    const fetchSource = vi.fn().mockResolvedValue('Fielder was elected.');
    const result = await runSupportCheck(contextWithFootnote(), llm, fetchSource);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.message).toContain('[ml-fielder]');
    expect(fetchSource).toHaveBeenCalledTimes(1);
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
Expected: 2 tests pass.

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

Return findings as a YAML array with fields: severity, message, assertion (prose excerpt). Empty array when the prose is clean.

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
    severity: r.severity,
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

  test('propagates findings tagged as npov', async () => {
    const llm: LLMClient = {
      callForFindings: async () => ({
        findings: [{ severity: 'warn', message: 'Loaded language: "notorious"', assertion: 'a notorious developer' }],
        errors: [],
      }),
    };
    const result = await runNpovCheck(fakeContext('The notorious developer...'), llm);
    expect(result.findings[0]!.check).toBe('npov');
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
import type { ReviewResult, CheckResult } from './types';

const CHECK_LABEL: Record<CheckResult['check'], string> = {
  coverage: 'Claim coverage',
  support: 'Source support',
  npov: 'NPOV',
};

const SEVERITY_ICON: Record<string, string> = {
  info: 'ℹ',
  warn: '⚠',
  error: '✗',
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
        const icon = SEVERITY_ICON[f.severity] ?? '·';
        const where = f.line ? `${f.file}:${f.line}` : f.file;
        const quote = f.assertion ? `  \n> ${f.assertion}` : '';
        lines.push(`- ${icon} \`${where}\` — ${f.message}${quote}`);
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
          return { findings: [{ severity: 'warn', message: 'No claim backs this assertion', assertion: 'Fielder chairs' }], errors: [] };
        }
        if (userPrompt.includes('overreach') && isSupport) {
          return { findings: [{ severity: 'warn', message: 'Prose says more than source supports', assertion: 'landslide' }], errors: [] };
        }
        if (userPrompt.includes('advocacy-voice') && isNpov) {
          return { findings: [{ severity: 'warn', message: 'Loaded language: "notorious"', assertion: 'notorious developer' }], errors: [] };
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

  test('renders finding with file, icon, and assertion quote', () => {
    const out = composeComment(
      {
        results: [
          { check: 'coverage', findings: [{ check: 'coverage', file: 'articles/x.md', severity: 'warn', message: 'Missing claim', assertion: 'Fielder chairs Land Use' }], errors: [] },
          { check: 'support', findings: [], errors: [] },
          { check: 'npov', findings: [], errors: [] },
        ],
        totalFindings: 1,
        hasErrors: false,
      },
      'claude-sonnet-4-6',
    );
    expect(out).toContain('⚠');
    expect(out).toContain('articles/x.md');
    expect(out).toContain('Missing claim');
    expect(out).toContain('> Fielder chairs Land Use');
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

- `scripts/reviewer/` contains three independent check modules (`coverage`, `support`, `npov`) plus a shared LLM client wrapper with pinned model, `temperature: 0`, and prompt caching on the editorial-principles block.
- `npm run reviewer -- --dry-run` against the seed corpus produces a composed markdown comment; Luis judges the findings *actionable and honest* (not flattery, not noise). Zero findings on clean seed content is an acceptable outcome.
- Each of the four fixture corpora in `tests/reviewer-fixtures/` triggers at least one correctly-pointed finding from the check that was designed to catch it:
  - `claim-less-assertion` → coverage finding
  - `overreach` → support finding
  - `advocacy-voice` → NPOV finding
  - `clean-baseline` → zero findings
- The reviewer exits cleanly on: missing ANTHROPIC_API_KEY (fails fast with a clear error), LLM response that isn't valid YAML (recorded as a reviewer error, not a crash), source fetch failure (recorded as a reviewer error, check continues on other sources), missing PR context (falls back to printing the comment).
- The composed PR comment is well-formed GitHub-flavored markdown with per-check sections, severity icons, file paths, and quoted assertions for each finding.
- Unit tests cover the YAML parser, each individual check's orchestration (with mocked LLM), and the comment composer.
- Integration tests run the full `runReview()` orchestration with a mocked LLM against each fixture corpus.
- No test hits the live Anthropic API; the `--dry-run` smoke is an operator-run verification, not a CI step.
- Each task committed independently.
