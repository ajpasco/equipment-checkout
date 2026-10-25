// ESLint's configuration for the conventions step (eval/conventions.sh). Read-only to every
// builder.
//
// Passed with --config, so ESLint reads this file and no configuration a builder puts under app/.
// The plugins are imported from eval/conventions/node_modules, installed from this folder's own
// lockfile.
//
// The rule sets are ESLint's recommended JavaScript rules, eslint-plugin-react's recommended rules
// for the automatic JSX runtime, and the recommended rules of eslint-plugin-react-hooks. They ran
// clean on the trunk's app/web when they joined the step, with one rule turned off and one turned
// on (docs/TECH-SPEC.md, section 14):
//   react/prop-types off: the client is JavaScript with no prop-types package (blueprint 12.10
//     names none), and the rule would ask for one on every component.
//   no-console on: the production build writes nothing to the console (the client convention).

import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  // A production build a builder made locally is not code it wrote.
  { ignores: ['app/web/dist/**'] },
  js.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    settings: { react: { version: '18.3' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'no-console': 'error',
    },
  },
  // Vite reads its configuration in Node, not in the browser.
  { files: ['**/vite.config.js'], languageOptions: { globals: { ...globals.node } } },
];
