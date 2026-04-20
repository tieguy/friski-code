#!/usr/bin/env tsx
// Imperative shell: CLI that scaffolds a new subject YAML from a Wikidata QID.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import yaml from 'js-yaml';
import { fetchWikidataEntity } from '../src/lib/wikidata';
import { subjectSchema } from '../src/content-schemas';

export interface ScaffoldOptions {
  qid: string;
  slug: string;
  outputDir: string;
}

export async function scaffoldSubject(opts: ScaffoldOptions): Promise<string> {
  const outPath = join(opts.outputDir, `${opts.slug}.yaml`);
  if (existsSync(outPath)) {
    throw new Error(`Target file already exists: ${outPath}`);
  }
  mkdirSync(opts.outputDir, { recursive: true });

  const entity = await fetchWikidataEntity(opts.qid);

  const wikidataSourceId = `wd-${opts.slug}`;
  const seedData = {
    id: opts.slug,
    wikidata_qid: opts.qid,
    label: entity.label,
    description: entity.description || 'DESCRIPTION NEEDED',
    scope: [] as string[],
    claims: entity.instanceOf.map((typeValue, i) => ({
      id: `C${String(i).padStart(3, '0')}`,
      property: 'P31',
      value: typeValue,
      source: wikidataSourceId,
    })),
    sources: [
      {
        id: wikidataSourceId,
        url: `https://www.wikidata.org/wiki/${opts.qid}`,
        publication: 'Wikidata',
        tier: 2 as const,
        archive: {
          url: `https://web.archive.org/web/2/https://www.wikidata.org/wiki/${opts.qid}`,
          method: 'wayback' as const,
          access: 'public' as const,
        },
      },
    ],
  };

  // Validate before writing
  const validated = subjectSchema.parse(seedData);

  const header = [
    '# Scaffolded from Wikidata. Fill in description and add subject-specific claims.',
    `# Source: https://www.wikidata.org/wiki/${opts.qid}`,
    '',
  ].join('\n');

  writeFileSync(outPath, header + yaml.dump(validated, { lineWidth: -1, sortKeys: false }), 'utf8');
  return outPath;
}

// CLI entry ------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      qid: { type: 'string' },
      slug: { type: 'string' },
      'output-dir': { type: 'string', default: 'src/content/wiki/subjects' },
    },
  });

  if (!values.qid || !values.slug) {
    console.error('Usage: new-subject --qid <QID> --slug <slug> [--output-dir <dir>]');
    process.exit(2);
  }

  try {
    const outPath = await scaffoldSubject({
      qid: values.qid,
      slug: values.slug,
      outputDir: values['output-dir']!,
    });
    console.log(`✓ wrote ${outPath}`);
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  }
}

const isMainModule = (() => {
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main();
}
