// @ts-check
import js from '@eslint/js'
import globals from 'globals'

/** flat 配置：host 纯 JS（无 TS，本项目无构建步骤）。 */
export default [
  {
    ignores: ['node_modules/', 'lib/', 'dist/', 'tests/fixtures/'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/**/*.js'],
    rules: {
      // 测试里允许断言用的宽松模式
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
]
