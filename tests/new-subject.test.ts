import { describe, expect, test, vi, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { subjectSchema } from '../src/content-schemas';
import { scaffoldSubject } from '../scripts/new-subject';

const __dirname = dirname(fileURLToPath(import.meta.url));

afterEach(() => vi.restoreAllMocks());

describe('scaffoldSubject', () => {
  test('writes a schema-valid YAML for a fetched Wikidata entity', async () => {
    const canned = JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'wikidata-q99524088.json'), 'utf8'),
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(canned), { status: 200 })),
    );

    const outDir = mkdtempSync(join(tmpdir(), 'scaffold-'));
    try {
      const outPath = await scaffoldSubject({
        qid: 'Q99524088',
        slug: 'jackie-fielder',
        outputDir: outDir,
      });

      expect(existsSync(outPath)).toBe(true);

      const raw = readFileSync(outPath, 'utf8');
      const parsed = yaml.load(raw) as unknown;
      const result = subjectSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(`scaffolded YAML failed schema: ${JSON.stringify(result.error.issues, null, 2)}`);
      }
      expect(result.success).toBe(true);
      expect(result.data.id).toBe('jackie-fielder');
      expect(result.data.wikidata_qid).toBe('Q99524088');
      expect(result.data.claims.some((c) => c.property === 'P31' && c.value === 'Q5')).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  test('throws when target file already exists', async () => {
    const canned = JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'wikidata-q99524088.json'), 'utf8'),
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(canned), { status: 200 })),
    );

    const outDir = mkdtempSync(join(tmpdir(), 'scaffold-'));
    try {
      await scaffoldSubject({ qid: 'Q99524088', slug: 'jackie-fielder', outputDir: outDir });
      await expect(
        scaffoldSubject({ qid: 'Q99524088', slug: 'jackie-fielder', outputDir: outDir }),
      ).rejects.toThrow(/already exists/i);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
