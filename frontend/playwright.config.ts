import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: ['game.spec.ts','mountains.spec.ts','prepolish.spec.ts','corrective.spec.ts','transmission.spec.ts','menus.spec.ts'], timeout: 90000, workers: 1,
  outputDir: '../test-results/browser',
  use: { baseURL: 'http://127.0.0.1:5175', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { args: process.env.RIMMILE_TEST_GPU==='d3d11'?['--use-angle=d3d11']:['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: { command: 'npm run dev -- --mode test --port 5175 --strictPort', url: 'http://127.0.0.1:5175', reuseExistingServer: false },
});
