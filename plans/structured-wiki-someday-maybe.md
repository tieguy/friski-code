# Wiki 2.0: Research Notes

> Exploratory notes on building a next-generation encyclopedia platform with structured data, git-like fork/merge, and a clean document model. Started as a side quest in April 2026.

## The Core Problem

Existing wiki platforms make a series of tradeoffs that made sense in 2004 and are increasingly wrong in 2026:

- **Wikitext** as storage format: human-editable in a text editor, but structurally ambiguous, parser-hostile, and requires a massive parse stack to edit visually
- **Linear revision history**: per-page, no branching, no merging, no forking
- **Structured data as a bolt-on**: Wikidata exists alongside Wikipedia rather than being integrated into it
- **Hosting complexity**: MediaWiki requires PHP + MySQL + Parsoid (Node.js) + Elasticsearch + Redis/Memcached + job queue + Lua — effectively a small datacenter

The hypothesis: in 2026, with LLMs as editing assistants and modern browser-based editors, many of these tradeoffs can be revisited from scratch.

---

## Key Design Decisions

### 1. Storage format: JSON, not wikitext

If humans no longer need to edit raw markup (a 2004 assumption), the storage format can be structured JSON validated against a schema. This eliminates:

- The parser (the single biggest source of MediaWiki complexity)
- The round-trip serialization problem
- The wikitext/HTML impedance mismatch that makes Parsoid so complex

The storage format is **ProseMirror JSON** — the native serialization of ProseMirror's document model.

### 2. Document model: ProseMirror with a clean encyclopedic schema

[ProseMirror](https://prosemirror.net/) is a JavaScript toolkit for building rich text editors. It works on a **typed, schema-validated document tree** rather than raw HTML or markup. VIsualEditor (Wikipedia's editor) is built on ProseMirror, but is deeply entangled with wikitext compatibility.

A clean-sheet encyclopedic ProseMirror schema would define native node types for:
- Paragraphs, headings, lists (standard)
- **Citations** — first-class nodes, not footnote hacks
- **Infoboxes / structured data blocks** — typed, parameterized, queryable
- **Transclusion nodes** — templates as schema nodes with typed parameters, not text-that-gets-expanded
- **Categories / taxonomy**
- **Cross-page links** with awareness of link targets

This schema would be designed for legibility and LLM-editability, not wikitext round-trip compatibility.

### 3. Database: DoltDB

[DoltDB](https://www.dolthub.com/) is a MySQL-compatible database with native git-like branch/merge/commit semantics exposed as SQL procedures (`DOLT_COMMIT()`, `DOLT_BRANCH()`, `DOLT_MERGE()`, etc.).

This gives the platform:
- Per-row revision history
- Named branches (article forks)
- Merging with automatic conflict detection at the row level
- SQL-queryable diff history (`dolt_diff_$tablename`)

Storing ProseMirror JSON in Dolt means diffs have more semantic structure than line-based text diffs, and opens the door to LLM-assisted merge conflict resolution.

### 4. No wikitext, no Parsoid, no round-trip

The key liberating constraint: **one-way import only**. 

An importer can convert wikitext → clean ProseMirror JSON (via Parsoid's HTML output as an intermediate) without needing to serialize back. Round-trip fidelity is what makes Parsoid complex. A one-way importer is dramatically simpler.

This means existing Wikipedia content can be imported but the platform does not need to interoperate with the MediaWiki ecosystem going forward.

---

## The Editing Surface

Without wikitext, the editing surface is:

- **ProseMirror-based GUI editor** for human editing — requires writing toolbar + schema-specific node views (real work, but well-understood work; this is what ProseMirror is for)
- **LLM API** for programmatic/assisted editing — ProseMirror JSON is LLM-friendly; structured output constraints can enforce schema validity
- **Structured forms** for infobox-style fields — just a form that writes schema nodes

Notably: no VE, no wikitext, no Parsoid in the runtime stack. The editing stack is ProseMirror + your schema + a database API.

### LLM editing of ProseMirror documents

ProseMirror documents serialize to JSON natively. You can:
1. Pass a document (or fragment) to an LLM as JSON
2. Ask it to make changes ("add a citation to this claim", "convert this paragraph to an infobox")
3. Parse and validate the result against the schema

For small/medium articles this works today. For large articles, context window limits apply — requires operating on subtree fragments, which requires solving clean subtree boundary identification.

The more interesting longer-term application: using an LLM to assist with **merge conflict resolution**, because it understands document semantics, not just text diffs.

---

## What Nobody Has Built

A document model that unifies:
- Prose (ProseMirror-style typed tree)
- Structured data (Wikibase-style claims)  
- Transclusion (templates as typed nodes with parameters)
- Citations (first-class, queryable)

...with branching/merging storage underneath, a modern editing UX, and a tractable hosting story.

---

## Prior Art and Related Work

### Git for databases
- **[DoltDB](https://www.dolthub.com/)** — MySQL-compatible with git semantics. The most direct answer to "git but a database." Row-level merge with conflict surfacing.
- **[XTDB](https://xtdb.com/)** (formerly Crux) — bitemporal, immutable log, open source
- **[Datomic](https://www.datomic.com/)** — immutable fact log, point-in-time queries, Clojure ecosystem

### Structured wikis
- **[Wikibase](https://wikiba.se/)** — the open source software under Wikidata. Clean entity/claim/reference data model, revision history, but no fork/merge and no prose story.
- **[Semantic MediaWiki](https://www.semantic-mediawiki.org/)** — structured data as a MediaWiki extension. Carries all of MediaWiki's baggage.

### Modern wiki/knowledge base tools
- **[Wiki.js](https://js.wiki/)** — modern Node.js, good editor, structured data is an afterthought
- **[TiddlyWiki](https://tiddlywiki.com/)** — surprisingly powerful structured data model, very different UX paradigm
- None are "MediaWiki but lighter with branching"

### Document models
- **[Pandoc](https://pandoc.org/)** internal AST — a clean intermediate document representation
- **JATS XML** — structured format for academic/scientific publishing
- **Wikibase data model** — clean for structured data, no prose

---

## The Schema Bootstrapping Problem

Before writing any code, the right first step is: **what should the schema actually contain?**

### Proposed analysis pipeline

The goal is to inventory what wikitext constructs and templates are actually used in practice, then make keep/simplify/drop decisions for a clean-sheet schema.

**Step 1: Template frequency baseline**

Wikimedia publishes template transclusion statistics. Start here rather than corpus analysis — it's pre-aggregated and already ranked by importance.

- XTools template usage: `https://xtools.wmcloud.org/templatetransclusioncount`
- Wikimedia database dumps include `templatelinks` table
- Wikimedia maintains "most transcluded templates" lists as wiki pages

**Step 2: Native wikitext construct frequency**

Templates don't capture everything — tables, image syntax, certain list types, magic words are native wikitext constructs that never appear as templates.

The Parsoid team has tooling for this:

- **[dumpgrepper](https://github.com/wikimedia/dumpgrepper)**: `npm install dumpgrepper -g; bzcat dump.xml.bz2 | dumpgrepper <regexp>`
- Operates on actual wikitext from enwiki XML dumps (~22GB compressed)
- Single-pass per regexp, ~20 minutes per pass on full enwiki
- Has a `dumpGrepPatterns/` folder with example construct regexps
- For frequency analysis of many constructs simultaneously, fork `dumpReader.js` into a multi-pattern counter (straightforward)

The Parsoid team uses dump statistics internally to prioritize implementation work — this data exists but may only be in internal WMF documents or Phabricator task comments. The linter work ([T48705](https://phabricator.wikimedia.org/T48705)) implicitly encodes which constructs are common enough to bother linting.

**Step 3: LLM-assisted classification**

For each construct/template in the frequency-ranked list, classify:
- What is this semantically?
- Is this: content node / formatting node / metadata node / parser-workaround?
- Clean-sheet verdict: native schema node / drop / simplify / merge with another type

Human reviews and overrides; LLM processes the corpus.

**Step 4: Schema draft**

Aggregate keep/simplify decisions into a proposed ProseMirror schema. Document explicit drop decisions and rationale.

### Scope note

Probably 80% of article content uses ~20 node types. The long tail is large but mostly dispensable. Citations and infoboxes will dominate the "must have" structured data list. Much of Wikipedia's template complexity is working around parser limitations that a native schema would handle directly.

---

## Unresolved Hard Problems

### Templates / transclusion
The biggest remaining dragon. Options:
- Templates as **server-side components** (React-style, rendered at serve time)
- Templates as **schema nodes** with typed parameters that the editor knows how to render
- Some combination

Community pressure historically expands template complexity without bound. A typed schema with explicit node types may be the only way to hold the line.

### Merge conflict UX
Row-level Dolt merges surface conflicts, but prose merge conflicts need a UX. What does "two people edited the same paragraph on different branches" look like in an editor? This is an open product design problem.

### Hosting
The explicit goal is to be dramatically simpler than MediaWiki's stack. A target runtime: Node.js (or similar) + DoltDB. No separate parser service, no job queue, no Lua interpreter, no mandatory search cluster.

---

## What This Is Not

- Not a MediaWiki fork or extension
- Not trying to replace Wikipedia (which has massive community/governance complexity beyond the software)
- Not trying to preserve wikitext compatibility
- Not a general-purpose wiki (the schema is encyclopedic by design)

---

## Open Questions

1. What does the ProseMirror schema look like for transclusion? Templates as opaque nodes with typed parameters, or something more flexible?
2. How do you handle the "redlink" problem (links to articles that don't exist yet) in a branched environment?
3. What are the right merge semantics for structured data fields vs. prose?
4. Can Dolt's branch model map cleanly to Wikipedia-style editorial workflows (draft → review → publish)?
5. Is there a path to importing Wikidata entity data into the structured data layer?

---

## Tools / Links

- [DoltDB](https://www.dolthub.com/) — git-for-databases
- [ProseMirror](https://prosemirror.net/) — document model and editor toolkit
- [dumpgrepper](https://github.com/wikimedia/dumpgrepper) — enwiki XML dump analysis tool
- [Wikibase](https://wikiba.se/) — open source structured wiki software
- [Parsoid](https://www.mediawiki.org/wiki/Parsoid) — MediaWiki's wikitext↔HTML converter (reference/import use only)
- [Parsoid/About](https://www.mediawiki.org/wiki/Parsoid/About) — good technical overview of why wikitext is hard
- [Wikimedia dumps](https://dumps.wikimedia.org/backup-index.html) — enwiki `pages-articles` dump (~22GB compressed)
- [XTools](https://xtools.wmcloud.org/) — Wikimedia analytics including template usage stats
- [Linter extension / T48705](https://phabricator.wikimedia.org/T48705) — Parsoid's wikitext linting work, implicitly encodes construct frequency priorities
