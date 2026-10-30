// vite.config.mjs — build config for the static calculator site.
// `base: './'` keeps every asset relative so the site works on any
// GitHub Pages path (user.github.io/repo/...) without extra config.
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2022', // top-level await in src/main.mjs
  },
});