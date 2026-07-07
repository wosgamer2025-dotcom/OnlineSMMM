import globals from 'globals';
import react from 'eslint-plugin-react';

export default [
  {
    files: ['**/*.{js,jsx,mjs}'],
    ignores: ['dist/**', 'node_modules/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'react/jsx-uses-react': 'error',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-vars': 'error',
    },
  },
];
