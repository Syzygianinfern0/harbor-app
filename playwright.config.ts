import { defineConfig } from '@playwright/test';
// CI's macOS runners are slower than a Mac, and a few timing-sensitive specs fail there now and then. Retries there show
// up as "flaky" in the report rather than failing the run.
export default defineConfig({ testDir: './tests', testMatch: '**/*.spec.ts', timeout: 60000, workers: 1, retries: process.env.CI ? 2 : 0, reporter: 'list', use: { trace: 'retain-on-failure' } });
