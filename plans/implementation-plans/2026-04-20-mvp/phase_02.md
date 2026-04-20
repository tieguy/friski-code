# Friski MVP Implementation Plan — Phase 2: Content Loader & Validator

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Wire the content schemas from Phase 1 into Astro collections that load `subjects/*.yaml` and `articles/*.md` from the `frisco-wiki` submodule. Build the in-memory subject graph (with derived predicates). Ship a standalone `scripts/validate-content.ts` that enforces every schema + cross-reference rule from the design plan with passing and failing tests per rule.

**Architecture:** Two Astro content collections registered with `glob` loaders. A pure-TS subject-graph builder that both Astro's runtime and the standalone validator script share. Footnote extraction uses the unified + remark-gfm AST (not regex) so parsing matches the same rules Astro applies at render time. Validator script iterates filesystem directly (no Astro runtime), validates via Zod, builds the graph, and checks the cross-reference rules; fails with a non-zero exit and specific error messages on any violation.

**Tech Stack:** Astro 6 content collections, Zod, unified/remark-parse/remark-gfm, unist-util-visit, mdast-util-to-string, gray-matter, tsx, Vitest, js-yaml.

**Scope:** 2 of 7 phases from `plans/design-plans/2026-04-20-mvp.md`.

**Codebase verified:** 2026-04-20 — plan-writing time. Phase 2 assumes Phase 1 has been executed: `src/content.config.ts` exports standalone Zod schemas; `src/lib/subject-graph.ts` holds type definitions only; Vitest is configured; `.gitmodules` wires `src/content/wiki/` to `frisco-wiki`.

**Note on Zod version interop:** Phase 1 pinned `zod@^3.23.0` as a standalone dependency. Astro 6's `defineCollection` accepts any structurally-compatible Zod schema. If the executor hits a type mismatch on `schema:` in Task 1, the minimal workaround is to import `z` from `astro/zod` inside `content.config.ts` *for the collection registration only* while keeping standalone `zod` imports for schemas used by the validator and tests. Reported as a known possible hiccup; the plan assumes the standalone schemas work.

---

## Task 1: Register Astro collections

**Files:**
- Modify: `src/content.config.ts` (append collections registration)

**Step 1: Append collection registration to `src/content.config.ts`**

Add to the bottom of the file (keep existing schema exports intact):

```typescript
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

export const collections = {
  subjects: defineCollection({
    loader: glob({ pattern: 'subjects/*.yaml', base: './src/content/wiki' }),
    schema: subjectSchema,
  }),
  articles: defineCollection({
    loader: glob({ pattern: 'articles/*.md', base: './src/content/wiki' }),
    schema: articleSchema,
  }),
};
```

**Step 2: Verify the build loads the (empty) collections**

Run: `npm run build`
Expected: build succeeds. Astro reports `subjects` and `articles` as collections with 0 entries (the submodule's `subjects/` and `articles/` only have `.gitkeep`).

**Step 3: Commit**

```bash
git add src/content.config.ts
git commit -m "feat: register subjects and articles collections with glob loaders"
```

---

## Task 2: Markdown footnote parser

**Files:**
- Modify: `package.json` (add remark/unified deps)
- Create: `src/lib/footnote-parser.ts`
- Create: `tests/footnote-parser.test.ts`

**Step 1: Install deps**

Run: `npm install unified remark-parse remark-gfm unist-util-visit mdast-util-to-string`

**Step 2: Write the failing test at `tests/footnote-parser.test.ts`**

```typescript
import { describe, expect, test } from 'vitest';
import { extractFootnotes } from '../src/lib/footnote-parser';

const article = `
Jackie Fielder is a member of the SF Board of Supervisors.[^fielder-elected]

Some prose with another ref.[^another]

[^fielder-elected]: missionlocal-2024-11-fielder-elected
[^another]: jackie-fielder/some-other-source
`;

describe('extractFootnotes', () => {
  test('extracts label-to-body mappings from GFM footnotes', () => {
    const result = extractFootnotes(article);
    expect(result).toEqual({
      'fielder-elected': 'missionlocal-2024-11-fielder-elected',
      'another': 'jackie-fielder/some-other-source',
    });
  });

  test('returns empty map when no footnotes present', () => {
    expect(extractFootnotes('Plain prose. No footnotes here.')).toEqual({});
  });

  test('ignores footnote references without definitions', () => {
    const text = 'Reference without definition.[^dangling]';
    expect(extractFootnotes(text)).toEqual({});
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npm test -- footnote-parser`
Expected: FAIL — `extractFootnotes` not defined.

**Step 4: Write the implementation at `src/lib/footnote-parser.ts`**

```typescript
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';

/**
 * Extracts GFM footnote definitions from a markdown body.
 * Returns `{ [label]: body }` for every `[^label]: body` definition.
 * Footnote references without definitions are silently skipped.
 */
export function extractFootnotes(markdown: string): Record<string, string> {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const footnotes: Record<string, string> = {};

  visit(tree, 'footnoteDefinition', (node) => {
    footnotes[node.identifier] = toString(node).trim();
  });

  return footnotes;
}
```

**Step 5: Run test to verify it passes**

Run: `npm test -- footnote-parser`
Expected: all three tests pass.

**Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/footnote-parser.ts tests/footnote-parser.test.ts
git commit -m "feat: GFM footnote extraction via remark AST"
```

---

## Task 3: Subject graph builder

**Files:**
- Modify: `src/lib/subject-graph.ts` (replace types-only with types + implementation)
- Create: `tests/subject-graph.test.ts`
- Create: `tests/fixtures/subjects/jackie-fielder.yaml` (move from Phase 1's single fixture)
- Create: `tests/fixtures/subjects/sf-board-of-supervisors.yaml`
- Create: `tests/fixtures/articles/jackie-fielder.md`

**Step 1: Create multi-subject fixtures**

Create `tests/fixtures/subjects/jackie-fielder.yaml` (same content as Phase 1's `tests/fixtures/valid-subject.yaml`; delete that file as part of this task since it's replaced).

Create `tests/fixtures/subjects/sf-board-of-supervisors.yaml`:

```yaml
id: sf-board-of-supervisors
wikidata_qid: Q1128418
label: San Francisco Board of Supervisors
description: The legislative body of the City and County of San Francisco.
scope: [institution, legislative-body]

claims:
  - id: C000
    property: P31
    value: Q43229
    source: wd-sf-bos
  - id: C001
    property: P17
    value: Q30
    source: wd-sf-bos

sources:
  - id: wd-sf-bos
    url: https://www.wikidata.org/wiki/Q1128418
    publication: Wikidata
    tier: 2
    archive:
      url: https://web.archive.org/web/2024/https://www.wikidata.org/wiki/Q1128418
      method: wayback
      access: public
```

Create `tests/fixtures/articles/jackie-fielder.md`:

```markdown
---
title: Jackie Fielder
slug: jackie-fielder
primary_subject: jackie-fielder
subjects: [jackie-fielder, sf-board-of-supervisors]
scope: [person, politician]
tags: [district-9]
---

Jackie Fielder is a member of the San Francisco Board of Supervisors,
representing District 9 since January 2025.[^fielder-elected]

[^fielder-elected]: missionlocal-2024-11-fielder-elected
```

(Also add `Q30` — country of sovereign state, standing for United States — to `config/allowed-types.yaml` since the BoS fixture uses `P17 Q30`. Actually P17 ("country") values don't need to be in `allowed-types.yaml`; only P31 values do. No change to `allowed-types.yaml` needed.)

**Step 2: Write failing tests at `tests/subject-graph.test.ts`**

```typescript
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { buildSubjectGraph } from '../src/lib/subject-graph';
import { subjectSchema, articleSchema } from '../src/content.config';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixtures() {
  const subjectFiles = globSync('fixtures/subjects/*.yaml', { cwd: __dirname });
  const subjects = subjectFiles.map((rel) => {
    const raw = readFileSync(join(__dirname, rel), 'utf8');
    const data = subjectSchema.parse(yaml.load(raw));
    return { id: data.id, data };
  });

  const articleFiles = globSync('fixtures/articles/*.md', { cwd: __dirname });
  const articles = articleFiles.map((rel) => {
    const raw = readFileSync(join(__dirname, rel), 'utf8');
    const parsed = matter(raw);
    const data = articleSchema.parse(parsed.data);
    return { id: data.slug, data, body: parsed.content };
  });

  return { subjects, articles };
}

const ALLOWED_TYPES = ['Q5', 'Q43229', 'Q515', 'Q1048835', 'F-neighborhood', 'F-landmark'];

describe('buildSubjectGraph', () => {
  test('populates subjects and articles maps', () => {
    const { subjects, articles } = loadFixtures();
    const graph = buildSubjectGraph(subjects, articles, ALLOWED_TYPES);
    expect(graph.subjects.size).toBe(2);
    expect(graph.articles.size).toBe(1);
    expect(graph.subjects.has('jackie-fielder')).toBe(true);
  });

  test('derives types from P31 claims', () => {
    const { subjects, articles } = loadFixtures();
    const graph = buildSubjectGraph(subjects, articles, ALLOWED_TYPES);
    expect(graph.subjects.get('jackie-fielder')?.types).toEqual(['Q5']);
    expect(graph.subjects.get('sf-board-of-supervisors')?.types).toEqual(['Q43229']);
  });

  test('is_living_person true for human subject with no death date', () => {
    const { subjects, articles } = loadFixtures();
    const graph = buildSubjectGraph(subjects, articles, ALLOWED_TYPES);
    expect(graph.isLivingPerson('jackie-fielder')).toBe(true);
    expect(graph.isLivingPerson('sf-board-of-supervisors')).toBe(false);
  });

  test('articlesReferencing returns articles that list the subject', () => {
    const { subjects, articles } = loadFixtures();
    const graph = buildSubjectGraph(subjects, articles, ALLOWED_TYPES);
    const refs = graph.articlesReferencing('sf-board-of-supervisors');
    expect(refs.map((a) => a.slug)).toEqual(['jackie-fielder']);
  });

  test('activeClaims filters to claims with end=null', () => {
    const { subjects, articles } = loadFixtures();
    const graph = buildSubjectGraph(subjects, articles, ALLOWED_TYPES);
    const active = graph.activeClaims('P39');
    expect(active).toHaveLength(1);
    expect(active[0]?.subjectId).toBe('jackie-fielder');
  });

  test('footnotes resolved against subjects[] of the article', () => {
    const { subjects, articles } = loadFixtures();
    const graph = buildSubjectGraph(subjects, articles, ALLOWED_TYPES);
    const article = graph.articles.get('jackie-fielder');
    expect(article?.footnotes).toHaveLength(1);
    expect(article?.footnotes[0]?.subjectId).toBe('jackie-fielder');
    expect(article?.footnotes[0]?.sourceId).toBe('missionlocal-2024-11-fielder-elected');
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npm test -- subject-graph`
Expected: FAIL — `buildSubjectGraph` not exported or not defined.

**Step 4: Install `gray-matter`**

Run: `npm install gray-matter`

**Step 5: Write `src/lib/subject-graph.ts` implementation**

Replace the Phase 1 types-only file with types + implementation:

```typescript
import type { Article, Claim, Source, Subject } from '../content.config';
import { extractFootnotes } from './footnote-parser';

// Public types (unchanged from Phase 1, re-declared for co-location) ---------

export interface SubjectGraph {
  readonly subjects: ReadonlyMap<string, SubjectNode>;
  readonly articles: ReadonlyMap<string, ArticleNode>;
  readonly activeClaims: (property: string) => readonly ActiveClaim[];
  readonly isLivingPerson: (subjectId: string) => boolean;
  readonly articlesReferencing: (subjectId: string) => readonly ArticleNode[];
}

export interface SubjectNode extends Subject {
  readonly types: readonly string[];
  readonly is_living_person: boolean;
  readonly sourcesById: ReadonlyMap<string, Source>;
  readonly claimsById: ReadonlyMap<string, Claim>;
}

export interface ArticleNode extends Article {
  readonly body: string;
  readonly footnotes: readonly ResolvedFootnote[];
}

export interface ResolvedFootnote {
  readonly label: string;
  readonly subjectId: string;
  readonly sourceId: string;
  readonly source: Source;
}

export interface ActiveClaim {
  readonly subjectId: string;
  readonly claim: Claim;
}

// Graph construction errors (thrown when the input violates invariants the
// caller is responsible for establishing — typically caught and reformatted
// by validate-content.ts into its error-reporting format).

export class FootnoteResolutionError extends Error {
  constructor(
    public readonly articleSlug: string,
    public readonly label: string,
    public readonly body: string,
    public readonly reason: 'no-match' | 'ambiguous',
    public readonly candidateSubjects: readonly string[] = [],
  ) {
    super(
      `Article ${articleSlug}: footnote [^${label}] -> "${body}" (${reason}` +
        (candidateSubjects.length ? `, candidates: ${candidateSubjects.join(', ')}` : '') +
        ')',
    );
  }
}

// Implementation -------------------------------------------------------------

interface SubjectInput {
  id: string;
  data: Subject;
}

interface ArticleInput {
  id: string;        // article slug
  data: Article;
  body: string;
}

const P31 = 'P31';
const P570 = 'P570';

/**
 * Build the in-memory subject graph from validated subject and article inputs.
 *
 * Throws FootnoteResolutionError if an article's footnote fails to resolve.
 * Does NOT enforce the wider validator rules (P31 allowlist, source uniqueness,
 * etc.) beyond what's needed to build the graph — the validator script layers
 * those checks on top.
 */
export function buildSubjectGraph(
  subjects: readonly SubjectInput[],
  articles: readonly ArticleInput[],
  _allowedTypes: readonly string[],  // unused here; validator enforces
): SubjectGraph {
  const subjectNodes = new Map<string, SubjectNode>();

  for (const { data } of subjects) {
    const sourcesById = new Map(data.sources.map((s) => [s.id, s]));
    const claimsById = new Map(data.claims.map((c) => [c.id, c]));
    const p31Values = data.claims.filter((c) => c.property === P31).map((c) => c.value);
    const hasDeathDate = data.claims.some((c) => c.property === P570);

    subjectNodes.set(data.id, {
      ...data,
      types: p31Values,
      is_living_person: p31Values.includes('Q5') && !hasDeathDate,
      sourcesById,
      claimsById,
    });
  }

  const articleNodes = new Map<string, ArticleNode>();

  for (const { data, body } of articles) {
    const footnoteMap = extractFootnotes(body);
    const resolvedFootnotes: ResolvedFootnote[] = [];

    for (const [label, refBody] of Object.entries(footnoteMap)) {
      const resolved = resolveFootnote(data, subjectNodes, label, refBody);
      resolvedFootnotes.push(resolved);
    }

    articleNodes.set(data.slug, {
      ...data,
      body,
      footnotes: resolvedFootnotes,
    });
  }

  const activeClaims = (property: string): readonly ActiveClaim[] => {
    const out: ActiveClaim[] = [];
    for (const [subjectId, node] of subjectNodes) {
      for (const claim of node.claims) {
        if (claim.property === property && (claim.end === null || claim.end === undefined)) {
          out.push({ subjectId, claim });
        }
      }
    }
    return out;
  };

  const isLivingPerson = (subjectId: string): boolean =>
    subjectNodes.get(subjectId)?.is_living_person ?? false;

  const articlesReferencing = (subjectId: string): readonly ArticleNode[] => {
    const out: ArticleNode[] = [];
    for (const article of articleNodes.values()) {
      if (article.subjects.includes(subjectId)) {
        out.push(article);
      }
    }
    return out;
  };

  return { subjects: subjectNodes, articles: articleNodes, activeClaims, isLivingPerson, articlesReferencing };
}

// Resolve a footnote body against the subjects an article declares.
// Body is either "source-id" (terse) or "subject-id/source-id" (explicit).
function resolveFootnote(
  article: Article,
  subjects: ReadonlyMap<string, SubjectNode>,
  label: string,
  body: string,
): ResolvedFootnote {
  const slash = body.indexOf('/');
  if (slash > 0) {
    const subjectId = body.slice(0, slash);
    const sourceId = body.slice(slash + 1);
    if (!article.subjects.includes(subjectId)) {
      throw new FootnoteResolutionError(article.slug, label, body, 'no-match', [subjectId]);
    }
    const source = subjects.get(subjectId)?.sourcesById.get(sourceId);
    if (!source) {
      throw new FootnoteResolutionError(article.slug, label, body, 'no-match', [subjectId]);
    }
    return { label, subjectId, sourceId, source };
  }

  // Terse form: search the article's subjects for a matching source.id.
  const matches: Array<{ subjectId: string; source: Source }> = [];
  for (const subjectId of article.subjects) {
    const source = subjects.get(subjectId)?.sourcesById.get(body);
    if (source) matches.push({ subjectId, source });
  }

  if (matches.length === 0) {
    throw new FootnoteResolutionError(article.slug, label, body, 'no-match', article.subjects);
  }
  if (matches.length > 1) {
    throw new FootnoteResolutionError(
      article.slug,
      label,
      body,
      'ambiguous',
      matches.map((m) => m.subjectId),
    );
  }
  return { label, subjectId: matches[0]!.subjectId, sourceId: body, source: matches[0]!.source };
}
```

**Step 6: Run tests to verify they pass**

Run: `npm test -- subject-graph`
Expected: all 6 tests pass.

**Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/subject-graph.ts tests/
git rm tests/fixtures/valid-subject.yaml
git commit -m "feat: subject graph builder with derived predicates and footnote resolution"
```

---

## Task 4: Cross-reference validator script

**Files:**
- Modify: `package.json` (add `tsx` devDep, `validate` script)
- Create: `scripts/validate-content.ts`
- Create: `tests/fixtures/subjects/_invalid-missing-p31.yaml`
- Create: `tests/fixtures/subjects/_invalid-p31-not-allowed.yaml`
- Create: `tests/fixtures/subjects/_invalid-duplicate-source.yaml`
- Create: `tests/fixtures/subjects/_invalid-claim-source-ref.yaml`
- Create: `tests/fixtures/articles/_invalid-orphan-subject.md`
- Create: `tests/fixtures/articles/_invalid-footnote-unresolved.md`
- Create: `tests/fixtures/articles/_invalid-footnote-ambiguous.md`
- Create: `tests/validator.test.ts`

**Step 1: Install `tsx` and add `validate` script**

Run: `npm install -D tsx@^4.0.0`

Add to `package.json` scripts:

```json
"validate": "tsx scripts/validate-content.ts"
```

**Step 2: Create invalid fixtures**

The `_` prefix on invalid fixtures keeps them out of normal glob patterns that might accidentally treat them as real content. Each fixture isolates ONE rule violation.

`tests/fixtures/subjects/_invalid-missing-p31.yaml` — valid subject but no P31 claim:

```yaml
id: no-p31-subject
label: Missing P31
description: This subject has no instance-of claim.
claims:
  - id: C001
    property: P39
    value: F-SF-D9-Supervisor
    source: some-source
sources:
  - id: some-source
    url: https://example.org/
    publication: Example
    tier: 3
    archive:
      url: https://web.archive.org/web/2024/https://example.org/
      method: wayback
      access: public
```

`tests/fixtures/subjects/_invalid-p31-not-allowed.yaml` — P31 value not on allowlist:

```yaml
id: bad-type
label: Bad Type
description: P31 value not in allowed-types.yaml.
claims:
  - id: C000
    property: P31
    value: Q999999
    source: some-source
sources:
  - id: some-source
    url: https://example.org/
    publication: Example
    tier: 3
    archive:
      url: https://web.archive.org/web/2024/https://example.org/
      method: wayback
      access: public
```

`tests/fixtures/subjects/_invalid-duplicate-source.yaml` — two sources with same id (Zod should catch this via record uniqueness but we enforce explicitly):

```yaml
id: dup-source
label: Dup Source
description: Subject with duplicate source IDs.
claims:
  - id: C000
    property: P31
    value: Q5
    source: dup
sources:
  - id: dup
    url: https://a.example.org/
    publication: A
    tier: 1
    archive:
      url: https://web.archive.org/web/2024/https://a.example.org/
      method: wayback
      access: public
  - id: dup
    url: https://b.example.org/
    publication: B
    tier: 1
    archive:
      url: https://web.archive.org/web/2024/https://b.example.org/
      method: wayback
      access: public
```

`tests/fixtures/subjects/_invalid-claim-source-ref.yaml` — claim references a source.id that doesn't exist on the subject:

```yaml
id: dangling-source
label: Dangling Source Ref
description: Claim cites source that is not defined.
claims:
  - id: C000
    property: P31
    value: Q5
    source: nonexistent
sources:
  - id: actual-source
    url: https://example.org/
    publication: Example
    tier: 3
    archive:
      url: https://web.archive.org/web/2024/https://example.org/
      method: wayback
      access: public
```

`tests/fixtures/articles/_invalid-orphan-subject.md` — article references a subject that doesn't exist:

```markdown
---
title: Orphan Ref
slug: _invalid-orphan-subject
subjects: [nonexistent-subject]
---

Prose without any footnotes.
```

`tests/fixtures/articles/_invalid-footnote-unresolved.md`:

```markdown
---
title: Unresolved Footnote
slug: _invalid-footnote-unresolved
subjects: [jackie-fielder]
---

Prose with a bad citation.[^bad]

[^bad]: nonexistent-source-id
```

`tests/fixtures/articles/_invalid-footnote-ambiguous.md`:

```markdown
---
title: Ambiguous Footnote
slug: _invalid-footnote-ambiguous
subjects: [jackie-fielder, sf-board-of-supervisors]
---

Prose with ambiguous citation.[^dup]

[^dup]: wd-jackie-fielder
```

(Create a companion fixture where `sf-board-of-supervisors.yaml` also declares a source with id `wd-jackie-fielder` to actually trigger ambiguity — add it as an extra source in the test setup rather than in the shared fixture.)

**Step 3: Create the validator at `scripts/validate-content.ts`**

```typescript
#!/usr/bin/env tsx
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { ZodError } from 'zod';
import { subjectSchema, articleSchema, type Subject, type Article } from '../src/content.config';
import { buildSubjectGraph, FootnoteResolutionError } from '../src/lib/subject-graph';

interface AllowedTypesFile {
  allowed_types: string[];
}

export interface ValidationError {
  file: string;
  rule: string;
  message: string;
}

export interface ValidationResult {
  errors: ValidationError[];
  subjectsLoaded: number;
  articlesLoaded: number;
}

export function validate(
  contentRoot: string,
  allowedTypesPath: string,
): ValidationResult {
  const errors: ValidationError[] = [];
  const allowedTypes = loadAllowedTypes(allowedTypesPath);

  // 1. Load and Zod-validate all subjects
  const rawSubjects = loadYamlDir<unknown>(join(contentRoot, 'subjects'));
  const subjects: Array<{ id: string; data: Subject; file: string }> = [];
  const seenSubjectIds = new Set<string>();

  for (const { file, raw } of rawSubjects) {
    const parsed = subjectSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(...zodErrorsToValidation(file, 'schema', parsed.error));
      continue;
    }
    const data = parsed.data;

    // subject.id globally unique
    if (seenSubjectIds.has(data.id)) {
      errors.push({ file, rule: 'subject-id-unique', message: `Duplicate subject.id: ${data.id}` });
      continue;
    }
    seenSubjectIds.add(data.id);

    // source.id unique within subject
    const sourceIds = new Set<string>();
    for (const source of data.sources) {
      if (sourceIds.has(source.id)) {
        errors.push({ file, rule: 'source-id-unique-within-subject', message: `Duplicate source.id: ${source.id}` });
      }
      sourceIds.add(source.id);
    }

    // claim.source resolves to a source in this subject
    for (const claim of data.claims) {
      if (!sourceIds.has(claim.source)) {
        errors.push({
          file,
          rule: 'claim-source-resolves',
          message: `Claim ${claim.id} cites source "${claim.source}" not defined on this subject`,
        });
      }
    }

    // >= 1 P31 claim
    const p31Claims = data.claims.filter((c) => c.property === 'P31');
    if (p31Claims.length === 0) {
      errors.push({ file, rule: 'p31-present', message: 'Subject must have at least one P31 (instance of) claim' });
    }

    // P31 values are on the allowlist
    for (const claim of p31Claims) {
      if (!allowedTypes.includes(claim.value)) {
        errors.push({
          file,
          rule: 'p31-allowlist',
          message: `P31 value "${claim.value}" not in config/allowed-types.yaml`,
        });
      }
    }

    subjects.push({ id: data.id, data, file });
  }

  // 2. Load and Zod-validate all articles
  const rawArticles = loadMarkdownDir(join(contentRoot, 'articles'));
  const articles: Array<{ id: string; data: Article; body: string; file: string }> = [];

  for (const { file, frontmatter, body } of rawArticles) {
    const parsed = articleSchema.safeParse(frontmatter);
    if (!parsed.success) {
      errors.push(...zodErrorsToValidation(file, 'schema', parsed.error));
      continue;
    }
    articles.push({ id: parsed.data.slug, data: parsed.data, body, file });
  }

  // 3. No orphan subjects in articles[].subjects
  const subjectIds = new Set(subjects.map((s) => s.id));
  for (const { file, data } of articles) {
    for (const subjectId of data.subjects) {
      if (!subjectIds.has(subjectId)) {
        errors.push({
          file,
          rule: 'no-orphan-subjects',
          message: `Article references subject "${subjectId}" that does not exist`,
        });
      }
    }
  }

  // 4. Build subject graph to surface footnote resolution errors
  if (errors.length === 0) {
    try {
      buildSubjectGraph(subjects, articles, allowedTypes);
    } catch (e) {
      if (e instanceof FootnoteResolutionError) {
        errors.push({
          file: `articles/${e.articleSlug}.md`,
          rule: `footnote-${e.reason}`,
          message: e.message,
        });
      } else {
        throw e;
      }
    }
  }

  return { errors, subjectsLoaded: subjects.length, articlesLoaded: articles.length };
}

// Helpers --------------------------------------------------------------------

function loadAllowedTypes(path: string): string[] {
  if (!existsSync(path)) throw new Error(`allowed-types file not found: ${path}`);
  const parsed = yaml.load(readFileSync(path, 'utf8')) as AllowedTypesFile;
  return parsed.allowed_types ?? [];
}

function loadYamlDir<T>(dir: string): Array<{ file: string; raw: T }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => ({
      file: join(dir, f),
      raw: yaml.load(readFileSync(join(dir, f), 'utf8')) as T,
    }));
}

function loadMarkdownDir(dir: string): Array<{ file: string; frontmatter: unknown; body: string }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const parsed = matter(readFileSync(join(dir, f), 'utf8'));
      return { file: join(dir, f), frontmatter: parsed.data, body: parsed.content };
    });
}

function zodErrorsToValidation(file: string, rule: string, error: ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    file,
    rule,
    message: `${issue.path.join('.')}: ${issue.message}`,
  }));
}

// CLI entry ------------------------------------------------------------------

function main() {
  const contentRoot = process.argv[2] ?? 'src/content/wiki';
  const allowedTypesPath = process.argv[3] ?? 'config/allowed-types.yaml';
  const result = validate(resolve(contentRoot), resolve(allowedTypesPath));

  if (result.errors.length === 0) {
    console.log(`✓ validator passed (${result.subjectsLoaded} subjects, ${result.articlesLoaded} articles)`);
    process.exit(0);
  }

  console.error(`✗ validator failed with ${result.errors.length} error(s):`);
  for (const err of result.errors) {
    console.error(`  [${err.rule}] ${err.file}: ${err.message}`);
  }
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

**Step 4: Write the validator tests at `tests/validator.test.ts`**

```typescript
import { describe, expect, test, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { validate } from '../scripts/validate-content';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');
const allowedTypesPath = join(__dirname, '..', 'config', 'allowed-types.yaml');

// Build a temporary content root that mimics src/content/wiki/ layout by
// copying a selected subset of fixture subjects and articles into it.
function makeCorpus(subjectFixtures: string[], articleFixtures: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'friski-corpus-'));
  mkdirSync(join(root, 'subjects'), { recursive: true });
  mkdirSync(join(root, 'articles'), { recursive: true });
  for (const f of subjectFixtures) {
    copyFileSync(join(fixturesDir, 'subjects', f), join(root, 'subjects', f));
  }
  for (const f of articleFixtures) {
    copyFileSync(join(fixturesDir, 'articles', f), join(root, 'articles', f));
  }
  return root;
}

describe('validate-content (rule coverage)', () => {
  test('passes on a clean corpus', () => {
    const root = makeCorpus(['jackie-fielder.yaml', 'sf-board-of-supervisors.yaml'], ['jackie-fielder.md']);
    const result = validate(root, allowedTypesPath);
    expect(result.errors).toEqual([]);
    expect(result.subjectsLoaded).toBe(2);
    expect(result.articlesLoaded).toBe(1);
  });

  test('flags subject missing P31 claim', () => {
    const root = makeCorpus(['_invalid-missing-p31.yaml'], []);
    const result = validate(root, allowedTypesPath);
    expect(result.errors.some((e) => e.rule === 'p31-present')).toBe(true);
  });

  test('flags P31 value not on allowlist', () => {
    const root = makeCorpus(['_invalid-p31-not-allowed.yaml'], []);
    const result = validate(root, allowedTypesPath);
    expect(result.errors.some((e) => e.rule === 'p31-allowlist')).toBe(true);
  });

  test('flags duplicate source.id within subject', () => {
    const root = makeCorpus(['_invalid-duplicate-source.yaml'], []);
    const result = validate(root, allowedTypesPath);
    expect(result.errors.some((e) => e.rule === 'source-id-unique-within-subject')).toBe(true);
  });

  test('flags claim.source not defined on subject', () => {
    const root = makeCorpus(['_invalid-claim-source-ref.yaml'], []);
    const result = validate(root, allowedTypesPath);
    expect(result.errors.some((e) => e.rule === 'claim-source-resolves')).toBe(true);
  });

  test('flags article referencing nonexistent subject', () => {
    const root = makeCorpus(['jackie-fielder.yaml'], ['_invalid-orphan-subject.md']);
    const result = validate(root, allowedTypesPath);
    expect(result.errors.some((e) => e.rule === 'no-orphan-subjects')).toBe(true);
  });

  test('flags article footnote with no matching source', () => {
    const root = makeCorpus(['jackie-fielder.yaml'], ['_invalid-footnote-unresolved.md']);
    const result = validate(root, allowedTypesPath);
    expect(result.errors.some((e) => e.rule === 'footnote-no-match')).toBe(true);
  });

  test('flags article footnote ambiguous across subjects', () => {
    // For this test, jackie-fielder's wd-jackie-fielder source also appears
    // under a second subject we'll synthesize in a temp file.
    const root = makeCorpus(
      ['jackie-fielder.yaml', 'sf-board-of-supervisors.yaml'],
      ['_invalid-footnote-ambiguous.md'],
    );
    // Inject a duplicate source into the BoS fixture to create ambiguity.
    const bosPath = join(root, 'subjects', 'sf-board-of-supervisors.yaml');
    const bosContent = readFileSync(bosPath, 'utf8');
    writeFileSync(
      bosPath,
      bosContent + `
  - id: wd-jackie-fielder
    url: https://example.org/secondary
    publication: Secondary
    tier: 2
    archive:
      url: https://web.archive.org/web/2024/https://example.org/secondary
      method: wayback
      access: public
`,
    );
    const result = validate(root, allowedTypesPath);
    expect(result.errors.some((e) => e.rule === 'footnote-ambiguous')).toBe(true);
  });
});
```

**Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all tests pass, including the ~8 new validator rule tests.

**Step 6: Smoke test the CLI against an empty corpus**

Run: `npm run validate`
Expected: exits 0 with `✓ validator passed (0 subjects, 0 articles)` — the submodule's `subjects/` and `articles/` are empty.

**Step 7: Commit**

```bash
git add package.json package-lock.json scripts/ tests/
git commit -m "feat: validate-content script with per-rule test coverage"
```

---

## Done when

- `npm run build` succeeds with `subjects` and `articles` collections registered via `glob` loaders.
- `src/lib/subject-graph.ts` exports a working `buildSubjectGraph` that produces the graph described in the design's Architecture section (subjects/articles maps, derived predicates: `types`, `is_living_person`, `activeClaims`, `articlesReferencing`; footnote resolution with terse-and-explicit forms).
- `scripts/validate-content.ts` runs standalone via `npm run validate`, exits 0 on clean corpus and non-zero on violations with specific rule-tagged messages.
- Every validator rule listed in the design plan's "Validator" subsection has at least one passing fixture and one failing fixture with a matching test:
  - Zod schema conformance (negative: broken schema)
  - `subject.id` unique globally
  - `source.id` unique within subject
  - `claim.source` resolves to a source in the same subject
  - Every source has `archive.url` — enforced at the Zod layer (`archive.url: z.string().url()` non-optional). Covered by `_invalid-missing-archive-url.yaml` with a test asserting `result.errors.some(e => e.rule === 'schema')`.
  - `tier ∈ {1..4}` — enforced at the Zod layer (`z.number().int().min(1).max(4)`). Covered by `_invalid-tier-out-of-range.yaml` (`tier: 7`) with the same assertion.
  - Every subject has ≥1 P31 claim
  - P31 values appear on the allowlist
  - Footnote resolution: exact match → ok; zero matches → `footnote-no-match`; multiple matches → `footnote-ambiguous`
  - No orphan subjects in articles' `subjects[]`
- Footnote parsing uses the remark-gfm AST, not regex.
- `npm test` passes all tests (schema tests from Phase 1, footnote parser, subject graph, validator rules).
- Each task committed independently.
