#!/usr/bin/env tsx
// Imperative shell: content validator CLI. Loads fixtures from filesystem, validates via Zod + subject-graph invariants.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { ZodError } from 'zod';
import { subjectSchema, articleSchema, type Subject, type Article } from '../src/content-schemas';
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
    const data = parsed.data;

    // article.subjects are unique
    if (new Set(data.subjects).size !== data.subjects.length) {
      errors.push({
        file,
        rule: 'article-subjects-unique',
        message: 'Article has duplicate subject references',
      });
    }

    // primary_subject (if set) is in subjects[]
    if (data.primary_subject && !data.subjects.includes(data.primary_subject)) {
      errors.push({
        file,
        rule: 'primary-subject-in-subjects',
        message: `Primary subject "${data.primary_subject}" not in article's subjects list`,
      });
    }

    articles.push({ id: data.slug, data, body, file });
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
