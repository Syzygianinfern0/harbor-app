import { defineConfig } from '@playwright/test';
// Captures the landing page screenshots from the built app: `npm run build && npm run site:shots`.
export default defineConfig({ testDir: '.', testMatch: 'capture.spec.ts', timeout: 120000, workers: 1, reporter: 'list' });
