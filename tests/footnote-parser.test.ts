import { describe, expect, test } from 'vitest';
import { extractFootnotes } from '../src/lib/footnote-parser';

const article = `
Jackie Fielder is a member of the SF Board of Supervisors.[^fielder-elected]

Some prose with another ref.[^another]

[^fielder-elected]: missionlocal-2024-11-fielder-elected
[^another]: jackie-fielder/some-other-source
`;

describe('extractFootnotes', () => {
  test('extracts label-to-body mappings from GFM footnotes', () => {
    const result = extractFootnotes(article);
    expect(result).toEqual({
      'fielder-elected': 'missionlocal-2024-11-fielder-elected',
      'another': 'jackie-fielder/some-other-source',
    });
  });

  test('returns empty map when no footnotes present', () => {
    expect(extractFootnotes('Plain prose. No footnotes here.')).toEqual({});
  });

  test('ignores footnote references without definitions', () => {
    const text = 'Reference without definition.[^dangling]';
    expect(extractFootnotes(text)).toEqual({});
  });
});
