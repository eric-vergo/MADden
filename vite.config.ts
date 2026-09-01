import { defineConfig } from 'vite';
import process from 'node:process';

// GHPAGES=1 builds for project-pages hosting at /MADden/ (see
// .github/workflows/deploy-pages.yml); local dev and preview stay at /.
export default defineConfig({
  base: process.env.GHPAGES ? '/MADden/' : '/',
  server: { port: 5173 },
  build: { target: 'es2022' },
});
