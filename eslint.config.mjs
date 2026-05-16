// ESLint flat config (ESLint 9+ / 10+). Replaces the legacy .eslintrc.cjs.
// @nuxt/eslint v1 exposes a flat-config factory that wires Nuxt + Vue + TS
// rules without us hand-rolling parsers.
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports' },
    ],
  },
  ignores: ['.output', '.nuxt', 'node_modules', 'coverage', 'pnpm-lock.yaml'],
})
