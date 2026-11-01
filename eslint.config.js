// lk3d's lint: the recommended rules, for browser modules (src/), Node scripts and tests.
import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['dist/', 'node_modules/', 'test-results/'] },
  js.configs.recommended,
  { files: ['src/**/*.js', 'examples/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  {
    files: ['*.mjs', 'docs/**/*.mjs', 'test/**/*.mjs', 'test/**/*.cjs', 'src/validate.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
