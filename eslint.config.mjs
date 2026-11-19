import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      '.wrangler/',
      '.wrangler-dry/',
      'coverage/',
      'dist/',
      'worker-configuration.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.worker,
      },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      // The Worker boundary validates external data with Zod and narrows
      // upstream `unknown` shapes deliberately; banned `any` here would only
      // push casts into less visible places.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Operational diagnostics go through console.warn/error on purpose.
      'no-console': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['site/client.js'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['scripts/render-cover.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
);
