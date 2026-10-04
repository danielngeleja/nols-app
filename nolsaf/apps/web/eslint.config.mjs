import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import reactHooks from 'eslint-plugin-react-hooks';

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
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

      // These newer "react-hooks/*" rules are extremely strict and currently
      // flag many existing patterns across the codebase (and some config files).
      // Keep the core hooks safety rules on (rules-of-hooks) and relax the rest.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',

      // This is very noisy for long-form policy/content pages.
      'react/no-unescaped-entities': 'off',
    },
  },

  // Config files commonly use require() for plugin loading.
  {
    files: ['tailwind.config.{js,ts}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Node's CommonJS tests intentionally use require() and a local module object.
  {
    files: ['**/*.test.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@next/next/no-assign-module-variable': 'off',
    },
  },
];

export default config;
