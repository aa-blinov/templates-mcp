module.exports = {
  root: true,
  extends: ['@nuxt/eslint-config'],
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
  },
  ignorePatterns: ['.output', '.nuxt', 'node_modules', 'coverage'],
}
