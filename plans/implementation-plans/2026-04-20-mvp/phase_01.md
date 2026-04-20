# Friski MVP Implementation Plan — Phase 1: Project Setup & Schemas

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Initialize `friski-code` as an Astro 6 project with typed content schemas, a minimal page skeleton, a subject-graph type surface, and the `frisco-wiki` content submodule wired up.

**Architecture:** Greenfield Astro 6 application configured for strict TypeScript. Zod schemas defined in `src/content.config.ts` as standalone (testable) objects — custom content-layer loaders will wire them into Astro collections in Phase 2. Vitest covers unit-level schema validation. `frisco-wiki` lives as a git submodule at `src/content/wiki/` so content and code evolve atomically.

**Tech Stack:** Astro 6, TypeScript (strict), Zod, js-yaml, Vitest, npm.

**Scope:** 1 of 7 phases from `plans/design-plans/2026-04-20-mvp.md`.

**Codebase verified:** 2026-04-20 — repo is greenfield (CLAUDE.md, README.md, plans/ only; no application code, no node_modules, no .gitmodules). On branch `phase-0-mvp` from local `main` at commit `ab23e03`.

---

## Task 1: Astro 6 scaffold

**Files:**
- Create: `package.json`
- Create: `astro.config.mjs`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/env.d.ts`
- Create: `src/pages/index.astro`

**Step 1: Create `package.json`**

```json
{
  "name": "friski-code",
  "type": "module",
  "version": "0.0.0",
  "private": true,
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "dev": "astro dev",
    "start": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro",
    "typecheck": "astro check && tsc --noEmit"
  },
  "dependencies": {
    "astro": "^6.1.0",
    "js-yaml": "^4.1.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0"
  }
}
```

**Step 2: Create `tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist", "node_modules", "src/content/wiki"]
}
```

Note: the `frisco-wiki` submodule is excluded from the parent tsconfig — it holds YAML/Markdown, not TypeScript.

**Step 3: Create `astro.config.mjs`**

```javascript
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://frisco.wiki',
});
```

**Step 4: Create `.gitignore`**

```
# build output
dist/
.astro/

# node
node_modules/

# env
.env
.env.production

# editor
.vscode/
.idea/
.DS_Store

# test output
coverage/
```

**Step 5: Create `src/env.d.ts`**

```typescript
/// <reference path="../.astro/types.d.ts" />
```

**Step 6: Create `src/pages/index.astro`** (placeholder — replaced in Phase 3)

```astro
---
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Friski</title>
  </head>
  <body>
    <p>Friski — coming soon.</p>
  </body>
</html>
```

**Step 7: Install and verify**

Run: `npm install`
Expected: dependencies install without errors.

Run: `npm run build`
Expected: build succeeds; output mentions ~1 page generated.

**Step 8: Commit**

```bash
git add package.json package-lock.json astro.config.mjs tsconfig.json .gitignore src/
git commit -m "chore: initialize Astro 6 project skeleton"
```

---

## Task 2: Content schemas + P31 allowlist

**Files:**
- Create: `config/allowed-types.yaml`
- Create: `src/content.config.ts`

**Step 1: Create `config/allowed-types.yaml`**

```yaml
# P31 (instance of) values this site renders.
# Q-numbers map to Wikidata; F- prefixes are Friski-local.
# Adding a subject of a new type requires adding its P31 value here.
allowed_types:
  - Q5                # human
  - Q515              # city
  - Q43229            # organization
  - Q1048835          # political territorial entity
  - F-neighborhood    # Friski-local: SF neighborhood
  - F-landmark        # Friski-local: named place without Wikidata entry
```

**Step 2: Create `src/content.config.ts`**

```typescript
import { z } from 'zod';

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const claimId = z.string().regex(/^C[0-9]{3,}$/);
const property = z.string().regex(/^(P[0-9]+|F-[A-Za-z0-9-]+)$/);
const value = z.string().regex(/^(Q[0-9]+|F-[A-Za-z0-9-]+)$/);

export const sourceSchema = z.object({
  id: slug,
  url: z.string().url(),
  publication: z.string().min(1),
  author: z.string().optional(),
  date_published: z.coerce.date().optional(),
  tier: z.number().int().min(1).max(4),
  archive: z.object({
    url: z.string().url(),
    method: z.enum(['wayback', 'archive_today', 'friski_warc', 'official_record']),
    access: z.enum(['public', 'private']).default('public'),
    hash: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
  }),
});

export const claimSchema = z.object({
  id: claimId,
  property: property,
  value: value,
  start: z.coerce.date().nullable().optional(),
  end: z.coerce.date().nullable().optional(),
  source: slug,  // references a source.id within the same subject
});

export const subjectSchema = z.object({
  id: slug,
  wikidata_qid: z.string().regex(/^Q[0-9]+$/).optional(),
  label: z.string().min(1),
  description: z.string().min(1),
  scope: z.array(z.string()).default([]),
  claims: z.array(claimSchema).min(1),
  sources: z.array(sourceSchema).min(1),
});

export const articleSchema = z.object({
  title: z.string().min(1),
  slug: slug,
  primary_subject: slug.optional(),
  subjects: z.array(slug).min(1),
  scope: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export type Source = z.infer<typeof sourceSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type Subject = z.infer<typeof subjectSchema>;
export type Article = z.infer<typeof articleSchema>;
```

Schemas are imported from `zod` directly (not `astro:content`) so they're testable under standalone Vitest. Astro's `defineCollection` accepts any Zod schema — the Phase 2 loader will pass these in.

**Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

**Step 4: Commit**

```bash
git add config/ src/content.config.ts
git commit -m "feat: content schemas for subjects, articles, sources, claims"
```

---

## Task 3: Subject graph type definitions

**Files:**
- Create: `src/lib/subject-graph.ts`

**Step 1: Create `src/lib/subject-graph.ts`**

```typescript
import type { Article, Claim, Source, Subject } from '../content.config';

// In-memory representation of the content corpus.
// Constructed in Phase 2 by the content loader; these are the shapes.

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
  readonly label: string;       // as written in prose: [^label]
  readonly subjectId: string;
  readonly sourceId: string;
  readonly source: Source;
}

export interface ActiveClaim {
  readonly subjectId: string;
  readonly claim: Claim;
}
```

**Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

**Step 3: Commit**

```bash
git add src/lib/
git commit -m "feat: subject graph type definitions"
```

---

## Task 4: Vitest + schema unit test

**Files:**
- Modify: `package.json` (add test deps and scripts)
- Create: `vitest.config.ts`
- Create: `tests/fixtures/valid-subject.yaml`
- Create: `tests/content-schema.test.ts`

**Step 1: Install Vitest**

Run: `npm install -D vitest@^2.0.0`

**Step 2: Add test scripts to `package.json`**

Modify `package.json` `scripts` to include:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Final `scripts` block:

```json
"scripts": {
  "dev": "astro dev",
  "start": "astro dev",
  "build": "astro build",
  "preview": "astro preview",
  "astro": "astro",
  "typecheck": "astro check && tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

**Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
```

**Step 4: Create `tests/fixtures/valid-subject.yaml`**

```yaml
id: jackie-fielder
wikidata_qid: Q99524088
label: Jackie Fielder
description: Member of the SF Board of Supervisors representing District 9.
scope: [person, politician, district-9]

claims:
  - id: C000
    property: P31
    value: Q5
    source: wd-jackie-fielder
  - id: C001
    property: P39
    value: F-SF-D9-Supervisor
    start: 2025-01-08
    end: null
    source: missionlocal-2024-11-fielder-elected

sources:
  - id: missionlocal-2024-11-fielder-elected
    url: https://missionlocal.org/example-article
    publication: Mission Local
    author: J. Reporter
    date_published: 2024-11-07
    tier: 1
    archive:
      url: https://web.archive.org/web/2024/https://missionlocal.org/example-article
      method: wayback
      access: public
  - id: wd-jackie-fielder
    url: https://www.wikidata.org/wiki/Q99524088
    publication: Wikidata
    tier: 2
    archive:
      url: https://web.archive.org/web/2024/https://www.wikidata.org/wiki/Q99524088
      method: wayback
      access: public
```

**Step 5: Write the failing test**

Create `tests/content-schema.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import { subjectSchema } from '../src/content.config';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadYaml(path: string): unknown {
  const raw = readFileSync(join(__dirname, path), 'utf8');
  return yaml.load(raw);
}

describe('subjectSchema', () => {
  test('validates a hand-crafted valid subject YAML', () => {
    const data = loadYaml('fixtures/valid-subject.yaml');
    const result = subjectSchema.safeParse(data);
    if (!result.success) {
      throw new Error(
        `expected success, got: ${JSON.stringify(result.error.issues, null, 2)}`,
      );
    }
    expect(result.success).toBe(true);
  });

  test('rejects a subject with no claims', () => {
    const data = loadYaml('fixtures/valid-subject.yaml') as Record<string, unknown>;
    data.claims = [];
    const result = subjectSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test('rejects a claim with invalid P-number format', () => {
    const data = loadYaml('fixtures/valid-subject.yaml') as Record<string, unknown>;
    (data.claims as { property: string }[])[0].property = 'not-a-property';
    const result = subjectSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});
```

**Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: 3 passing tests.

**Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/
git commit -m "test: schema validation with Vitest"
```

---

## Task 5: `frisco-wiki` remote repo + submodule

**Note:** this task creates a new public GitHub repo under the user's account and wires it into `friski-code` as a submodule at `src/content/wiki/`. Requires authenticated `gh` CLI.

**Files affected:**
- Creates: remote `<your-gh-user>/frisco-wiki` repo on GitHub
- Creates: `.gitmodules` in friski-code
- Creates: `src/content/wiki/` (submodule checkout)

**Step 1: Confirm `gh` is authenticated**

Run: `gh auth status`
Expected: reports authenticated to github.com.

**Step 2: Create the remote `frisco-wiki` repo**

```bash
GH_USER=$(gh api user -q '.login')
gh repo create "${GH_USER}/frisco-wiki" --public \
  --description "Content (subjects and articles) for https://frisco.wiki" \
  --add-readme
```

**Step 3: Populate the initial layout**

```bash
TMPDIR=$(mktemp -d)
gh repo clone "${GH_USER}/frisco-wiki" "${TMPDIR}/frisco-wiki"
cd "${TMPDIR}/frisco-wiki"

cat > README.md <<EOF
# frisco-wiki

Content for https://frisco.wiki — structured subjects and prose articles.

## Layout

- \`subjects/*.yaml\` — structured claims about people, places, institutions,
  and events. Each subject owns its own claims and sources.
- \`articles/*.md\` — prose views that reference subjects. Markdown footnotes
  cite sources defined on the referenced subjects.

This repo holds no build tooling or application code. It is consumed by the
[friski-code](https://github.com/${GH_USER}/friski-code) repository as a git
submodule. See that repo's design plan and CLAUDE.md for the authoring
workflow and schema.
EOF

mkdir -p subjects articles
touch subjects/.gitkeep articles/.gitkeep

git add .
git commit -m "Initial layout: README, subjects/, articles/"
git push
cd -
```

**Step 4: Add the submodule in friski-code**

From the `friski-code` repo root:

```bash
GH_USER=$(gh api user -q '.login')
git submodule add "https://github.com/${GH_USER}/frisco-wiki.git" src/content/wiki
```

**Step 5: Verify submodule state**

Run: `git submodule status`
Expected: one line showing a commit hash for `src/content/wiki`.

Run: `ls src/content/wiki/`
Expected: `README.md`, `subjects/`, `articles/`.

**Step 6: Verify all checks still pass**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: succeeds.

Run: `npm test`
Expected: tests pass.

**Step 7: Commit**

```bash
git add .gitmodules src/content/wiki
git commit -m "chore: add frisco-wiki submodule at src/content/wiki"
```

---

## Done when

- `npm install` succeeds.
- `npm run build` succeeds on the empty content corpus.
- `npm run typecheck` passes.
- `npm test` passes with at least three tests including one that validates a hand-crafted valid subject YAML against `subjectSchema`.
- `.gitmodules` wires `src/content/wiki` to the `frisco-wiki` remote repo; `git submodule status` reports a clean pinned commit.
- `config/allowed-types.yaml` exists with the initial P31 allowlist.
- Each task committed independently so code review between tasks sees clean diffs.
