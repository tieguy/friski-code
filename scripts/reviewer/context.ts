import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { subjectSchema, articleSchema, resolveArticle } from '../../src/content-schemas';
import { buildSubjectGraph } from '../../src/lib/subject-graph';
import type { CheckContext } from './types';

export interface PRContext {
  repo: { owner: string; name: string };
  prNumber: number;
  changedFiles: string[];
  dryRun: boolean;
}

export function loadPRContextFromEnv(): PRContext | null {
  // GitHub Actions populates these.
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!eventPath || !repo || !existsSync(eventPath)) return null;

  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const prNumber: number = event.pull_request?.number ?? event.number;
  if (!prNumber) return null;

  const [owner, name] = repo.split('/');
  return {
    repo: { owner: owner!, name: name! },
    prNumber,
    changedFiles: [],   // populated separately via octokit or a prior step
    dryRun: false,
  };
}

export interface LoadedContent {
  contextByArticle: Map<string, CheckContext>;
  editorialPrinciples: string;
}

// P31 allowlist enforcement is the validator's job (see scripts/validate-content.ts);
// the reviewer only validates editorial quality against the already-validated graph.
export function loadContent(
  contentRoot: string,
  editorialPrinciplesPath: string,
): LoadedContent {
  const subjectsDir = join(contentRoot, 'subjects');
  const articlesDir = join(contentRoot, 'articles');

  const subjects = readdirSyncFiltered(subjectsDir, '.yaml', '.yml').map((f) => {
    const data = subjectSchema.parse(yaml.load(readFileSync(join(subjectsDir, f), 'utf8')));
    return { id: data.id, data };
  });

  const articles = readdirSyncFiltered(articlesDir, '.md').map((f) => {
    const parsed = matter(readFileSync(join(articlesDir, f), 'utf8'));
    const parsed_data = articleSchema.parse(parsed.data);
    const data = resolveArticle(parsed_data, basename(f, '.md'));
    return { id: data.slug, data, body: parsed.content, file: `articles/${f}` };
  });

  const graph = buildSubjectGraph(
    subjects,
    articles.map(({ id, data, body }) => ({ id, data, body })),
  );

  const editorialPrinciples = readFileSync(editorialPrinciplesPath, 'utf8');

  const contextByArticle = new Map<string, CheckContext>();
  for (const a of articles) {
    const article = graph.articles.get(a.id);
    if (!article) continue;
    contextByArticle.set(a.file, {
      graph,
      article,
      articleFile: a.file,
      editorialPrinciples,
    });
  }

  return { contextByArticle, editorialPrinciples };
}

function readdirSyncFiltered(dir: string, ...exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => exts.some((e) => f.endsWith(e)));
}
