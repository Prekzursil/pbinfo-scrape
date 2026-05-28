import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-desktop',
      'coverage',
      'release-desktop',
      'node_modules',
      'archive',
      'assets',
      'src/gui/renderer/assets/**',
      '**/*.css',
      '**/*.html',
      '**/*.svg',
      '.stylelintrc.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts,mjs,js}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Every function across the tree must stay at or below cyclomatic
      // complexity 10. This mirrors the lizard gate in scripts/verify.
      complexity: ['error', 10],
    },
  },
  {
    // Browser/renderer code runs in the Electron renderer (DOM) context.
    files: ['src/gui/renderer/**/*.{ts,tsx}', 'src/gui/preload/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ['src/gui/renderer/**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
);
