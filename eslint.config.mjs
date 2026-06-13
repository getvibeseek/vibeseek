import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import i18nextPlugin from 'eslint-plugin-i18next'
import globals from 'globals'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/out/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // core package: Electron imports forbidden
  {
    files: ['packages/core/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron'],
              message: '@vibeseek/core must not import electron — keep it renderer/UI agnostic',
            },
          ],
        },
      ],
    },
  },
  // desktop renderer: React rules
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    plugins: { react: reactPlugin, 'react-hooks': reactHooksPlugin, i18next: i18nextPlugin },
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Warn on hardcoded UI strings — they must go through i18n t() (T0.7).
      'i18next/no-literal-string': ['warn', { mode: 'jsx-text-only' }],
    },
  },
  prettierConfig
)
