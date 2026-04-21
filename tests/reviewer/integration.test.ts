import { describe, expect, test, vi, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runReview } from '../../scripts/reviewer/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(__dirname, '..', 'reviewer-fixtures');

// Mock globalThis.fetch to prevent real network calls during the support check.
// This allows the integration test to stay offline.
beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (typeof url !== 'string') {
      throw new Error('fetch called with non-string URL');
    }
    // Return a mock response that includes some text the LLM can reason about.
    return {
      ok: true,
      status: 200,
      text: async () => {
        if (url.includes('1234567890')) {
          // overreach fixture source
          return 'Fielder won the runoff 52-48.';
        }
        // Default for other sources
        return 'Source content placeholder.';
      },
    } as Response;
  }));
});

// Mock the LLM client module to return canned findings per fixture.
// This is an integration test of orchestration, NOT a live-API test.
vi.mock('../../scripts/reviewer/llm', async () => {
  const actual = await vi.importActual<typeof import('../../scripts/reviewer/llm')>('../../scripts/reviewer/llm');
  let currentFixture: string | null = null;

  return {
    ...actual,
    makeLLMClient: () => {
      // Reset fixture tracking on each new client creation
      currentFixture = null;

      return {
        callForFindings: async ({ systemPrompt, userPrompt }: { systemPrompt: string; userPrompt: string }) => {
          // On first call, detect which fixture by looking at article file path in the userPrompt
          if (currentFixture === null) {
            if (userPrompt.includes('Fielder chairs the Land Use Committee')) {
              currentFixture = 'claim-less-assertion';
            } else if (userPrompt.includes('She won the election by a landslide')) {
              currentFixture = 'overreach';
            } else if (userPrompt.includes('a notorious developer')) {
              currentFixture = 'advocacy-voice';
            } else {
              currentFixture = 'clean-baseline';
            }
          }

          const isCoverage = systemPrompt.includes('CLAIM COVERAGE');
          const isSupport = systemPrompt.includes('SOURCE SUPPORT');
          const isNpov = systemPrompt.includes('NPOV');

          if (currentFixture === 'claim-less-assertion' && isCoverage) {
            return { findings: [{ verdict: 'suspect' as const, message: 'No claim backs this assertion', assertion: 'Fielder chairs' }], errors: [] };
          }
          if (currentFixture === 'overreach' && isSupport) {
            return { findings: [{ verdict: 'suspect' as const, message: 'Prose says more than source supports', assertion: 'landslide', quote: 'won the runoff 52-48' }], errors: [] };
          }
          if (currentFixture === 'advocacy-voice' && isNpov) {
            return { findings: [{ verdict: 'suspect' as const, message: 'Loaded language: "notorious"', assertion: 'notorious developer' }], errors: [] };
          }
          return { findings: [], errors: [] };
        },
      };
    },
  };
});

function fixturePaths(name: string) {
  const root = join(fixturesRoot, name);
  return {
    contentRoot: root,
    allowedTypesPath: join(root, 'allowed-types.yaml'),
    editorialPrinciplesPath: join(root, 'editorial-principles.md'),
  };
}

describe('reviewer integration (mocked LLM)', () => {
  test('clean baseline produces zero findings', async () => {
    const review = await runReview(fixturePaths('clean-baseline'));
    expect(review.totalFindings).toBe(0);
    expect(review.hasErrors).toBe(false);
  });

  test('claim-less-assertion fixture produces a coverage finding', async () => {
    const review = await runReview(fixturePaths('claim-less-assertion'));
    const coverage = review.results.find((r) => r.check === 'coverage');
    expect(coverage!.findings.length).toBeGreaterThan(0);
    expect(coverage!.findings[0]!.verdict).toBe('suspect');
  });

  test('overreach fixture produces a support finding with quote', async () => {
    const review = await runReview(fixturePaths('overreach'));
    const support = review.results.find((r) => r.check === 'support');
    expect(support!.findings.length).toBeGreaterThan(0);
    expect(support!.findings[0]!.verdict).toBe('suspect');
    expect(support!.findings[0]!.quote).toBe('won the runoff 52-48');
  });

  test('advocacy-voice fixture produces an NPOV finding', async () => {
    const review = await runReview(fixturePaths('advocacy-voice'));
    const npov = review.results.find((r) => r.check === 'npov');
    expect(npov!.findings.length).toBeGreaterThan(0);
    expect(npov!.findings[0]!.verdict).toBe('suspect');
  });
});
