import yaml from 'js-yaml';
import type { CheckContext, CheckResult, Finding } from '../types';
import type { LLMClient } from '../llm';
import { COVERAGE_SYSTEM, coverageUserPrompt } from '../prompts/coverage';

export async function runCoverageCheck(
  ctx: CheckContext,
  llm: LLMClient,
): Promise<CheckResult> {
  const referenced = ctx.article.subjects
    .map((sid) => ctx.graph.subjects.get(sid))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  const subjectsYaml = yaml.dump(
    referenced.map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      claims: s.claims,
      sources: s.sources.map((src) => ({
        id: src.id,
        publication: src.publication,
        date_published: src.date_published,
        tier: src.tier,
      })),
    })),
    { lineWidth: -1 },
  );

  const { findings: raw, errors } = await llm.callForFindings({
    systemPrompt: COVERAGE_SYSTEM,
    userPrompt: coverageUserPrompt(ctx.articleFile, ctx.article.body, subjectsYaml),
  });

  const findings: Finding[] = raw.map((r) => ({
    check: 'coverage' as const,
    file: ctx.articleFile,
    verdict: r.verdict,
    message: r.message,
    assertion: r.assertion,
    line: r.line,
  }));

  return { check: 'coverage', findings, errors };
}
