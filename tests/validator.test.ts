import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
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
    expect(result.errors.some((e) => e.rule === 'schema')).toBe(true);
  });

  test('flags tier out of range via schema validation', () => {
    const root = makeCorpus(['_invalid-tier-out-of-range.yaml'], []);
    const result = validate(root, allowedTypesPath);
    expect(result.errors.some((e) => e.rule === 'schema')).toBe(true);
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
});
