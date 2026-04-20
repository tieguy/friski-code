import type { SubjectGraph, ArticleNode } from '../../src/lib/subject-graph';

// SIFT 6-class ordinal. Ordered from "strongly supports" to "directly contradicts".
// `verified-high` and `verified-low` rarely appear in emitted findings (findings are
// problems worth surfacing), but the vocabulary is stable across checks so downstream
// composers and logs have one schema. See architecture note for mapping per check.
export type FindingVerdict =
  | 'verified-high'
  | 'verified-low'
  | 'plausible'
  | 'unverifiable'
  | 'suspect'
  | 'incorrect';

export interface Finding {
  check: 'coverage' | 'support' | 'npov';
  file: string;                    // e.g., "articles/jackie-fielder.md"
  line?: number;                   // optional; if the check can point at a line
  verdict: FindingVerdict;
  message: string;                 // short, actionable
  assertion?: string;              // the prose snippet being flagged, if applicable
  quote?: string;                  // direct quote from fetched source (support check only)
}

export interface CheckContext {
  graph: SubjectGraph;
  article: ArticleNode;
  articleFile: string;             // relative path from content root, for finding.file
  editorialPrinciples: string;     // text of docs/editorial-principles.md
}

export interface CheckResult {
  check: Finding['check'];
  findings: Finding[];
  errors: string[];                // transport errors, parse failures — NOT editorial findings
}

export interface ReviewResult {
  results: CheckResult[];
  totalFindings: number;
  hasErrors: boolean;
}
