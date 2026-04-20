import { z } from 'zod';

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const claimId = z.string().regex(/^C[0-9]{3,}$/);
const friskiLocal = /F-[A-Za-z0-9-]+/;
const property = z.string().regex(new RegExp(`^(P[0-9]+|${friskiLocal.source})$`));
const value = z.string().regex(new RegExp(`^(Q[0-9]+|${friskiLocal.source})$`));

export const sourceSchema = z.object({
  id: slug,
  url: z.string().url(),
  publication: z.string().min(1),
  author: z.string().optional(),
  date_published: z.coerce.date().optional(),
  tier: z.number().int().min(1).max(4),
  archive: z.object({
    url: z.string().url(),
    method: z.enum(['wayback', 'archive_today', 'friski_warc', 'official_record']),
    access: z.enum(['public', 'private']).default('public'),
    hash: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
  }),
});

export const claimSchema = z.object({
  id: claimId,
  property: property,
  value: value,
  start: z.coerce.date().nullable().optional(),
  end: z.coerce.date().nullable().optional(),
  source: slug,  // exact-lookup into sources[] enforced by Phase 2 loader, not here
});

export const subjectSchema = z.object({
  id: slug,
  wikidata_qid: z.string().regex(/^Q[0-9]+$/).optional(),
  label: z.string().min(1),
  description: z.string().min(1),
  scope: z.array(z.string()).default([]),
  claims: z.array(claimSchema).min(1),
  sources: z.array(sourceSchema).min(1),
});

export const articleSchema = z.object({
  title: z.string().min(1),
  slug: slug,
  primary_subject: slug.optional(),
  subjects: z.array(slug).min(1),
  scope: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export type Source = z.infer<typeof sourceSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type Subject = z.infer<typeof subjectSchema>;
export type Article = z.infer<typeof articleSchema>;

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z as astroZ } from 'astro/zod';

// Rewrap schemas with astro/zod for collection registration compatibility.
// These parallel the standalone schemas but use astro/zod for defineCollection.
const subjectSchemaForCollections = astroZ.object({
  id: astroZ.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  wikidata_qid: astroZ.string().regex(/^Q[0-9]+$/).optional(),
  label: astroZ.string().min(1),
  description: astroZ.string().min(1),
  scope: astroZ.array(astroZ.string()).default([]),
  claims: astroZ.array(
    astroZ.object({
      id: astroZ.string().regex(/^C[0-9]{3,}$/),
      property: astroZ.string().regex(/^(P[0-9]+|F-[A-Za-z0-9-]+)$/),
      value: astroZ.string().regex(/^(Q[0-9]+|F-[A-Za-z0-9-]+)$/),
      start: astroZ.coerce.date().nullable().optional(),
      end: astroZ.coerce.date().nullable().optional(),
      source: astroZ.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    })
  ).min(1),
  sources: astroZ.array(
    astroZ.object({
      id: astroZ.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      url: astroZ.string().url(),
      publication: astroZ.string().min(1),
      author: astroZ.string().optional(),
      date_published: astroZ.coerce.date().optional(),
      tier: astroZ.number().int().min(1).max(4),
      archive: astroZ.object({
        url: astroZ.string().url(),
        method: astroZ.enum(['wayback', 'archive_today', 'friski_warc', 'official_record']),
        access: astroZ.enum(['public', 'private']).default('public'),
        hash: astroZ.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
      }),
    })
  ).min(1),
});

const articleSchemaForCollections = astroZ.object({
  title: astroZ.string().min(1),
  slug: astroZ.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  primary_subject: astroZ.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  subjects: astroZ.array(astroZ.string().regex(/^[a-z0-9][a-z0-9-]*$/)).min(1),
  scope: astroZ.array(astroZ.string()).default([]),
  tags: astroZ.array(astroZ.string()).default([]),
});

export const collections = {
  subjects: defineCollection({
    loader: glob({ pattern: 'subjects/*.yaml', base: './src/content/wiki' }),
    schema: subjectSchemaForCollections,
  }),
  articles: defineCollection({
    loader: glob({ pattern: 'articles/*.md', base: './src/content/wiki' }),
    schema: articleSchemaForCollections,
  }),
};
