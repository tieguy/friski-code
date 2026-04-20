import { describe, expect, test, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { ensureArchivedInFile } from '../scripts/ensure-archived';

afterEach(() => vi.restoreAllMocks());

function makeSubjectWithPlaceholder(tmpRoot: string): string {
  mkdirSync(tmpRoot, { recursive: true });
  const subjectPath = join(tmpRoot, 'test-subject.yaml');

  // A subject with one source carrying an obvious placeholder archive URL
  // that ensureArchivedInFile should replace.
  const subject = {
    id: 'test-subject',
    label: 'Test Subject',
    description: 'Test description.',
    claims: [{ id: 'C000', property: 'P31', value: 'Q5', source: 'src1' }],
    sources: [{
      id: 'src1',
      url: 'https://missionlocal.org/example',
      publication: 'Mission Local',
      tier: 1,
      archive: {
        url: 'https://web.archive.org/web/2/https://missionlocal.org/example',  // placeholder
        method: 'wayback',
        access: 'public',
      },
    }],
  };
  writeFileSync(subjectPath, yaml.dump(subject), 'utf8');
  return subjectPath;
}

describe('ensureArchivedInFile', () => {
  test('replaces placeholder archive URLs with real snapshots', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ job_id: 'j1' }), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'success',
          timestamp: '20260420000000',
          original_url: 'https://missionlocal.org/example',
        }),
        { status: 200 },
      ),
    );

    const tmpRoot = mkdtempSync(join(tmpdir(), 'archival-'));
    try {
      const subjectPath = makeSubjectWithPlaceholder(tmpRoot);
      const result = await ensureArchivedInFile(subjectPath, { pollIntervalMs: 1 });

      expect(result.captured).toHaveLength(1);
      expect(result.skipped).toHaveLength(0);

      const after = yaml.load(readFileSync(subjectPath, 'utf8')) as { sources: Array<{ archive: { url: string } }> };
      expect(after.sources[0]!.archive.url).toBe(
        'https://web.archive.org/web/20260420000000/https://missionlocal.org/example',
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('leaves concrete snapshot URLs untouched', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const tmpRoot = mkdtempSync(join(tmpdir(), 'archival-'));
    try {
      const subjectPath = join(tmpRoot, 'already-archived.yaml');
      const subject = {
        id: 'already-archived',
        label: 'Already Archived',
        description: '.',
        claims: [{ id: 'C000', property: 'P31', value: 'Q5', source: 's' }],
        sources: [{
          id: 's',
          url: 'https://missionlocal.org/x',
          publication: 'Mission Local',
          tier: 1,
          archive: {
            url: 'https://web.archive.org/web/20240101120000/https://missionlocal.org/x',
            method: 'wayback',
            access: 'public',
          },
        }],
      };
      writeFileSync(subjectPath, yaml.dump(subject), 'utf8');

      const result = await ensureArchivedInFile(subjectPath, { pollIntervalMs: 1 });
      expect(result.captured).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
