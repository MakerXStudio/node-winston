import globals from 'globals'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

export default [
  {
    ignores: [
      '**/.eslintrc.js',
      '**/node_modules',
      '**/dist',
      '**/build',
      '**/coverage',
      '**/generated/types.d.ts',
      '**/generated/types.ts',
      '**/.idea',
      '**/.vscode',
    ],
  },
  ...compat.extends('@makerx/eslint-config'),
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // The OpenTelemetry transport is an optional peer. Importing it, or `@opentelemetry/api-logs`, from
    // the library would make it required and can add a second `api-logs` copy to an app. A transport
    // that gets its logger from a second copy before the SDK registers its provider writes every line
    // to a no-op logger. Specs drive the real transport under npm aliases instead.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts', 'src/tests/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@opentelemetry/*', 'otel-winston-transport-*'],
              message: 'The library must not depend on OpenTelemetry packages. See the comment in eslint.config.mjs.',
            },
          ],
        },
      ],
    },
  },
]
