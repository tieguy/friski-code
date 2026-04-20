// Functional core: extracts GFM footnote definitions from markdown. Pure.

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';

/**
 * Extracts GFM footnote definitions from a markdown body.
 * Returns `{ [label]: body }` for every `[^label]: body` definition.
 * Footnote references without definitions are silently skipped.
 */
export function extractFootnotes(markdown: string): Record<string, string> {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const footnotes: Record<string, string> = {};

  visit(tree, 'footnoteDefinition', (node) => {
    footnotes[node.identifier] = toString(node).trim();
  });

  return footnotes;
}
