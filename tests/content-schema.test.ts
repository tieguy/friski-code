import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import { subjectSchema } from '../src/content-schemas';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadYaml(path: string): unknown {
  const raw = readFileSync(join(__dirname, path), 'utf8');
  return yaml.load(raw);
}

describe('subjectSchema', () => {
  test('validates a hand-crafted valid subject YAML', () => {
    const data = loadYaml('fixtures/valid-subject.yaml');
    const result = subjectSchema.safeParse(data);
    if (!result.success) {
      throw new Error(
        `expected success, got: ${JSON.stringify(result.error.issues, null, 2)}`,
      );
    }
    expect(result.success).toBe(true);
  });

  test('rejects a subject with no claims', () => {
    const data = loadYaml('fixtures/valid-subject.yaml') as Record<string, unknown>;
    data.claims = [];
    const result = subjectSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test('rejects a claim with invalid P-number format', () => {
    const data = loadYaml('fixtures/valid-subject.yaml') as Record<string, unknown>;
    (data.claims as { property: string }[])[0].property = 'not-a-property';
    const result = subjectSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});
