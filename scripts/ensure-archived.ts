#!/usr/bin/env tsx
// Imperative shell: CLI that ensures each source has a concrete Wayback snapshot URL.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import yaml from 'js-yaml';
import { subjectSchema } from '../src/content-schemas';
import { captureViaWayback, type CaptureOptions } from '../src/lib/wayback';

// A "placeholder" archive URL has no concrete timestamp: Wayback's /web/2/<url>
// or /web/0/<url> patterns, or just doesn't point at web.archive.org at all.
const PLACEHOLDER_TIMESTAMP = /^https:\/\/web\.archive\.org\/web\/[012]\//;

function isPlaceholderArchive(archiveUrl: string): boolean {
  return PLACEHOLDER_TIMESTAMP.test(archiveUrl);
}

interface EnsureResult {
  captured: Array<{ sourceId: string; archivedUrl: string }>;
  skipped: Array<{ sourceId: string; reason: string }>;
}

export async function ensureArchivedInFile(
  filePath: string,
  opts: CaptureOptions = {},
): Promise<EnsureResult> {
  const raw = readFileSync(filePath, 'utf8');
  const data = yaml.load(raw);
  const subject = subjectSchema.parse(data);

  const captureOpts: CaptureOptions = {
    s3Key: process.env.ARCHIVE_ORG_S3_KEY,
    s3Secret: process.env.ARCHIVE_ORG_S3_SECRET,
    ...opts,
  };

  const result: EnsureResult = { captured: [], skipped: [] };

  for (const source of subject.sources) {
    if (!isPlaceholderArchive(source.archive.url)) {
      result.skipped.push({ sourceId: source.id, reason: 'already has concrete archive URL' });
      continue;
    }
    const capture = await captureViaWayback(source.url, captureOpts);
    source.archive.url = capture.archivedUrl;
    source.archive.method = 'wayback';
    result.captured.push({ sourceId: source.id, archivedUrl: capture.archivedUrl });
  }

  if (result.captured.length > 0) {
    const header = [
      '# Updated by ensure-archived — captured snapshot URLs written into source records.',
      '',
    ].join('\n');
    writeFileSync(filePath, header + yaml.dump(subject, { lineWidth: -1, sortKeys: false }), 'utf8');
  }

  return result;
}

// CLI entry ------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      url: { type: 'string' },
    },
  });

  if (values.url) {
    try {
      const capture = await captureViaWayback(values.url, {
        s3Key: process.env.ARCHIVE_ORG_S3_KEY,
        s3Secret: process.env.ARCHIVE_ORG_S3_SECRET,
      });
      console.log(capture.archivedUrl);
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`);
      process.exit(1);
    }
    return;
  }

  if (values.file) {
    try {
      const result = await ensureArchivedInFile(values.file);
      for (const c of result.captured) console.log(`✓ ${c.sourceId} → ${c.archivedUrl}`);
      for (const s of result.skipped) console.log(`· ${s.sourceId} (${s.reason})`);
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`);
      process.exit(1);
    }
    return;
  }

  console.error('Usage: ensure-archived --file <subject.yaml> | --url <url>');
  process.exit(2);
}

// Robust CLI entry guard using fileURLToPath pattern
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
