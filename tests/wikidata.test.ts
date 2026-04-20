import { describe, expect, test, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchWikidataEntity } from '../src/lib/wikidata';

const __dirname = dirname(fileURLToPath(import.meta.url));

function cannedResponse(name: string) {
  const path = join(__dirname, 'fixtures', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

afterEach(() => vi.restoreAllMocks());

describe('fetchWikidataEntity', () => {
  test('extracts label, description, and P31 values', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(cannedResponse('wikidata-q99524088')), { status: 200 }),
    );

    const entity = await fetchWikidataEntity('Q99524088');

    expect(entity.qid).toBe('Q99524088');
    expect(entity.label).toBe('Jackie Fielder');
    expect(entity.description).toMatch(/American politician/i);
    expect(entity.instanceOf).toContain('Q5');
  });

  test('throws on non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(fetchWikidataEntity('Q000')).rejects.toThrow(/404/);
  });
});
