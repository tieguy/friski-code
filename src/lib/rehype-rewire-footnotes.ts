// Functional core: rehype plugin that rewires GFM auto-footnotes to point at our Citation <li> ids.
import type { Root, Element } from 'hast';
import { visit } from 'unist-util-visit';

export function rehypeRewireFootnotes() {
  return (tree: Root) => {
    // 1. Rewrite anchor href prefixes
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return;
      const href = node.properties?.href;
      if (typeof href !== 'string') return;
      if (href.startsWith('#user-content-fn-')) {
        node.properties!.href = '#fn-' + href.slice('#user-content-fn-'.length);
        delete node.properties!.ariaDescribedBy;
      } else if (href.startsWith('#user-content-fnref-')) {
        node.properties!.href = '#fnref-' + href.slice('#user-content-fnref-'.length);
      }
    });

    // 2. Strip the auto-generated <section data-footnotes>
    tree.children = tree.children.filter((child) => {
      if (child.type !== 'element') return true;
      const el = child as Element;
      if (el.tagName !== 'section') return true;
      const dataFootnotes = el.properties?.dataFootnotes;
      // hast represents `data-footnotes` as `dataFootnotes` property
      return dataFootnotes === undefined;
    });
  };
}
