import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser',testMatch:'release.spec.ts',workers:1,timeout:90000,
 outputDir:'../test-results/release',
 use:{baseURL:'http://127.0.0.1:4174/rimmile/',viewport:{width:1280,height:720}},
 projects:[{name:'chromium',use:{browserName:'chromium',launchOptions:{args:process.env.RIMMILE_TEST_GPU==='d3d11'?['--use-angle=d3d11']:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}}},{name:'webkit',use:{browserName:'webkit'}}],
 webServer:[
  {command:'npm run assets:dev',url:'http://127.0.0.1:8787/manifest.json',reuseExistingServer:false},
  {command:'npm run build:frontend && npm run preview -- --port 4174 --strictPort',env:{VITE_ASSET_BASE_URL:'http://127.0.0.1:8787',VITE_PAGES_BASE_PATH:'/rimmile/'},url:'http://127.0.0.1:4174/rimmile/',reuseExistingServer:false}
 ]
});
