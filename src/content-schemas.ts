// Functional core: pure Zod schemas for content validation. No runtime side effects.
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

// Frontmatter shape: slug, primary_subject, and subjects are all optional. A
// minimal article can write just `title`; the loader fills in the rest from
// the filename via resolveArticle.
export const articleSchema = z.object({
  title: z.string().min(1),
  slug: slug.optional(),
  primary_subject: slug.optional(),
  subjects: z.array(slug).min(1).optional(),
  scope: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export type Source = z.infer<typeof sourceSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type Subject = z.infer<typeof subjectSchema>;

// Raw shape as authored in frontmatter (with optional slug/subjects/primary).
export type ArticleFrontmatter = z.infer<typeof articleSchema>;

// Resolved shape after defaulting — what the graph builder, pages, and
// validator rules consume. All three identity fields are always present here.
export interface Article {
  title: string;
  slug: string;
  primary_subject: string;
  subjects: string[];
  scope: string[];
  tags: string[];
}

/**
 * Fill in slug/primary_subject/subjects defaults so the rest of the pipeline
 * doesn't need to handle their absence.
 *
 * Rules:
 *   - slug defaults to `fallbackSlug` (typically the filename without `.md`).
 *   - If neither subjects nor primary_subject is set: both default to [slug].
 *   - If only primary_subject is set: subjects becomes [primary_subject].
 *   - If only subjects is set: primary_subject becomes subjects[0].
 *   - If both are set: used verbatim; the validator checks primary ∈ subjects.
 */
export function resolveArticle(
  raw: ArticleFrontmatter,
  fallbackSlug: string,
): Article {
  const slugVal = raw.slug ?? fallbackSlug;
  const subjects = raw.subjects ?? (raw.primary_subject ? [raw.primary_subject] : [slugVal]);
  const primary_subject = raw.primary_subject ?? subjects[0]!;
  return {
    title: raw.title,
    slug: slugVal,
    primary_subject,
    subjects,
    scope: raw.scope,
    tags: raw.tags,
  };
}
