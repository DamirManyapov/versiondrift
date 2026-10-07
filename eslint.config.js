import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelteConfig from './apps/web/svelte.config.js';

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/build/',
    '**/coverage/',
    '**/.svelte-kit/',
    '**/.wrangler/',
    '.feed/',
    'design/',
    'schemas/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  svelte.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { parser: tseslint.parser, svelteConfig },
    },
    rules: {
      // Most hrefs are external URLs from the feed; internal links use resolve() by convention.
      'svelte/no-navigation-without-resolve': ['error', { ignoreLinks: true }],
      // A button without a type submits the form it sits in: every button says what it is.
      'svelte/button-has-type': 'error',
    },
  },
  {
    files: ['**/*.config.js', '**/*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  prettier,
  svelte.configs.prettier,
);
