#!/usr/bin/env tsx
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { Octokit } from '@octokit/rest';
import { makeLLMClient, REVIEWER_MODEL } from './llm';
import { loadContent, loadPRContextFromEnv } from './context';
import { runCoverageCheck } from './checks/coverage';
import { runSupportCheck } from './checks/support';
import { runNpovCheck } from './checks/npov';
import { composeComment } from './compose';
import type { CheckResult, ReviewResult } from './types';

interface RunOptions {
  contentRoot: string;
  allowedTypesPath: string;
  editorialPrinciplesPath: string;
  changedArticles?: string[];   // restrict review to these article files; default: all
}

export async function runReview(opts: RunOptions): Promise<ReviewResult> {
  const { contextByArticle } = loadContent(
    opts.contentRoot,
    opts.allowedTypesPath,
    opts.editorialPrinciplesPath,
  );

  const targets = opts.changedArticles
    ? opts.changedArticles.filter((f) => contextByArticle.has(f))
    : Array.from(contextByArticle.keys());

  const llm = makeLLMClient();
  const results: CheckResult[] = [];

  for (const file of targets) {
    const ctx = contextByArticle.get(file)!;
    const [cov, npov] = await Promise.all([
      runCoverageCheck(ctx, llm),
      runNpovCheck(ctx, llm),
    ]);
    const sup = await runSupportCheck(ctx, llm);
    results.push(cov, sup, npov);
  }

  const totalFindings = results.reduce((n, r) => n + r.findings.length, 0);
  const hasErrors = results.some((r) => r.errors.length > 0);
  return { results, totalFindings, hasErrors };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'content-root': { type: 'string', default: 'src/content/wiki' },
      'allowed-types': { type: 'string', default: 'config/allowed-types.yaml' },
      'editorial-principles': { type: 'string', default: 'docs/editorial-principles.md' },
      'changed-files': { type: 'string' },   // comma-separated article files
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const changedArticles = values['changed-files']
    ? values['changed-files'].split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  const review = await runReview({
    contentRoot: resolve(values['content-root']!),
    allowedTypesPath: resolve(values['allowed-types']!),
    editorialPrinciplesPath: resolve(values['editorial-principles']!),
    changedArticles,
  });

  const comment = composeComment(review, REVIEWER_MODEL);

  if (values['dry-run']) {
    console.log(comment);
    return;
  }

  // Post to GitHub
  const prCtx = loadPRContextFromEnv();
  if (!prCtx) {
    console.error('No PR context found; printing instead of posting.');
    console.log(comment);
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN not set; printing instead of posting.');
    console.log(comment);
    return;
  }

  const octokit = new Octokit({ auth: token });
  await octokit.issues.createComment({
    owner: prCtx.repo.owner,
    repo: prCtx.repo.name,
    issue_number: prCtx.prNumber,
    body: comment,
  });
  console.log(`Posted review to PR #${prCtx.prNumber}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
