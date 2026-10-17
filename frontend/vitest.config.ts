import {publicAssetPlugin} from '../scripts/asset-plugin.mjs';
import { defineConfig } from 'vitest/config';
export default defineConfig({ plugins:[publicAssetPlugin(false,'')],test: { include: ['frontend/tests/unit/**/*.test.ts'], maxWorkers: 2 } });
