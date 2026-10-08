import nextPlugin from '@next/eslint-plugin-next';
import { fixupPluginRules } from '@eslint/compat';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import noLocationAssignRelativeDestination from './eslint-rules/no-location-assign-relative-destination.mjs';

const nextPluginWithNavigationRule = {
  ...nextPlugin,
  rules: {
    ...nextPlugin.rules,
    'no-location-assign-relative-destination': noLocationAssignRelativeDestination,
  },
};

const typescriptFiles = ['**/*.{ts,tsx,mts,cts}'];

const config = [
  { ignores: ['.next/**', 'out/**', 'build/**', 'next-env.d.ts'] },
  ...tsPlugin.configs['flat/recommended'].map((entry) => ({
    ...entry,
    files: typescriptFiles,
  })),
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      import: importPlugin,
      'jsx-a11y': jsxA11y,
      '@next/next': fixupPluginRules(nextPluginWithNavigationRule),
    },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@next/next/no-location-assign-relative-destination': 'warn',
      'import/no-anonymous-default-export': 'warn',
      'react/no-unknown-property': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/jsx-no-target-blank': 'off',
      'jsx-a11y/alt-text': ['warn', { elements: ['img'], img: ['Image'] }],
      'jsx-a11y/aria-props': 'warn',
      'jsx-a11y/aria-proptypes': 'warn',
      'jsx-a11y/aria-unsupported-elements': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'warn',
      'jsx-a11y/role-supports-aria-props': 'warn',
    },
  },
  {
    plugins: { 'react-hooks': reactHooks, '@typescript-eslint': tsPlugin },
    linterOptions: { reportUnusedDisableDirectives: false },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_|^(e|err)$',
          caughtErrorsIgnorePattern: '^_|^(e|err)$',
        },
      ],
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/ban-ts-comment': ['warn', { 'ts-ignore': true }],
      '@next/next/no-css-tags': 'off',
      'react/forbid-dom-props': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    files: ['tailwind.config.{js,ts}', '**/*.test.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.test.cjs'],
    rules: { '@next/next/no-assign-module-variable': 'off' },
  },
];

export default config;
