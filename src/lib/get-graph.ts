// Imperative shell: builds and caches the SubjectGraph from Astro collections at page render time.
import { getCollection } from 'astro:content';
import type { Subject, Article } from '../content-schemas';
import { buildSubjectGraph, type SubjectGraph } from './subject-graph';

let cached: SubjectGraph | null = null;

export async function getGraph(): Promise<SubjectGraph> {
  if (cached) return cached;

  const subjectsCol = await getCollection('subjects');
  const articlesCol = await getCollection('articles');

  const subjects = subjectsCol.map((entry) => ({ id: (entry.data as Subject).id, data: entry.data as Subject }));
  const articles = articlesCol.map((entry) => ({
    id: (entry.data as Article).slug,
    data: entry.data as Article,
    body: entry.body ?? '',
  }));

  cached = buildSubjectGraph(subjects, articles);
  return cached;
}
