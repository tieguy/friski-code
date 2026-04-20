// Imperative shell: Astro content-collection registration. Wires schemas into the Astro content layer.
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { subjectSchema, articleSchema } from './content-schemas';

export const collections = {
  subjects: defineCollection({
    loader: glob({ pattern: 'subjects/*.yaml', base: './src/content/wiki' }),
    // astro/zod and standalone zod are structurally equivalent; cast to satisfy defineCollection's nominal type
    schema: subjectSchema as any,
  }),
  articles: defineCollection({
    loader: glob({ pattern: 'articles/*.md', base: './src/content/wiki' }),
    // astro/zod and standalone zod are structurally equivalent; cast to satisfy defineCollection's nominal type
    schema: articleSchema as any,
  }),
};
