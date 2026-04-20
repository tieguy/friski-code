import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
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

  test('flags missing archive.url via schema validation', () => {
    const root = makeCorpus(['_invalid-missing-archive-url.yaml'], []);
    const result = validate(root, allowedTypesPath);
    expect(result.errors.some((e) => e.rule.includes('archive.url') || e.rule === 'schema')).toBe(true);
  });

  test('flags tier out of range via schema validation', () => {
    const root = makeCorpus(['_invalid-tier-out-of-range.yaml'], []);
    const result = validate(root, allowedTypesPath);
    expect(result.errors.some((e) => e.rule.includes('tier') || e.rule === 'schema')).toBe(true);
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
    // Use a dedicated fixture that has the wd-jackie-fielder source
    // defined on both jackie-fielder and sf-board-of-supervisors subjects,
    // making the footnote ambiguous. The _ambiguity-sf-bos.yaml fixture
    // has the same id (sf-board-of-supervisors) and includes wd-jackie-fielder
    // as a source, creating ambiguity when combined with jackie-fielder.yaml.
    const root = makeCorpus(
      ['jackie-fielder.yaml', '_ambiguity-sf-bos.yaml'],
      ['_invalid-footnote-ambiguous.md'],
    );
    // The fixture file _ambiguity-sf-bos.yaml has id: sf-board-of-supervisors
    // so it will be copied as _ambiguity-sf-bos.yaml in the temp dir.
    // Copy it to the expected name for the article reference to work.
    const srcPath = join(root, 'subjects', '_ambiguity-sf-bos.yaml');
    const destPath = join(root, 'subjects', 'sf-board-of-supervisors.yaml');
    copyFileSync(srcPath, destPath);
    rmSync(srcPath);
    const result = validate(root, allowedTypesPath);
    expect(result.errors.some((e) => e.rule === 'footnote-ambiguous')).toBe(true);
  });

  test('flags article with duplicate subject references', () => {
    const root = makeCorpus(['jackie-fielder.yaml'], ['_invalid-duplicate-subject-ref.md']);
    const result = validate(root, allowedTypesPath);
    expect(result.errors.some((e) => e.rule === 'article-subjects-unique')).toBe(true);
  });

  test('flags article where primary_subject not in subjects[]', () => {
    const root = makeCorpus(['jackie-fielder.yaml', 'sf-board-of-supervisors.yaml'], ['_invalid-primary-not-in-subjects.md']);
    const result = validate(root, allowedTypesPath);
    expect(result.errors.some((e) => e.rule === 'primary-subject-in-subjects')).toBe(true);
  });

  test('flags duplicate subject.id across fixtures', () => {
    const root = makeCorpus(
      ['jackie-fielder.yaml', '_invalid-duplicate-subject-id.yaml'],
      [],
    );
    const result = validate(root, allowedTypesPath);
    expect(result.errors.some((e) => e.rule === 'subject-id-unique')).toBe(true);
  });

  test('surfaces footnote errors alongside schema errors', () => {
    const root = makeCorpus(
      ['_invalid-missing-archive-url.yaml', 'jackie-fielder.yaml'],
      ['_invalid-footnote-unresolved.md'],
    );
    const result = validate(root, allowedTypesPath);
    // Should have at least two errors: one schema-related and one footnote-related
    const hasSchemaError = result.errors.some((e) => e.rule.startsWith('schema'));
    const hasFootnoteError = result.errors.some((e) => e.rule === 'footnote-no-match');
    expect(hasSchemaError).toBe(true);
    expect(hasFootnoteError).toBe(true);
  });
});
