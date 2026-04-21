import type { ReviewResult, CheckResult, FindingVerdict } from './types';

const CHECK_LABEL: Record<CheckResult['check'], string> = {
  coverage: 'Claim coverage',
  support: 'Source support',
  npov: 'NPOV',
};

// Map each SIFT verdict to a display icon. Escalation runs left-to-right:
// verified-high → verified-low → plausible → unverifiable → suspect → incorrect.
// Findings are problems (rarely verified-*), but the mapping covers all six for
// completeness and for future positive-signal reporting.
const VERDICT_ICON: Record<FindingVerdict, string> = {
  'verified-high': '✅',
  'verified-low': '☑',
  plausible: 'ℹ',
  unverifiable: '❓',
  suspect: '⚠',
  incorrect: '✗',
};

const VERDICT_LABEL: Record<FindingVerdict, string> = {
  'verified-high': 'verified-high',
  'verified-low': 'verified-low',
  plausible: 'plausible',
  unverifiable: 'unverifiable',
  suspect: 'suspect',
  incorrect: 'incorrect',
};

export function composeComment(review: ReviewResult, model: string): string {
  const lines: string[] = [];
  const status = review.totalFindings === 0 && !review.hasErrors ? 'clean' : 'review';
  lines.push(`**Friski reviewer** · advisory · model: \`${model}\` · status: ${status}`);
  lines.push('');

  for (const r of review.results) {
    lines.push(`### ${CHECK_LABEL[r.check]}`);
    if (r.findings.length === 0 && r.errors.length === 0) {
      lines.push('✅ No findings.');
    } else {
      for (const f of r.findings) {
        const icon = VERDICT_ICON[f.verdict] ?? '·';
        const where = f.line ? `${f.file}:${f.line}` : f.file;
        const assertion = f.assertion ? `  \n> ${f.assertion}` : '';
        const sourceQuote = f.quote ? `  \n> > source: ${f.quote}` : '';
        lines.push(`- ${icon} \`${where}\` · **${VERDICT_LABEL[f.verdict]}** — ${f.message}${assertion}${sourceQuote}`);
      }
      for (const e of r.errors) {
        lines.push(`- 🔧 reviewer error: ${e}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
