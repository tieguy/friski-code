// Imperative shell: Astro content-collection registration. Wires schemas into the Astro content layer.
import { defineCollection, type BaseSchema } from 'astro:content';
import { glob } from 'astro/loaders';
import { subjectSchema, articleSchema } from './content-schemas';

// Astro's defineCollection types expect a zod-v4 (astro/zod) schema. Our
// standalone zod@3 schemas validate correctly at runtime via
// safeParseAsync but are nominally incompatible with the v4 type surface.
// Narrow cast via BaseSchema preserves type safety at this call site
// without pulling astro/zod into the schema module.
// NOTE: `astro check` and `astro build` emit a per-collection warning about
// failing JSON-schema generation (`TypeError: Cannot read properties of
// undefined (reading 'def')`). Astro's types generator attempts to read
// `schema._zod.def` (a zod-v4 internal) that our zod-v3 schemas don't
// expose. Runtime validation still succeeds via safeParseAsync. The
// JSON-schema output is used only for IDE frontmatter autocomplete; its
// absence is a DX trade-off, not a correctness issue.
export const collections = {
  subjects: defineCollection({
    loader: glob({ pattern: 'subjects/*.yaml', base: './src/content/wiki' }),
    schema: subjectSchema as unknown as BaseSchema,
  }),
  articles: defineCollection({
    loader: glob({ pattern: 'articles/*.md', base: './src/content/wiki' }),
    schema: articleSchema as unknown as BaseSchema,
  }),
};
