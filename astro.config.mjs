import { defineConfig } from 'astro/config';
import { rehypeRewireFootnotes } from './src/lib/rehype-rewire-footnotes.ts';

export default defineConfig({
  site: 'https://frisco.wiki',
  markdown: {
    rehypePlugins: [rehypeRewireFootnotes],
  },
});
