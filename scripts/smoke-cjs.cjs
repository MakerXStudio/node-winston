// Verifies the built CJS bundle in `dist/` is consumable from a CommonJS context.
// Guards specifically against `require('serialize-error')` (ESM-only) regressions:
// the bundle relies on Node's flag-free `require(esm)` interop (>=22.12).

const path = require('node:path')

const distDir = path.resolve(__dirname, '..', 'dist')
const distPkg = require(path.join(distDir, 'package.json'))
const main = require(path.join(distDir, distPkg.main))

const expectedFns = [
  'serializeError',
  'createSerializableErrorReplacer',
  'serializableErrorReplacer',
  'serializeErrorFormat',
  'createLogger',
  'jsonStringifyValuesFormat',
  'redactFormat',
  'omitFormat',
  'omitNilFormat',
  'prettyConsoleFormat',
]
const missing = expectedFns.filter((name) => typeof main[name] !== 'function')
if (missing.length > 0) {
  console.error(`CJS smoke: missing or non-function exports: ${missing.join(', ')}`)
  process.exit(1)
}

const err = new Error('boom')
err.cause = new Error('cause')
const out = main.serializeError(err)
if (!out || out.message !== 'boom' || !out.cause || out.cause.message !== 'cause') {
  console.error('CJS smoke: serializeError output unexpected:', out)
  process.exit(1)
}

const logger = main.createLogger({ name: 'smoke', consoleOptions: { silent: true } })
logger.info('cjs smoke ok')

console.log('CJS smoke test passed')
