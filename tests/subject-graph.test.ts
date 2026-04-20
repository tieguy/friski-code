import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { buildSubjectGraph } from '../src/lib/subject-graph';
import { subjectSchema, articleSchema } from '../src/content-schemas';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixtures() {
  const subjectFiles = globSync('fixtures/subjects/*.yaml', { cwd: __dirname });
  const subjects = subjectFiles.map((rel) => {
    const raw = readFileSync(join(__dirname, rel), 'utf8');
    const data = subjectSchema.parse(yaml.load(raw));
    return { id: data.id, data };
  });

  const articleFiles = globSync('fixtures/articles/*.md', { cwd: __dirname });
  const articles = articleFiles.map((rel) => {
    const raw = readFileSync(join(__dirname, rel), 'utf8');
    const parsed = matter(raw);
    const data = articleSchema.parse(parsed.data);
    return { id: data.slug, data, body: parsed.content };
  });

  return { subjects, articles };
}

const ALLOWED_TYPES = ['Q5', 'Q43229', 'Q515', 'Q1048835', 'F-neighborhood', 'F-landmark'];

describe('buildSubjectGraph', () => {
  test('populates subjects and articles maps', () => {
    const { subjects, articles } = loadFixtures();
    const graph = buildSubjectGraph(subjects, articles, ALLOWED_TYPES);
    expect(graph.subjects.size).toBe(2);
    expect(graph.articles.size).toBe(1);
    expect(graph.subjects.has('jackie-fielder')).toBe(true);
  });

  test('derives types from P31 claims', () => {
    const { subjects, articles } = loadFixtures();
    const graph = buildSubjectGraph(subjects, articles, ALLOWED_TYPES);
    expect(graph.subjects.get('jackie-fielder')?.types).toEqual(['Q5']);
    expect(graph.subjects.get('sf-board-of-supervisors')?.types).toEqual(['Q43229']);
  });

  test('is_living_person true for human subject with no death date', () => {
    const { subjects, articles } = loadFixtures();
    const graph = buildSubjectGraph(subjects, articles, ALLOWED_TYPES);
    expect(graph.isLivingPerson('jackie-fielder')).toBe(true);
    expect(graph.isLivingPerson('sf-board-of-supervisors')).toBe(false);
  });

  test('articlesReferencing returns articles that list the subject', () => {
    const { subjects, articles } = loadFixtures();
    const graph = buildSubjectGraph(subjects, articles, ALLOWED_TYPES);
    const refs = graph.articlesReferencing('sf-board-of-supervisors');
    expect(refs.map((a) => a.slug)).toEqual(['jackie-fielder']);
  });

  test('activeClaims filters to claims with end=null', () => {
    const { subjects, articles } = loadFixtures();
    const graph = buildSubjectGraph(subjects, articles, ALLOWED_TYPES);
    const active = graph.activeClaims('P39');
    expect(active).toHaveLength(1);
    expect(active[0]?.subjectId).toBe('jackie-fielder');
  });

  test('footnotes resolved against subjects[] of the article', () => {
    const { subjects, articles } = loadFixtures();
    const graph = buildSubjectGraph(subjects, articles, ALLOWED_TYPES);
    const article = graph.articles.get('jackie-fielder');
    expect(article?.footnotes).toHaveLength(1);
    expect(article?.footnotes[0]?.subjectId).toBe('jackie-fielder');
    expect(article?.footnotes[0]?.sourceId).toBe('missionlocal-2024-11-fielder-elected');
  });
});
