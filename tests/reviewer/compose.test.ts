import { describe, expect, test } from 'vitest';
import { composeComment } from '../../scripts/reviewer/compose';

describe('composeComment', () => {
  test('renders clean status on zero findings', () => {
    const out = composeComment(
      {
        results: [
          { check: 'coverage', findings: [], errors: [] },
          { check: 'support', findings: [], errors: [] },
          { check: 'npov', findings: [], errors: [] },
        ],
        totalFindings: 0,
        hasErrors: false,
      },
      'claude-sonnet-4-6',
    );
    expect(out).toMatch(/status: clean/);
    expect(out).toMatch(/No findings/);
  });

  test('renders finding with file, verdict icon + label, and assertion quote', () => {
    const out = composeComment(
      {
        results: [
          { check: 'coverage', findings: [{ check: 'coverage', file: 'articles/x.md', verdict: 'suspect', message: 'Missing claim', assertion: 'Fielder chairs Land Use' }], errors: [] },
          { check: 'support', findings: [], errors: [] },
          { check: 'npov', findings: [], errors: [] },
        ],
        totalFindings: 1,
        hasErrors: false,
      },
      'claude-sonnet-4-6',
    );
    expect(out).toContain('⚠');
    expect(out).toContain('suspect');
    expect(out).toContain('articles/x.md');
    expect(out).toContain('Missing claim');
    expect(out).toContain('> Fielder chairs Land Use');
  });

  test('renders source quote on support findings', () => {
    const out = composeComment(
      {
        results: [
          { check: 'coverage', findings: [], errors: [] },
          { check: 'support', findings: [{ check: 'support', file: 'articles/x.md', verdict: 'incorrect', message: '[ml-x] Source contradicts prose', assertion: 'won by landslide', quote: 'won the runoff 52-48' }], errors: [] },
          { check: 'npov', findings: [], errors: [] },
        ],
        totalFindings: 1,
        hasErrors: false,
      },
      'claude-sonnet-4-6',
    );
    expect(out).toContain('✗');
    expect(out).toContain('incorrect');
    expect(out).toContain('> won by landslide');
    expect(out).toContain('source: won the runoff 52-48');
  });

  test('renders unverifiable distinctly from suspect', () => {
    const out = composeComment(
      {
        results: [
          { check: 'coverage', findings: [], errors: [] },
          { check: 'support', findings: [{ check: 'support', file: 'articles/x.md', verdict: 'unverifiable', message: '[ml-x] Source silent on assertion', assertion: 'Fielder was endorsed by DSA' }], errors: [] },
          { check: 'npov', findings: [], errors: [] },
        ],
        totalFindings: 1,
        hasErrors: false,
      },
      'claude-sonnet-4-6',
    );
    expect(out).toContain('❓');
    expect(out).toContain('unverifiable');
    expect(out).not.toContain('suspect');
  });
});
