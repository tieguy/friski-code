import type { CheckContext, CheckResult, Finding } from '../types';
import type { LLMClient } from '../llm';
import { NPOV_SYSTEM, npovUserPrompt } from '../prompts/npov';

export async function runNpovCheck(
  ctx: CheckContext,
  llm: LLMClient,
): Promise<CheckResult> {
  const { findings: raw, errors } = await llm.callForFindings({
    systemPrompt: NPOV_SYSTEM,
    cachedSystemContext: ctx.editorialPrinciples,  // prompt caching kicks in here
    userPrompt: npovUserPrompt(ctx.articleFile, ctx.article.body),
  });

  const findings: Finding[] = raw.map((r) => ({
    check: 'npov' as const,
    file: ctx.articleFile,
    verdict: r.verdict,
    message: r.message,
    assertion: r.assertion,
    quote: r.quote,  // preserve defensively even though NPOV doesn't request it
  }));

  return { check: 'npov', findings, errors };
}
