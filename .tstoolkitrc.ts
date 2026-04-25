import type { TsToolkitConfig } from '@makerx/ts-toolkit'

const config: TsToolkitConfig = {
  packageConfig: {
    srcDir: 'src',
    outDir: 'dist',
    moduleType: 'commonjs',
    main: 'index.ts',
    // Expose every public module as its own subpath so consumers can deep-import individual
    // formats (e.g. `@makerx/node-winston/redact-format`) — preserves the v1.2-and-earlier shape
    // that broke when v1.3 added a single-`.` `exports` field via the default tstoolkit config.
    exports: {
      '.': 'index.ts',
      './json-stringify-values': 'json-stringify-values.ts',
      './json-stringify-values-format': 'json-stringify-values-format.ts',
      './map-audit-level-for-otel': 'map-audit-level-for-otel.ts',
      './omit-format': 'omit-format.ts',
      './omit-nil-format': 'omit-nil-format.ts',
      './pretty-console-format': 'pretty-console-format.ts',
      './redact-format': 'redact-format.ts',
      './redact-values': 'redact-values.ts',
      './serialize-error': 'serialize-error.ts',
      './serialize-error-format': 'serialize-error-format.ts',
    },
  },
}
export default config
