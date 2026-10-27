import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://getclash.github.io',
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  build: { inlineStylesheets: 'never' },
});
