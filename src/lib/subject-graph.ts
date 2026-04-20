import type { Article, Claim, Source, Subject } from '../content.config';

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
