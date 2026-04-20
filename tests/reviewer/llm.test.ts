import { describe, expect, test } from 'vitest';
import { parseFindings } from '../../scripts/reviewer/llm';

describe('parseFindings', () => {
  test('parses fenced YAML array with SIFT verdict', () => {
    const text = '```yaml\n- verdict: suspect\n  message: "Missing claim for Fielder"\n```';
    const { findings, errors } = parseFindings(text);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toBe('Missing claim for Fielder');
    expect(findings[0]!.verdict).toBe('suspect');
    expect(errors).toEqual([]);
  });

  test('parses findings key form', () => {
    const text = 'findings:\n  - message: "x"\n    verdict: incorrect';
    const { findings } = parseFindings(text);
    expect(findings[0]!.verdict).toBe('incorrect');
  });

  test('defaults verdict to plausible when omitted or invalid', () => {
    const text = '- message: "y"\n- verdict: nonsense\n  message: "z"';
    const { findings } = parseFindings(text);
    expect(findings[0]!.verdict).toBe('plausible');
    expect(findings[1]!.verdict).toBe('plausible');
  });

  test('preserves direct quote from support-check findings', () => {
    const text = '- verdict: incorrect\n  message: "Source contradicts"\n  assertion: "won by landslide"\n  quote: "won the runoff 52-48"';
    const { findings } = parseFindings(text);
    expect(findings[0]!.quote).toBe('won the runoff 52-48');
    expect(findings[0]!.assertion).toBe('won by landslide');
  });

  test('accepts all six SIFT verdict values', () => {
    const verdicts = ['verified-high', 'verified-low', 'plausible', 'unverifiable', 'suspect', 'incorrect'];
    for (const v of verdicts) {
      const { findings } = parseFindings(`- verdict: ${v}\n  message: "x"`);
      expect(findings[0]!.verdict).toBe(v);
    }
  });

  test('returns errors for unparseable YAML', () => {
    const { findings, errors } = parseFindings('not: valid: yaml: here');
    expect(findings).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });

  test('empty response yields empty findings and no errors', () => {
    expect(parseFindings('')).toEqual({ findings: [], errors: [] });
  });
});
