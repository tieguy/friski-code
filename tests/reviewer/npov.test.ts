import { describe, expect, test, vi } from 'vitest';
import { runNpovCheck } from '../../scripts/reviewer/checks/npov';
import type { LLMClient } from '../../scripts/reviewer/llm';
import type { CheckContext } from '../../scripts/reviewer/types';

function fakeContext(body: string): CheckContext {
  return {
    graph: { subjects: new Map(), articles: new Map(), activeClaims: () => [], isLivingPerson: () => false, articlesReferencing: () => [] },
    article: { title: 't', slug: 't', subjects: ['t'], primary_subject: 't', scope: [], tags: [], body, footnotes: [] },
    articleFile: 'articles/t.md',
    editorialPrinciples: 'NPOV principles: attribute everything.',
  };
}

describe('runNpovCheck', () => {
  test('passes editorial-principles as cachedSystemContext', async () => {
    const callForFindings = vi.fn().mockResolvedValue({ findings: [], errors: [] });
    const llm: LLMClient = { callForFindings };

    await runNpovCheck(fakeContext('Body.'), llm);

    expect(callForFindings).toHaveBeenCalledOnce();
    const call = callForFindings.mock.calls[0]![0];
    expect(call.cachedSystemContext).toContain('NPOV');
  });

  test('propagates findings tagged as npov with SIFT verdict', async () => {
    const llm: LLMClient = {
      callForFindings: async () => ({
        findings: [{ verdict: 'suspect', message: 'Loaded language: "notorious"', assertion: 'a notorious developer' }],
        errors: [],
      }),
    };
    const result = await runNpovCheck(fakeContext('The notorious developer...'), llm);
    expect(result.findings[0]!.check).toBe('npov');
    expect(result.findings[0]!.verdict).toBe('suspect');
    expect(result.findings[0]!.message).toMatch(/loaded/i);
  });
});
