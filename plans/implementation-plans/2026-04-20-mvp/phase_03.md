# Friski MVP Implementation Plan — Phase 3: Page Rendering

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Render three page types from the subject graph — article pages (prose + resolved citations), subject pages (claims table + backlinks), and at least one query-derived index page — plus a working homepage. Static build succeeds against both the empty submodule and the fixture corpus.

**Architecture:** A shared `getGraph()` helper caches one `buildSubjectGraph()` call across all page renders. Pages use `getStaticPaths` to enumerate entries from Astro collections and pre-render. Articles render footnotes via a rehype plugin that rewires GFM's auto-generated backrefs to the Citation `<li id>` entries and suppresses the default auto-footnotes section. Single source-of-truth citation rendering via a dedicated "Sources cited" section below the prose. Components are small and Astro-native; no UI framework at MVP.

**Tech Stack:** Astro 6 components and layouts, Astro's built-in Markdown rendering (remark-gfm enabled by default), minimal plain CSS in `public/style.css`.

**Scope:** 3 of 7 phases from `plans/design-plans/2026-04-20-mvp.md`.

**Codebase verified:** 2026-04-20 — plan-writing time. Phase 3 assumes Phase 2 has been executed: collections registered; `buildSubjectGraph` works; `config/allowed-types.yaml` exists; fixture content in `tests/fixtures/`.

---

## Task 1: Base layout, CSS, `getGraph()` helper

**Files:**
- Create: `src/layouts/BaseLayout.astro`
- Create: `public/style.css`
- Create: `src/lib/get-graph.ts`

**Step 1: Create `src/layouts/BaseLayout.astro`**

```astro
---
interface Props {
  title: string;
}
const { title } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title} — Friski</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <header>
      <nav><a href="/">Friski</a></nav>
    </header>
    <main>
      <slot />
    </main>
    <footer>
      <p>Friski — hyperlocal SF wiki.</p>
    </footer>
  </body>
</html>
```

**Step 2: Create `public/style.css`**

```css
* { box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  max-width: 72ch;
  margin: 2rem auto;
  padding: 0 1rem;
  line-height: 1.6;
  color: #222;
  background: #fafafa;
}
header, footer { padding: 0.5rem 0; }
header nav a { color: #333; text-decoration: none; font-weight: 600; }
footer { border-top: 1px solid #eee; margin-top: 3rem; color: #666; font-size: 0.9em; }
main { margin: 2rem 0; }
h1 { margin-top: 0; }
h2 { font-size: 1.25rem; margin-top: 2rem; }
table { border-collapse: collapse; width: 100%; font-size: 0.95em; }
th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #eee; vertical-align: top; }
th { background: #f4f4f4; font-weight: 600; }
code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.9em; }
a { color: #0366d6; }
a:focus { outline: 2px solid #0366d6; outline-offset: 2px; }
.sources-cited { margin-top: 2rem; border-top: 1px solid #ddd; padding-top: 1rem; }
.sources-cited h2 { font-size: 1rem; }
.subjects-referenced { color: #555; font-size: 0.9em; }
```

**Step 3: Create `src/lib/get-graph.ts`**

```typescript
import { getCollection } from 'astro:content';
import yaml from 'js-yaml';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSubjectGraph, type SubjectGraph } from './subject-graph';

let cached: SubjectGraph | null = null;

export async function getGraph(): Promise<SubjectGraph> {
  if (cached) return cached;

  const allowedTypesPath = fileURLToPath(
    new URL('../../config/allowed-types.yaml', import.meta.url),
  );
  const allowedTypes = (
    yaml.load(readFileSync(allowedTypesPath, 'utf8')) as { allowed_types: string[] }
  ).allowed_types;

  const subjectsCol = await getCollection('subjects');
  const articlesCol = await getCollection('articles');

  const subjects = subjectsCol.map((entry) => ({ id: entry.data.id, data: entry.data }));
  const articles = articlesCol.map((entry) => ({
    id: entry.data.slug,
    data: entry.data,
    body: entry.body ?? '',
  }));

  cached = buildSubjectGraph(subjects, articles, allowedTypes);
  return cached;
}
```

**Step 4: Verify build still succeeds**

Run: `npm run build`
Expected: succeeds; homepage still shows the Phase 1 "coming soon" placeholder. No other pages yet.

**Step 5: Commit**

```bash
git add src/layouts/ public/style.css src/lib/get-graph.ts
git commit -m "feat: base layout, site CSS, and subject graph helper"
```

---

## Task 2: Article rendering

**Files:**
- Create: `src/lib/rehype-rewire-footnotes.ts`
- Create: `src/components/Citation.astro`
- Create: `src/components/SubjectRef.astro`
- Create: `src/pages/[slug].astro`
- Update: `astro.config.mjs`

**Step 1: Create `src/lib/rehype-rewire-footnotes.ts`**

Create a rehype plugin that:
1. Rewrites all `href="#user-content-fn-X"` to `href="#fn-X"` on anchor elements in `<sup>` tags
2. Rewrites `href="#user-content-fnref-X"` backrefs similarly
3. Strips/removes the `<section data-footnotes>` auto-generated block

```typescript
// Functional core: rehype plugin that rewires GFM auto-footnotes to point at our Citation <li> ids.
import type { Root, Element } from 'hast';
import { visit } from 'unist-util-visit';

export function rehypeRewireFootnotes() {
  return (tree: Root) => {
    // 1. Rewrite anchor href prefixes
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return;
      const href = node.properties?.href;
      if (typeof href !== 'string') return;
      if (href.startsWith('#user-content-fn-')) {
        node.properties!.href = '#fn-' + href.slice('#user-content-fn-'.length);
      } else if (href.startsWith('#user-content-fnref-')) {
        node.properties!.href = '#fnref-' + href.slice('#user-content-fnref-'.length);
      }
    });

    // 2. Strip the auto-generated <section data-footnotes>
    tree.children = tree.children.filter((child) => {
      if (child.type !== 'element') return true;
      const el = child as Element;
      if (el.tagName !== 'section') return true;
      const dataFootnotes = el.properties?.dataFootnotes;
      // hast represents `data-footnotes` as `dataFootnotes` property
      return dataFootnotes === undefined;
    });
  };
}
```

Then update `astro.config.mjs` to wire in the plugin:

```javascript
import { defineConfig } from 'astro/config';
import { rehypeRewireFootnotes } from './src/lib/rehype-rewire-footnotes.ts';

export default defineConfig({
  site: 'https://frisco.wiki',
  markdown: {
    rehypePlugins: [rehypeRewireFootnotes],
  },
});
```

**Step 2: Create `src/components/SubjectRef.astro`**

```astro
---
interface Props {
  subjectId: string;
  label?: string;
}
const { subjectId, label } = Astro.props;
---
<a href={`/subjects/${subjectId}`}>{label ?? subjectId}</a>
```

**Step 3: Create `src/components/Citation.astro`**

```astro
---
import type { Source } from '../content.config';
interface Props {
  source: Source;
  label: string;
}
const { source, label } = Astro.props;
const dateText = source.date_published
  ? new Date(source.date_published).toISOString().slice(0, 10)
  : null;
---
<li id={`fn-${label}`}>
  <strong>{source.publication}</strong>{source.author ? `, ${source.author}` : ''}
  {dateText && <>, <time datetime={dateText}>{dateText}</time></>}
  {' — '}
  <a href={source.url} rel="external noopener">original</a>
  {source.archive.access === 'public' && (
    <> | <a href={source.archive.url} rel="external noopener">archive</a></>
  )}
</li>
```

**Step 4: Create `src/pages/[slug].astro`**

```astro
---
import { getCollection, render } from 'astro:content';
import BaseLayout from '../layouts/BaseLayout.astro';
import Citation from '../components/Citation.astro';
import SubjectRef from '../components/SubjectRef.astro';
import { getGraph } from '../lib/get-graph';

export async function getStaticPaths() {
  const articles = await getCollection('articles');
  return articles.map((entry) => ({
    params: { slug: entry.data.slug },
    props: { entry },
  }));
}

const { entry } = Astro.props;
const graph = await getGraph();
const node = graph.articles.get(entry.data.slug);
const { Content } = await render(entry);
const subjectLinks = entry.data.subjects;
---
<BaseLayout title={entry.data.title}>
  <article>
    <h1>{entry.data.title}</h1>
    <p class="subjects-referenced">
      References:{' '}
      {subjectLinks.map((sid, i) => (
        <>
          <SubjectRef subjectId={sid} label={graph.subjects.get(sid)?.label} />
          {i < subjectLinks.length - 1 ? ', ' : ''}
        </>
      ))}
    </p>
    <Content />
    {node && node.footnotes.length > 0 && (
      <section class="sources-cited" aria-labelledby="sources-heading">
        <h2 id="sources-heading">Sources cited</h2>
        <ol>
          {node.footnotes.map((fn) => (
            <Citation source={fn.source} label={fn.label} />
          ))}
        </ol>
      </section>
    )}
  </article>
</BaseLayout>
```

**Step 4: Verify build succeeds (empty corpus)**

Run: `npm run build`
Expected: succeeds; 0 article pages generated (submodule is empty).

**Step 5: Smoke test with fixtures**

Temporarily copy fixtures into the submodule working tree:

```bash
cp tests/fixtures/subjects/jackie-fielder.yaml src/content/wiki/subjects/
cp tests/fixtures/subjects/sf-board-of-supervisors.yaml src/content/wiki/subjects/
cp tests/fixtures/articles/jackie-fielder.md src/content/wiki/articles/
rm -rf node_modules/.astro dist
npm run build
```

Expected: build succeeds; `dist/jackie-fielder/index.html` exists and contains both the prose and a "Sources cited" section with Mission Local's citation.

Revert the copy (but leave the dist):

```bash
cd src/content/wiki
git checkout .
git clean -fd
cd -
```

**Step 6: Commit**

```bash
git add src/components/ src/pages/
git commit -m "feat: article page renderer with citations and subject references"
```

---

## Task 3: Subject page rendering

**Files:**
- Create: `src/components/ClaimsTable.astro`
- Create: `src/pages/subjects/[id].astro`

**Step 1: Create `src/components/ClaimsTable.astro`**

```astro
---
import type { Subject } from '../content.config';
interface Props {
  subject: Subject;
}
const { subject } = Astro.props;

function fmt(d: Date | null | undefined): string {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}
---
<table>
  <thead>
    <tr>
      <th scope="col">Property</th>
      <th scope="col">Value</th>
      <th scope="col">Range</th>
      <th scope="col">Source</th>
    </tr>
  </thead>
  <tbody>
    {subject.claims.map((c) => (
      <tr>
        <td><code>{c.property}</code></td>
        <td><code>{c.value}</code></td>
        <td>
          {fmt(c.start) || '—'}
          {' → '}
          {c.end ? fmt(c.end) : (c.start ? 'present' : '—')}
        </td>
        <td><code>{c.source}</code></td>
      </tr>
    ))}
  </tbody>
</table>
```

**Step 2: Create `src/pages/subjects/[id].astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import ClaimsTable from '../../components/ClaimsTable.astro';
import { getGraph } from '../../lib/get-graph';

export async function getStaticPaths() {
  const graph = await getGraph();
  return Array.from(graph.subjects.values()).map((subject) => ({
    params: { id: subject.id },
    props: { subjectId: subject.id },
  }));
}

const { subjectId } = Astro.props;
const graph = await getGraph();
const subject = graph.subjects.get(subjectId)!;
const backlinks = graph.articlesReferencing(subjectId);
---
<BaseLayout title={subject.label}>
  <article>
    <h1>{subject.label}</h1>
    <p>{subject.description}</p>
    {subject.wikidata_qid && (
      <p>
        Wikidata:{' '}
        <a
          href={`https://www.wikidata.org/wiki/${subject.wikidata_qid}`}
          rel="external noopener"
        >
          {subject.wikidata_qid}
        </a>
      </p>
    )}
    <h2>Claims</h2>
    <ClaimsTable subject={subject} />
    {backlinks.length > 0 && (
      <>
        <h2>Articles</h2>
        <ul>
          {backlinks.map((a) => (
            <li><a href={`/${a.slug}`}>{a.title}</a></li>
          ))}
        </ul>
      </>
    )}
  </article>
</BaseLayout>
```

**Step 3: Smoke test with fixtures**

```bash
cp tests/fixtures/subjects/jackie-fielder.yaml src/content/wiki/subjects/
cp tests/fixtures/subjects/sf-board-of-supervisors.yaml src/content/wiki/subjects/
cp tests/fixtures/articles/jackie-fielder.md src/content/wiki/articles/
rm -rf node_modules/.astro dist
npm run build
```

Expected: `dist/subjects/jackie-fielder/index.html` and `dist/subjects/sf-board-of-supervisors/index.html` exist; each renders a claims table and backlinks to the article.

Revert:

```bash
cd src/content/wiki && git checkout . && git clean -fd && cd -
```

**Step 4: Commit**

```bash
git add src/components/ClaimsTable.astro src/pages/subjects/
git commit -m "feat: subject page with claims table and article backlinks"
```

---

## Task 4: Homepage + query index page

**Files:**
- Modify: `src/pages/index.astro` (replace placeholder)
- Create: `src/pages/index/current-supervisors.astro`

**Step 1: Replace `src/pages/index.astro`**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { getGraph } from '../lib/get-graph';

const graph = await getGraph();
const articles = Array.from(graph.articles.values()).sort((a, b) =>
  a.title.localeCompare(b.title),
);
const subjects = Array.from(graph.subjects.values()).sort((a, b) =>
  a.label.localeCompare(b.label),
);
---
<BaseLayout title="Home">
  <h1>Friski</h1>
  <p>A structured, claim-based hyperlocal wiki for San Francisco.</p>
  {articles.length === 0 && subjects.length === 0 ? (
    <p><em>No content yet. This is the Phase 0 deploy.</em></p>
  ) : (
    <>
      {articles.length > 0 && (
        <section>
          <h2>Articles</h2>
          <ul>
            {articles.map((a) => (<li><a href={`/${a.slug}`}>{a.title}</a></li>))}
          </ul>
        </section>
      )}
      {subjects.length > 0 && (
        <section>
          <h2>Subjects</h2>
          <ul>
            {subjects.map((s) => (<li><a href={`/subjects/${s.id}`}>{s.label}</a></li>))}
          </ul>
        </section>
      )}
      <section>
        <h2>Indexes</h2>
        <ul>
          <li><a href="/index/current-supervisors">Current SF Supervisors</a></li>
        </ul>
      </section>
    </>
  )}
</BaseLayout>
```

**Step 2: Create `src/pages/index/current-supervisors.astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getGraph } from '../../lib/get-graph';

const graph = await getGraph();
const supervisors = graph
  .activeClaims('P39')
  .filter((ac) => /^F-SF-D[0-9]+-Supervisor$/.test(ac.claim.value))
  .map((ac) => ({
    subject: graph.subjects.get(ac.subjectId)!,
    district: Number(ac.claim.value.match(/^F-SF-D([0-9]+)-Supervisor$/)?.[1] ?? 0),
    start: ac.claim.start,
  }))
  .sort((a, b) => a.district - b.district);
---
<BaseLayout title="Current SF Supervisors">
  <h1>Current San Francisco Board of Supervisors</h1>
  <p>
    Derived from active <code>P39</code> claims across subjects. This page is
    regenerated at build time by filtering the subject graph.
  </p>
  {supervisors.length === 0 ? (
    <p><em>No active supervisor claims in the current corpus.</em></p>
  ) : (
    <table>
      <thead>
        <tr>
          <th scope="col">District</th>
          <th scope="col">Supervisor</th>
          <th scope="col">Since</th>
        </tr>
      </thead>
      <tbody>
        {supervisors.map(({ subject, district, start }) => (
          <tr>
            <td>D{district}</td>
            <td><a href={`/subjects/${subject.id}`}>{subject.label}</a></td>
            <td>{start ? new Date(start).toISOString().slice(0, 10) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )}
</BaseLayout>
```

**Step 3: Verify build succeeds on empty corpus**

Run: `npm run build`
Expected: build succeeds. Homepage shows "No content yet." Index page shows "No active supervisor claims…"

**Step 4: Smoke test with fixtures**

```bash
cp tests/fixtures/subjects/*.yaml src/content/wiki/subjects/
cp tests/fixtures/articles/*.md src/content/wiki/articles/
# Skip any files with `_invalid-` prefix:
rm -f src/content/wiki/subjects/_invalid-*.yaml src/content/wiki/articles/_invalid-*.md
rm -rf node_modules/.astro dist
npm run build
```

Expected:
- `dist/index.html` lists Jackie Fielder (article), both subjects, and the index page.
- `dist/index/current-supervisors/index.html` lists D9 → Jackie Fielder → 2025-01-08.

**Step 5: Manual Lighthouse check** (from the executor's host, not CI)

Serve the built site and run Lighthouse on homepage, an article page, a subject page, and the index page:

```bash
npx http-server dist -p 4321 &
sleep 1
npx lighthouse http://localhost:4321/ --only-categories=accessibility --chrome-flags="--headless" --quiet
npx lighthouse http://localhost:4321/jackie-fielder --only-categories=accessibility --chrome-flags="--headless" --quiet
npx lighthouse http://localhost:4321/subjects/jackie-fielder --only-categories=accessibility --chrome-flags="--headless" --quiet
npx lighthouse http://localhost:4321/index/current-supervisors --only-categories=accessibility --chrome-flags="--headless" --quiet
# Kill the http-server:
kill %1 2>/dev/null || true
```

Expected: each page reports accessibility score ≥ 85. If lower, surface the Lighthouse finding to the operator before marking Phase 3 complete.

Revert fixture copy:

```bash
cd src/content/wiki && git checkout . && git clean -fd && cd -
```

**Step 6: Commit**

```bash
git add src/pages/
git commit -m "feat: homepage with content index and current-supervisors query page"
```

---

## Done when

- `npm run build` succeeds on the empty submodule and produces:
  - `dist/index.html` rendering the homepage ("No content yet…").
  - `dist/index/current-supervisors/index.html` rendering the query page ("No active supervisor claims…").
- Temporarily copying the Phase 2 fixtures into the submodule and running `npm run build` produces:
  - An article page at `dist/jackie-fielder/index.html` with prose, subject references, and a "Sources cited" section listing Mission Local's Nov 2024 article with both original and archive links.
  - Subject pages at `dist/subjects/jackie-fielder/index.html` and `dist/subjects/sf-board-of-supervisors/index.html`, each with a claims table and article backlinks.
  - Homepage lists the article, both subjects, and the indexes section.
  - Current-supervisors page lists D9 → Jackie Fielder → 2025-01-08.
- Lighthouse accessibility score on each of the three page types (article, subject, index) is ≥ 85.
- `getGraph()` is a single source of truth for page-time access to the subject graph (cached across page renders).
- `src/content/wiki/` submodule is reverted to its committed state before each task's commit (fixtures are not committed into submodule until Phase 5).
- Each task committed independently.
