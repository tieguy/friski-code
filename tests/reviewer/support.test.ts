import { describe, expect, test, vi } from 'vitest';
import { runSupportCheck } from '../../scripts/reviewer/checks/support';
import type { LLMClient } from '../../scripts/reviewer/llm';
import type { CheckContext, FindingVerdict } from '../../scripts/reviewer/types';

function mockLLM(responses: Array<Array<{ verdict: FindingVerdict; message: string; quote?: string; assertion?: string }>>): LLMClient {
  let callNum = 0;
  return {
    callForFindings: async () => {
      const findings = responses[callNum++] ?? [];
      return { findings, errors: [] };
    },
  };
}

function contextWithFootnote(): CheckContext {
  const source = {
    id: 'ml-fielder', url: 'https://web.archive.org/web/20260420/https://missionlocal.org/f',
    publication: 'Mission Local', tier: 1 as const,
    archive: {
      url: 'https://web.archive.org/web/20260420/https://missionlocal.org/f',
      method: 'wayback' as const,
      access: 'public' as const,
    },
  };
  return {
    graph: {
      subjects: new Map(), articles: new Map(),
      activeClaims: () => [], isLivingPerson: () => false, articlesReferencing: () => [],
    },
    article: {
      title: 'T', slug: 't', subjects: ['jackie-fielder'],
      primary_subject: 'jackie-fielder', scope: [], tags: [],
      body: 'Fielder served on the Board.[^ml]\n[^ml]: ml-fielder',
      footnotes: [{ label: 'ml', subjectId: 'jackie-fielder', sourceId: 'ml-fielder', source }],
    },
    articleFile: 'articles/t.md',
    editorialPrinciples: '',
  };
}

describe('runSupportCheck', () => {
  test('prefixes findings with source id and preserves verdict + quote', async () => {
    const llm = mockLLM([[{
      verdict: 'unverifiable',
      message: 'Source does not mention the district',
      quote: 'Fielder was elected.',
      assertion: 'Fielder represents District 9',
    }]]);
    const fetchSource = vi.fn().mockResolvedValue('Fielder was elected.');
    const result = await runSupportCheck(contextWithFootnote(), llm, fetchSource);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.message).toContain('[ml-fielder]');
    expect(result.findings[0]!.verdict).toBe('unverifiable');
    expect(result.findings[0]!.quote).toBe('Fielder was elected.');
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  test('passes untruncated source text to LLM', async () => {
    const callForFindings = vi.fn().mockResolvedValue({ findings: [], errors: [] });
    const llm: LLMClient = { callForFindings };
    const longSource = 'x'.repeat(80_000);
    const fetchSource = vi.fn().mockResolvedValue(longSource);

    await runSupportCheck(contextWithFootnote(), llm, fetchSource);

    const userPrompt = callForFindings.mock.calls[0]![0].userPrompt as string;
    expect(userPrompt).toContain(longSource);
    expect(userPrompt).not.toContain('[truncated]');
  });

  test('records fetch failure as an error, not a finding', async () => {
    const llm = mockLLM([[]]);
    const fetchSource = vi.fn().mockRejectedValue(new Error('timeout'));
    const result = await runSupportCheck(contextWithFootnote(), llm, fetchSource);
    expect(result.findings).toEqual([]);
    expect(result.errors[0]).toMatch(/timeout/);
  });
});
