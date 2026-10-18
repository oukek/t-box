import antfu, { GLOB_TESTS } from '@antfu/eslint-config'

export default antfu(
  {
    typescript: true,
    vue: true,
    lessOpinionated: true,
    stylistic: {
      indent: 2,
      quotes: 'single',
      semi: false,
      braceStyle: '1tbs',
    },
    formatters: { css: true, html: true },
    // Dependency installation policies belong to pnpm-workspace.yaml.
    pnpm: false,
    ignores: ['**/pnpm-lock.yaml', '**/.eslintcache'],
    test: {
      files: [...GLOB_TESTS, '**/*.integration.ts', '**/*.manual.ts'],
      overrides: {
        // All workspace tests use Node's built-in test runner.
        'test/no-import-node-test': 'off',
        'test/consistent-test-it': 'off',
      },
    },
  },
  {
    files: ['**/src/**/*.{ts,vue}'],
    rules: { 'ts/no-explicit-any': 'error' },
  },
  {
    files: ['**/*.{ts,vue,js,mjs}'],
    rules: {
      'one-var': ['error', 'never'],
      'curly': ['error', 'all'],
      'style/brace-style': ['error', '1tbs', { allowSingleLine: false }],
      'style/arrow-parens': ['error', 'always'],
      // ASI guards belong at the start of the following line.
      'style/semi-style': ['error', 'first'],
      'style/operator-linebreak': [
        'error',
        'after',
        { overrides: { '?': 'before', ':': 'before' } },
      ],
      // Preserve the variance of existing SDK method contracts.
      'ts/method-signature-style': 'off',
      // Keep the existing string-coercion behavior during this style migration.
      'prefer-template': 'off',
    },
  },
  {
    files: ['**/*.vue'],
    rules: {
      'vue/max-attributes-per-line': ['error', { singleline: 2, multiline: 1 }],
      'vue/html-closing-bracket-newline': [
        'error',
        { singleline: 'never', multiline: 'always' },
      ],
      // Keep rendered text spacing when expanding attributes across lines.
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/prefer-template': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      // typescript-eslint 8.71 misclassifies Espree value references as types.
      'unused-imports/no-unused-vars': 'off',
      'no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: [
      'api/**/*.ts',
      'apps/*/server/**/*.ts',
      'packages/server-foundation/**/*.ts',
      'packages/*/test/**/*.mjs',
      'scripts/**/*.mjs',
      'deploy/api/**/*.mjs',
      'deploy/pm2/**/*.{mjs,cjs}',
      'capacitor/**/*.ts',
      'capacitor/scripts/**/*.mjs',
      '**/vite.config.ts',
      'eslint.config.mjs',
    ],
    rules: {
      'antfu/no-top-level-await': 'off',
      'node/prefer-global/process': ['error', 'always'],
      'node/prefer-global/buffer': ['error', 'always'],
    },
  },
  {
    files: [
      'api/test/**/*.ts',
      'app/test/**/*.ts',
      'packages/*/test/**/*.mjs',
      'scripts/**/*.mjs',
      'capacitor/scripts/**/*.mjs',
      'api/src/admin/bootstrap.ts',
      'api/src/identity/bootstrap.ts',
      'api/src/init-db.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['packages/*/test/**/*.mjs'],
    // These tests intentionally exercise the compiled package entry points.
    rules: { 'antfu/no-import-dist': 'off' },
  },
)
