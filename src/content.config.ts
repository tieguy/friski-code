import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { subjectSchema, articleSchema } from './content.schemas';

export const collections = {
  subjects: defineCollection({
    loader: glob({ pattern: 'subjects/*.yaml', base: './src/content/wiki' }),
    schema: subjectSchema,
  }),
  articles: defineCollection({
    loader: glob({ pattern: 'articles/*.md', base: './src/content/wiki' }),
    schema: articleSchema,
  }),
};
