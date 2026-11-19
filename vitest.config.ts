import { readFileSync } from 'node:fs';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const schemaSql = ['0001_init.sql', '0002_budgets.sql']
  .map((file) => readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8'))
  .join('\n');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        compatibilityDate: '2026-08-01',
        compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
        d1Databases: ['DB'],
        bindings: {
          TEST_SCHEMA: schemaSql,
          PUBLIC_ORIGIN: 'https://exercise.example.com',
          MCP_RESOURCE_PATH: '/mcp',
          ALLOWED_USER_EMAILS: 'operator@example.com',
          ENABLED_DATA_DOMAINS: 'train',
          WRITE_TOOLS_ENABLED: 'false',
          UPSTREAM_TIMEOUT_MS: '5000',
          XUNJI_API_KEY: 'test-api-key-for-vitest',
          OWNER_PASSPHRASE: 'test-passphrase-for-vitest',
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    pool: '@cloudflare/vitest-pool-workers',
  },
});
