// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  prettierConfig,
  {
    ignores: [
      'lib/**/*.js',
      'bin/**/*.js',
      'jest.config.js',
      '**.d.ts',
      'dist/**/*',
      'node_modules/**/*',
      // Emitted end-to-end tests (produced by generate-tests, not hand-authored;
      // R-119a). They target the live apps and are the runner's concern, so they
      // are never linted — matches the .prettierignore and vitest excludes.
      'generated-tests/**/*',
    ],
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  }
);
