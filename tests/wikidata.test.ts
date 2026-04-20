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
    const canned = cannedResponse('wikidata-q99524088');
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(canned), { status: 200 })),
    );

    const entity = await fetchWikidataEntity('Q99524088');

    expect(entity.qid).toBe('Q99524088');
    expect(entity.label).toBe('Jackie Fielder');
    expect(entity.description).toMatch(/American politician/i);
    expect(entity.instanceOf).toContain('Q5');
  });

  test('sends a User-Agent identifying the scaffolder', async () => {
    const canned = cannedResponse('wikidata-q99524088');
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(canned), { status: 200 })),
    );
    await fetchWikidataEntity('Q99524088');
    const init = spy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/friski/i);
  });

  test('throws on non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(fetchWikidataEntity('Q000')).rejects.toThrow(/404/);
  });
});
