// Imperative shell: builds and caches the SubjectGraph from Astro collections at page render time.
import { getCollection } from 'astro:content';
import { basename } from 'node:path';
import { resolveArticle, type Subject, type ArticleFrontmatter } from '../content-schemas';
import { buildSubjectGraph, type SubjectGraph } from './subject-graph';

let cached: SubjectGraph | null = null;

// Astro's glob loader exposes `entry.id` as the path relative to the loader's
// base (e.g. `articles/mission-district` for `articles/mission-district.md`).
// resolveArticle wants a filename-only fallback slug, so strip the directory.
function entryIdToSlug(id: string): string {
  return basename(id);
}

export async function getGraph(): Promise<SubjectGraph> {
  if (cached) return cached;

  const subjectsCol = await getCollection('subjects');
  const articlesCol = await getCollection('articles');

  const subjects = subjectsCol.map((entry) => ({ id: (entry.data as Subject).id, data: entry.data as Subject }));
  const articles = articlesCol.map((entry) => {
    const resolved = resolveArticle(entry.data as ArticleFrontmatter, entryIdToSlug(entry.id));
    return {
      id: resolved.slug,
      data: resolved,
      body: entry.body ?? '',
    };
  });

  cached = buildSubjectGraph(subjects, articles);
  return cached;
}
