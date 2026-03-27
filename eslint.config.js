import tseslint from 'typescript-eslint';
import noSqlTemplateLiterals from './eslint-rules/no-sql-template-literals.js';
import noApiKeyInUrl from './eslint-rules/no-api-key-in-url.js';

export default [
  {
    files: ['src/**/*.ts'],
    linterOptions: {
      // Existing codebase has @typescript-eslint disable comments for rules not
      // enforced here (security-only config). Suppress unused directive noise.
      reportUnusedDisableDirectives: 'off',
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      security: {
        rules: {
          'no-sql-template-literals': noSqlTemplateLiterals,
          'no-api-key-in-url': noApiKeyInUrl,
        },
      },
    },
    rules: {
      'security/no-sql-template-literals': 'error',
      'security/no-api-key-in-url': 'error',
    },
  },
];
