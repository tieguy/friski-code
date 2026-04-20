import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import { subjectSchema, articleSchema, resolveArticle } from '../src/content-schemas';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadYaml(path: string): unknown {
  const raw = readFileSync(join(__dirname, path), 'utf8');
  return yaml.load(raw);
}

describe('subjectSchema', () => {
  test('validates a hand-crafted valid subject YAML', () => {
    const data = loadYaml('fixtures/subjects/jackie-fielder.yaml');
    const result = subjectSchema.safeParse(data);
    if (!result.success) {
      throw new Error(
        `expected success, got: ${JSON.stringify(result.error.issues, null, 2)}`,
      );
    }
    expect(result.success).toBe(true);
  });

  test('rejects a subject with no claims', () => {
    const data = loadYaml('fixtures/subjects/jackie-fielder.yaml') as Record<string, unknown>;
    data.claims = [];
    const result = subjectSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test('rejects a claim with invalid P-number format', () => {
    const data = loadYaml('fixtures/subjects/jackie-fielder.yaml') as Record<string, unknown>;
    (data.claims as { property: string }[])[0].property = 'not-a-property';
    const result = subjectSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe('articleSchema + resolveArticle', () => {
  test('accepts minimal frontmatter (title only) and fills defaults from filename', () => {
    const parsed = articleSchema.parse({ title: 'Mission District' });
    const resolved = resolveArticle(parsed, 'mission-district');
    expect(resolved.slug).toBe('mission-district');
    expect(resolved.primary_subject).toBe('mission-district');
    expect(resolved.subjects).toEqual(['mission-district']);
    expect(resolved.title).toBe('Mission District');
    expect(resolved.scope).toEqual([]);
    expect(resolved.tags).toEqual([]);
  });

  test('explicit subjects array with no primary_subject → primary defaults to first subject', () => {
    const parsed = articleSchema.parse({
      title: 'Cross-Reference Article',
      subjects: ['jackie-fielder', 'sf-board-of-supervisors'],
    });
    const resolved = resolveArticle(parsed, 'cross-reference-article');
    expect(resolved.subjects).toEqual(['jackie-fielder', 'sf-board-of-supervisors']);
    expect(resolved.primary_subject).toBe('jackie-fielder');
    expect(resolved.slug).toBe('cross-reference-article');
  });

  test('explicit primary_subject with no subjects → subjects defaults to [primary]', () => {
    const parsed = articleSchema.parse({
      title: 'Primary Only',
      primary_subject: 'custom-slug',
    });
    const resolved = resolveArticle(parsed, 'file-name');
    expect(resolved.subjects).toEqual(['custom-slug']);
    expect(resolved.primary_subject).toBe('custom-slug');
    expect(resolved.slug).toBe('file-name');
  });

  test('explicit slug overrides filename fallback', () => {
    const parsed = articleSchema.parse({ title: 'X', slug: 'explicit-slug' });
    const resolved = resolveArticle(parsed, 'whatever');
    expect(resolved.slug).toBe('explicit-slug');
  });

  test('rejects missing title', () => {
    const result = articleSchema.safeParse({ slug: 'x' });
    expect(result.success).toBe(false);
  });

  test('rejects empty subjects array when explicitly provided', () => {
    const result = articleSchema.safeParse({ title: 'X', subjects: [] });
    expect(result.success).toBe(false);
  });
});
