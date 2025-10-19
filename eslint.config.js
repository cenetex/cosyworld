// Flat config for ESLint v9
// Keep it lightweight and non-blocking by default.

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'images/**',
      'public/**',
      'docs/**',
      'coverage/**',
      'data/**/*.json',
      'src/utils/schemaValidator.mjs',
      '**/*.min.js'
    ]
  },
  {
    files: ['src/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        global: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        setImmediate: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'warn',
      'no-console': 'off',
      'no-prototype-builtins': 'off'
    }
  }
];
