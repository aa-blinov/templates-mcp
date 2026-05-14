/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'chore', 'test', 'refactor', 'ci', 'perf', 'build', 'revert'],
    ],
    'scope-enum': [
      1,
      'always',
      ['tools', 'client', 'auth', 'deploy', 'evals', 'skill', 'feedback', 'deps', 'docs', 'ci'],
    ],
    'header-max-length': [2, 'always', 100],
  },
}
