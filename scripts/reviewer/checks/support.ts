import type { CheckContext, CheckResult, Finding } from '../types';
import type { LLMClient } from '../llm';
import { SUPPORT_SYSTEM, supportUserPrompt } from '../prompts/support';

export async function runSupportCheck(
  ctx: CheckContext,
  llm: LLMClient,
  fetchSource: (url: string) => Promise<string> = defaultFetch,
): Promise<CheckResult> {
  const findings: Finding[] = [];
  const errors: string[] = [];

  // Unique sources cited in this article (via resolved footnotes).
  const citedSources = new Map<string, { id: string; publication: string; url: string }>();
  for (const fn of ctx.article.footnotes) {
    citedSources.set(fn.sourceId, {
      id: fn.sourceId,
      publication: fn.source.publication,
      url: fn.source.archive.url,
    });
  }

  for (const source of citedSources.values()) {
    let sourceText: string;
    try {
      sourceText = await fetchSource(source.url);
    } catch (e) {
      errors.push(`Failed to fetch ${source.id} (${source.url}): ${(e as Error).message}`);
      continue;
    }

    const { findings: raw, errors: parseErrs } = await llm.callForFindings({
      systemPrompt: SUPPORT_SYSTEM,
      userPrompt: supportUserPrompt(
        ctx.articleFile,
        ctx.article.body,
        source.id,
        source.publication,
        sourceText,
      ),
    });
    errors.push(...parseErrs);
    for (const r of raw) {
      findings.push({
        check: 'support',
        file: ctx.articleFile,
        verdict: r.verdict,
        message: `[${source.id}] ${r.message}`,
        assertion: r.assertion,
        quote: r.quote,
      });
    }
  }

  return { check: 'support', findings, errors };
}

async function defaultFetch(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'friski-reviewer/0.0' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  // Strip HTML tags for LLM consumption. Quick-and-dirty; good enough for Wayback HTML.
  return text.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
