export default [
  {
    ignores: [
      'v2/orchestrator-rust/src/card_shared/engine-v*.js',
      'v2/orchestrator-rust/src/card_shared/narrator.js',
      'dist/**',
      'node_modules/**',
      'images/**',
      'docs/**',
      'reference-library/**',
      'coverage/**',
      '.runtime/**',
      'v2/desktop/bundle/**',
      'v2/desktop/src-tauri/target/**',
      'v2/desktop/src-tauri/gen/**',
      '**/*.min.js'
    ]
  },
  {
    files: ['scripts/**/*.mjs'],
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
