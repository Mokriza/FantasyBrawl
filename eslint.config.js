// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Layer isolation, see docs/ai/architecture.md.
 * core -> nothing but content types and the standard library
 * ai   -> core only
 * sim  -> core, ai, node
 * ui   -> everything
 *
 * These rules are a hard requirement of CLAUDE.md. Do not disable them.
 */
const forbiddenInCore = [
  { group: ['**/ui/**', '**/ai/**', '**/sim/**'], message: 'core must not depend on ui, ai or sim.' },
  { group: ['react', 'react-dom', 'react/*', 'react-dom/*'], message: 'core must run in Node without React.' },
  { group: ['pixi.js', 'pixi.js/*'], message: 'core must run in Node without Pixi.' },
];

const forbiddenInAi = [
  { group: ['**/ui/**', '**/sim/**'], message: 'ai depends on core only.' },
  { group: ['react', 'react-dom', 'pixi.js'], message: 'ai must run in Node.' },
];

const forbiddenInSim = [
  { group: ['**/ui/**'], message: 'sim must run headless.' },
  { group: ['react', 'react-dom', 'pixi.js'], message: 'sim must run headless.' },
];

// Randomness and wall-clock time must go through the seeded Rng that lives in state.
const noAmbientNondeterminism = [
  {
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message: 'Use the seeded Rng from core/rng.ts. See CLAUDE.md rule 2.',
  },
  {
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message: 'Wall-clock time is not allowed here. See CLAUDE.md rule 2.',
  },
  {
    selector: "NewExpression[callee.name='Date']",
    message: 'Wall-clock time is not allowed here. See CLAUDE.md rule 2.',
  },
];

const noDomGlobals = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'alert'];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: forbiddenInCore }],
      'no-restricted-syntax': ['error', ...noAmbientNondeterminism],
      'no-restricted-globals': ['error', ...noDomGlobals],
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    files: ['src/ai/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: forbiddenInAi }],
      'no-restricted-syntax': ['error', ...noAmbientNondeterminism],
      'no-restricted-globals': ['error', ...noDomGlobals],
    },
  },
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: forbiddenInSim }],
      'no-restricted-syntax': ['error', ...noAmbientNondeterminism],
    },
  },
);
