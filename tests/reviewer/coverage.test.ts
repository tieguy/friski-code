import { describe, expect, test } from 'vitest';
import { runCoverageCheck } from '../../scripts/reviewer/checks/coverage';
import type { LLMClient } from '../../scripts/reviewer/llm';
import type { CheckContext } from '../../scripts/reviewer/types';

import type { FindingVerdict } from '../../scripts/reviewer/types';

function mockLLM(findings: Array<{ verdict: FindingVerdict; message: string; assertion?: string }>): LLMClient {
  return {
    callForFindings: async () => ({ findings, errors: [] }),
  };
}

function fakeContext(): CheckContext {
  return {
    graph: {
      subjects: new Map(),
      articles: new Map(),
      activeClaims: () => [],
      isLivingPerson: () => false,
      articlesReferencing: () => [],
    },
    article: {
      title: 'Test', slug: 'test', subjects: ['jackie-fielder'],
      primary_subject: 'jackie-fielder', scope: [], tags: [],
      body: 'Test article body.',
      footnotes: [],
    },
    articleFile: 'articles/test.md',
    editorialPrinciples: 'irrelevant for this test',
  };
}

describe('runCoverageCheck', () => {
  test('propagates findings with check=coverage, file from context, and SIFT verdict', async () => {
    const llm = mockLLM([{ verdict: 'suspect', message: 'Missing claim for X', assertion: 'X happened' }]);
    const result = await runCoverageCheck(fakeContext(), llm);
    expect(result.check).toBe('coverage');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.file).toBe('articles/test.md');
    expect(result.findings[0]!.check).toBe('coverage');
    expect(result.findings[0]!.verdict).toBe('suspect');
  });

  test('empty findings when LLM returns empty', async () => {
    const llm = mockLLM([]);
    const result = await runCoverageCheck(fakeContext(), llm);
    expect(result.findings).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
