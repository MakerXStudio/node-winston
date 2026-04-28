import commonjs from '@rollup/plugin-commonjs'
import typescript from '@rollup/plugin-typescript'
import { isAbsolute } from 'node:path'
import type { RollupOptions } from 'rollup'

const isBareModuleImport = (id: string, importer: string | undefined) =>
  importer !== undefined && !id.startsWith('.') && !isAbsolute(id)

const config: RollupOptions = {
  input: ['src/index.ts'],
  output: [
    {
      dir: 'dist',
      format: 'cjs',
      entryFileNames: '[name].js',
      exports: 'named',
      // 'auto' emits a runtime `__esModule` check for each external default-import,
      // unwrapping `.default` from ESM-shaped CJS modules (yamlify-object's CJS build,
      // emitted by tsc, exposes the function as `exports.default` with `__esModule: true`
      // and no `module.exports = fn` shim — without interop, `require()` returns the
      // namespace object and calling it throws TypeError).
      interop: 'auto',
      preserveModules: true,
      sourcemap: true,
    },
    {
      dir: 'dist',
      format: 'es',
      exports: 'named',
      entryFileNames: '[name].mjs',
      preserveModules: true,
      sourcemap: true,
    },
  ],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
  },
  external: isBareModuleImport,
  plugins: [
    typescript({
      tsconfig: 'tsconfig.build.json',
    }),
    commonjs(),
  ],
}

export default config
