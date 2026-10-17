import { defineConfig } from '@playwright/test';
const pagesBase=process.env.RIMMILE_TEST_PAGES_BASE??'/rimmile/';
export default defineConfig({
  testDir: './tests/browser', testMatch: 'production.spec.ts', workers: 1, timeout: 90000,
  outputDir: '../test-results/production',
  use: { baseURL: `http://127.0.0.1:4173${pagesBase}`, viewport: { width: 1440, height: 900 }, launchOptions: { args: process.env.RIMMILE_TEST_GPU==='d3d11'?['--use-angle=d3d11']:['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'npm run build && npm run preview -- --port 4173 --strictPort', url: `http://127.0.0.1:4173${pagesBase}`, reuseExistingServer: false, env: { VITE_ASSET_BASE_URL: '',VITE_PAGES_BASE_PATH:pagesBase } },
});
