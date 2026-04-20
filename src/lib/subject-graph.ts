// Functional core: in-memory subject-graph types. Populated by Phase 2 loader.
import type { Article, Claim, Source, Subject } from '../content-schemas';
import { extractFootnotes } from './footnote-parser';

// In-memory representation of the content corpus.
// Constructed in Phase 2 by the content loader; these are the shapes.

export interface SubjectGraph {
  readonly subjects: ReadonlyMap<string, SubjectNode>;
  readonly articles: ReadonlyMap<string, ArticleNode>;
  readonly activeClaims: (property: string) => readonly ActiveClaim[];
  readonly isLivingPerson: (subjectId: string) => boolean;
  readonly articlesReferencing: (subjectId: string) => readonly ArticleNode[];
}

export interface SubjectNode extends Subject {
  readonly types: readonly string[];
  readonly is_living_person: boolean;
  readonly sourcesById: ReadonlyMap<string, Source>;
  readonly claimsById: ReadonlyMap<string, Claim>;
}

export interface ArticleNode extends Article {
  readonly body: string;
  readonly footnotes: readonly ResolvedFootnote[];
}

export interface ResolvedFootnote {
  readonly label: string;       // as written in prose: [^label]
  readonly subjectId: string;
  readonly sourceId: string;
  readonly source: Source;
}

export interface ActiveClaim {
  readonly subjectId: string;
  readonly claim: Claim;
}

// Graph construction errors (thrown when the input violates invariants the
// caller is responsible for establishing — typically caught and reformatted
// by validate-content.ts into its error-reporting format).

export class FootnoteResolutionError extends Error {
  constructor(
    public readonly articleSlug: string,
    public readonly label: string,
    public readonly body: string,
    public readonly reason: 'no-match' | 'ambiguous',
    public readonly candidateSubjects: readonly string[] = [],
  ) {
    super(
      `Article ${articleSlug}: footnote [^${label}] -> "${body}" (${reason}` +
        (candidateSubjects.length ? `, candidates: ${candidateSubjects.join(', ')}` : '') +
        ')',
    );
  }
}

// Implementation -------------------------------------------------------------

interface SubjectInput {
  id: string;
  data: Subject;
}

interface ArticleInput {
  id: string;        // article slug
  data: Article;
  body: string;
}

const P31 = 'P31';
const P570 = 'P570';

/**
 * Build the in-memory subject graph from validated subject and article inputs.
 *
 * Throws FootnoteResolutionError if an article's footnote fails to resolve.
 * Does NOT enforce the wider validator rules (P31 allowlist, source uniqueness,
 * etc.) beyond what's needed to build the graph — the validator script layers
 * those checks on top.
 */
export function buildSubjectGraph(
  subjects: readonly SubjectInput[],
  articles: readonly ArticleInput[],
  _allowedTypes: readonly string[],  // unused here; validator enforces
): SubjectGraph {
  const subjectNodes = new Map<string, SubjectNode>();

  for (const { data } of subjects) {
    const sourcesById = new Map(data.sources.map((s) => [s.id, s]));
    const claimsById = new Map(data.claims.map((c) => [c.id, c]));
    const p31Values = data.claims.filter((c) => c.property === P31).map((c) => c.value);
    const hasDeathDate = data.claims.some((c) => c.property === P570);

    subjectNodes.set(data.id, {
      ...data,
      types: p31Values,
      is_living_person: p31Values.includes('Q5') && !hasDeathDate,
      sourcesById,
      claimsById,
    });
  }

  const articleNodes = new Map<string, ArticleNode>();

  for (const { data, body } of articles) {
    const footnoteMap = extractFootnotes(body);
    const resolvedFootnotes: ResolvedFootnote[] = [];

    for (const [label, refBody] of Object.entries(footnoteMap)) {
      const resolved = resolveFootnote(data, subjectNodes, label, refBody);
      resolvedFootnotes.push(resolved);
    }

    articleNodes.set(data.slug, {
      ...data,
      body,
      footnotes: resolvedFootnotes,
    });
  }

  const activeClaims = (property: string): readonly ActiveClaim[] => {
    const out: ActiveClaim[] = [];
    for (const [subjectId, node] of subjectNodes) {
      for (const claim of node.claims) {
        if (claim.property === property && (claim.end === null || claim.end === undefined)) {
          out.push({ subjectId, claim });
        }
      }
    }
    return out;
  };

  const isLivingPerson = (subjectId: string): boolean =>
    subjectNodes.get(subjectId)?.is_living_person ?? false;

  const articlesReferencing = (subjectId: string): readonly ArticleNode[] => {
    const out: ArticleNode[] = [];
    for (const article of articleNodes.values()) {
      if (article.subjects.includes(subjectId)) {
        out.push(article);
      }
    }
    return out;
  };

  return { subjects: subjectNodes, articles: articleNodes, activeClaims, isLivingPerson, articlesReferencing };
}

// Resolve a footnote body against the subjects an article declares.
// Body is either "source-id" (terse) or "subject-id/source-id" (explicit).
function resolveFootnote(
  article: Article,
  subjects: ReadonlyMap<string, SubjectNode>,
  label: string,
  body: string,
): ResolvedFootnote {
  const slash = body.indexOf('/');
  if (slash > 0) {
    const subjectId = body.slice(0, slash);
    const sourceId = body.slice(slash + 1);
    if (!article.subjects.includes(subjectId)) {
      throw new FootnoteResolutionError(article.slug, label, body, 'no-match', [subjectId]);
    }
    const source = subjects.get(subjectId)?.sourcesById.get(sourceId);
    if (!source) {
      throw new FootnoteResolutionError(article.slug, label, body, 'no-match', [subjectId]);
    }
    return { label, subjectId, sourceId, source };
  }

  // Terse form: search the article's subjects for a matching source.id.
  const matches: Array<{ subjectId: string; source: Source }> = [];
  for (const subjectId of article.subjects) {
    const source = subjects.get(subjectId)?.sourcesById.get(body);
    if (source) matches.push({ subjectId, source });
  }

  if (matches.length === 0) {
    throw new FootnoteResolutionError(article.slug, label, body, 'no-match', article.subjects);
  }
  if (matches.length > 1) {
    throw new FootnoteResolutionError(
      article.slug,
      label,
      body,
      'ambiguous',
      matches.map((m) => m.subjectId),
    );
  }
  return { label, subjectId: matches[0]!.subjectId, sourceId: body, source: matches[0]!.source };
}
