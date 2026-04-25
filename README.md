# Node Winston

A set of [winston](https://github.com/winstonjs/winston) [formats](https://github.com/winstonjs/winston#formats), a console transport and a logger factory that simplify structured logging in Node.js services — with colourised YAML output for local development.

## Installation

```sh
npm install @makerx/node-winston
```

`winston`, `logform`, `winston-transport`, `triple-beam`, `es-toolkit` and `serialize-error` are declared as peer dependencies, so bring your own versions (>=3, >=2, >=4, >=1, >=1, >=13 respectively).

Requires Node.js `>=22.12` (for flag-free `require(esm)` support, needed by `serialize-error`'s ESM-only publish).

## Migrating from v1

Breaking changes:

- The `lodash` dependency has been replaced with `es-toolkit` as a peer dependency.
- Node.js `>=22.12` is required (for flag-free `require(esm)`, needed by `serialize-error`'s ESM-only publish).
- **Error serialisation has changed.** `serialize-error` is now a peer dependency, and `serializeError` delegates to it instead of v1's hand-rolled `{ message, stack, ...rest }` shape. The serialised wire format now includes `name`, follows `cause` chains, walks own enumerable properties, and handles circular references — so any consumer asserting against the exact v1 shape will need to update.
- **Errors nested in structured metadata are now serialised on every transport, not just the Console transport.** v1 only ran `serializableErrorReplacer` inside the Console's `format.json`, so custom transports received the raw `Error` instance (with non-enumerable `message`/`stack` hidden). v2 prepends the new `serializeErrorFormat` at the logger level, which walks the full info tree and substitutes plain objects before any transport sees them. If a custom transport relied on receiving an `Error` instance, switch it to read the serialised shape — or pass `errorSerializer` to `createLogger` (or `serializer` to `serializeErrorFormat` directly) to plug in your own transformation.
- `omitPaths` now applies at the logger level and affects every transport, not just the Console transport. If you added custom transports expecting the un-omitted object, move omit handling into that transport's format.
- A new `audit` level sits between `warn` and `info`. Loggers configured at `level: 'info'` (or more verbose) will now include `audit` messages; loggers at `level: 'warn'` or higher still filter them out.
- Pass a custom `levels` map via `loggerOptions` to opt out of the default level set (including `audit`); the returned logger type narrows to your keys.
- Submodule deep-imports (e.g. `@makerx/node-winston/redact-format`, `@makerx/node-winston/serialize-error`) are no longer exported. The package's `exports` field declares a single `.` entry; every public format, helper and type is re-exported from the root, so import them from `@makerx/node-winston` directly. The `./serialize-error` subpath in particular has no replacement: `serializeError` is still re-exported from the root, but for direct use of the underlying serializer, import from the [`serialize-error`](https://www.npmjs.com/package/serialize-error) peer dependency — we no longer wrap it in a dedicated subpath.

New functionality:

- New `redactPaths` / `redactedValue` options replace values at dot-notation paths with a placeholder (default `'<redacted>'`). Like `omitPaths` they apply at the logger level and affect every transport, so they're a drop-in replacement for any hand-rolled redaction you previously bolted onto `loggerOptions.format` or a custom transport. Also exported as the standalone `redactFormat`, plus the `redactValues` / `redactValuesWith` helpers for direct use.
- New `flatten` / `flattenReplacer` options serialise every top-level value on the log info to a JSON string, producing a flat `{ key: string }` shape suited to OTEL + Azure Log Analytics and other scalar-only aggregators. Also available as `jsonStringifyValuesFormat` and `jsonStringifyValues`.
- The new `serializeErrorFormat` is exported for direct use in your own format chains, and accepts a `serializer` override for swapping in custom error normalisation.
- `createLogger` is now generic over the level map. When you pass `loggerOptions.levels`, the returned logger's method signatures narrow to your level keys (`logger.fatal(...)` becomes valid, `logger.audit` becomes a type error).
- Colours for the default levels (including `audit`) are registered on first use of the default levels, so `colorize` / pretty output works out of the box without a module-load side effect.
- `defaultLevels` and `defaultLevelColors` are exported directly if you want to extend or re-use them.
- `winstonDefaultLevels` and `winstonDefaultLevelColors` re-export winston's stock `npm` level set (`error`/`warn`/`info`/`http`/`verbose`/`debug`/`silly`) so consumers can opt back into the standard winston levels via `loggerOptions.levels` — colours register automatically on first use.
- New `mapAuditLevelForOtel` option (and standalone format) rewrites the triple-beam `LEVEL` symbol from `audit` to `info` so OTEL maps the record onto a known severity tier, while preserving the original level on a `logLevel` property. See [Shipping the audit level via OpenTelemetry](#shipping-the-audit-level-via-opentelemetry).

## Creating a Logger

`createLogger` builds a winston `Logger` with a pre-configured `Console` transport and a set of logger-level formats that apply to every transport.

Formats are applied in two layers:

- **Logger-level** (applied to all transports, in order): `serializeErrorFormat` → `mapAuditLevelForOtel` (if enabled) → `omitFormat` (if `omitPaths`) → `redactFormat` (if `redactPaths`) → `loggerOptions.format` (if supplied) → `jsonStringifyValuesFormat` (if `flatten`; always last so it captures every prior transformation).
- **Console transport** (applied to Console output only): `omitNilFormat` → any `consoleFormats` → either `prettyConsoleFormat` (when `consoleFormat: 'pretty'`) or `timestamp` + `json` (when `consoleFormat: 'json'`).

### Options

| Option                                  | Type                      | Description                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consoleFormat`                         | `'json' \| 'pretty'`      | Output format for the Console transport. `json` (default) for deployed environments, `pretty` for colourised YAML during local development.                                                                                                                                                                          |
| `consoleOptions`                        | `ConsoleTransportOptions` | Options forwarded to the Console transport (e.g. `silent`, per-transport `level`). The `format` property is managed by this library.                                                                                                                                                                                 |
| `consoleFormats`                        | `Format[]`                | Extra formats appended to the Console transport's format chain, before the final `json`/`pretty` step. Applies to the Console transport only.                                                                                                                                                                        |
| `transports`                            | `Transport[]`             | Additional winston transports attached alongside the Console transport.                                                                                                                                                                                                                                              |
| `omitPaths`                             | `string[]`                | Dot-notation paths to remove from every log entry. Applied at the logger level, so affects all transports.                                                                                                                                                                                                           |
| `redactPaths`                           | `string[]`                | Dot-notation paths whose values are replaced with `redactedValue`. Applied at the logger level, so affects all transports.                                                                                                                                                                                           |
| `redactedValue`                         | `string`                  | Replacement value used by `redactPaths`. Defaults to `'<redacted>'`.                                                                                                                                                                                                                                                 |
| `flatten`                               | `boolean`                 | When `true`, serialises every top-level value on the log info to a JSON string, producing a flat `{ key: string }` shape for transports that expect scalar values (e.g. OTEL + Azure Log Analytics).                                                                                                                 |
| `flattenReplacer`                       | `(key, value) => any`     | Optional `JSON.stringify` replacer used when `flatten` serialises each top-level value.                                                                                                                                                                                                                              |
| `errorSerializer`                       | `ErrorSerializer`         | Custom serializer applied to every `Error` instance at the logger level (via `serializeErrorFormat`) and as the Console transport's `format.json` replacer. Defaults to the library's `serializeError`, which delegates to [`serialize-error`](https://www.npmjs.com/package/serialize-error).                       |
| `mapAuditLevelForOtel`                  | `boolean`                 | When `true`, rewrites the triple-beam `LEVEL` from `audit` to `info` and copies the original onto `logLevel` for OTEL compatibility. See [Shipping the audit level via OpenTelemetry](#shipping-the-audit-level-via-opentelemetry).                                                                                  |
| `loggerOptions`                         | `LoggerOptions`           | Winston logger options (e.g. `level`, `defaultMeta`). A `format` supplied here is appended after the library's logger-level formats but still runs before `flatten` when enabled.                                                                                                                                    |

### Log levels

`createLogger` applies a level set where `debug` is noisier than `verbose` (unlike winston's default, which has them reversed). This matches the convention used by Seq, CloudWatch and most log aggregators, where Verbose/Trace is expected to be the lowest, noisiest level. An `audit` level sits between `warn` and `info` for audit-trail events that should flow through at `info` and above but be filtered at `warn`:

```ts
{ error: 0, warn: 1, audit: 2, info: 3, debug: 4, verbose: 5 }
```

Colours for the default levels (including `audit`) are registered on the first `createLogger` call that uses them, so `colorize` / pretty output works out of the box.

Pass your own `levels` via `loggerOptions` to override. When you do, the returned logger is typed against your level keys (so `logger.audit` is only present when the default levels are in use), and you should register colours for your levels via `winston.addColors`:

```ts
import { addColors } from 'winston'
import { createLogger } from '@makerx/node-winston'

const logger = createLogger({
  loggerOptions: { levels: { fatal: 0, error: 1, info: 2, trace: 3 }, level: 'info' },
})

addColors({ fatal: 'red', error: 'red', info: 'green', trace: 'cyan' })

logger.fatal('process is exiting') // typed; logger.audit would be a type error
```

To opt back into winston's stock npm levels (`error`/`warn`/`info`/`http`/`verbose`/`debug`/`silly`) — for example to integrate with tooling that assumes them — pass the re-exported `winstonDefaultLevels`. Colours register automatically on first use:

```ts
import { createLogger, winstonDefaultLevels } from '@makerx/node-winston'

const logger = createLogger({
  loggerOptions: { levels: winstonDefaultLevels, level: 'silly' },
})

logger.http('GET /items') // typed; logger.audit would be a type error
```

### Shipping the audit level via OpenTelemetry

[`@opentelemetry/instrumentation-winston`](https://www.npmjs.com/package/@opentelemetry/instrumentation-winston) auto-installs [`@opentelemetry/winston-transport`](https://www.npmjs.com/package/@opentelemetry/winston-transport), which derives OTEL's `severityText` / `severityNumber` from Winston's triple-beam `LEVEL` symbol and strips the string `level` property before building attributes. OTEL's log spec only defines a fixed severity enumeration (trace/debug/info/warn/error/fatal), so Winston's custom `audit` level arrives with `severityNumber: undefined` and no queryable record of the original level. This is most visible on Azure Monitor / Log Analytics (which ignores records without a mapped severity), but affects any OTEL backend that relies on the spec-defined severity.

Set `mapAuditLevelForOtel: true` to opt in:

```ts
const logger = createLogger({
  mapAuditLevelForOtel: true,
})
```

The format rewrites the triple-beam `LEVEL` symbol from `audit` to `info` (so OTEL maps the record onto `info` severity) and copies the original level onto a `logLevel` property (so it survives as an OTEL attribute — e.g. queryable as `customDimensions.logLevel == "audit"` in Azure Log Analytics). The string `info.level` is left as `audit` for other transports — so local Console JSON output still shows `"level": "audit"`.

**Caveat:** the `LEVEL` symbol also drives transport-level filtering, so a logger, console, or transport explicitly set to `level: 'audit'` would silently drop these records after the rewrite (`info` is more verbose than `audit`). `createLogger` detects this combination and throws at construction — use `'info'` (or a more verbose level) instead. Only enable this option when shipping logs via OTEL — typically a deployed-environment concern.

### Example: environment-driven configuration

At MakerX we typically drive logger configuration from config files, varying output by environment:

`logger.ts`:

```ts
import { isLocalDev } from '@makerx/node-common'
import { createLogger } from '@makerx/node-winston'
import config from 'config'

const logger = createLogger({
  consoleFormat: isLocalDev ? 'pretty' : 'json',
  consoleOptions: config.get('logging.consoleOptions'),
  loggerOptions: config.get('logging.loggerOptions'),
  omitPaths: config.get('logging.omitPaths'),
})

export default logger
```

Runtime configurations for different environments might look like:

```ts
// local development — coloured YAML, verbose level, strip redundant defaultMeta
const logger = createLogger({
  consoleFormat: 'pretty',
  loggerOptions: {
    defaultMeta: { service: 'my-application-name' },
    level: 'verbose',
  },
  omitPaths: ['service'],
})

// deployed — structured JSON, info level
const logger = createLogger({
  consoleFormat: 'json',
  loggerOptions: {
    defaultMeta: { service: 'my-application-name' },
    level: 'info',
  },
})

// integration tests — silence console output
const logger = createLogger({
  consoleOptions: { silent: true },
})
```

## Transports

`createLogger` creates a `Console` transport by default. Add [other transports](https://github.com/winstonjs/winston/blob/master/docs/transports.md) via the `transports` option — they share the logger-level formats:

```ts
const logger = createLogger({
  transports: [
    new DailyRotateFile({
      level: 'info',
      filename: 'application-%DATE%.log',
      datePattern: 'YYYY-MM-DD-HH',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
    }),
  ],
})
```

## Formats

Every format used by `createLogger` is also exported for direct use with your own winston setup.

| Format                                  | Purpose                                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serializeErrorFormat`                  | Walks the log info (including nested objects and arrays) and replaces `Error` instances with plain objects that include the normally non-enumerable `message`/`stack`. |
| `omitFormat`                            | Removes fields by dot-notation path via [es-toolkit's compat `omit`](https://es-toolkit.dev/reference/compat/object/omit.html) (lodash-compatible).                    |
| `omitNilFormat`                         | Removes top-level `null` or `undefined` values.                                                                                                                        |
| `redactFormat`                          | Recursively replaces values at the given paths with `redactedValue` (default `'<redacted>'`).                                                                          |
| `jsonStringifyValuesFormat`             | Serialises every top-level value to a JSON string, producing a flat `{ key: string }` shape. Accepts an optional `replacer`.                                           |
| `prettyConsoleFormat`                   | Applies `colorize` and `timestamp`, then renders logs as coloured YAML using [`yamlify-object`](https://www.npmjs.com/package/yamlify-object).                         |
| `mapAuditLevelForOtel`                  | Rewrites the triple-beam `LEVEL` symbol from `audit` to `info` and copies the original onto `logLevel` so custom levels survive OTEL's severity enumeration.           |

Direct usage example:

```ts
import { format, createLogger, transports } from 'winston'
import { redactFormat, serializeErrorFormat } from '@makerx/node-winston'

const logger = createLogger({
  format: format.combine(serializeErrorFormat(), redactFormat({ paths: ['user.email'] })),
  transports: [new transports.Console({ format: format.json() })],
})
```

### Error serialization

The `Error` class's `message` and `stack` properties [are not enumerable](https://stackoverflow.com/questions/18391212/is-it-not-possible-to-stringify-an-error-using-json-stringify), so `JSON.stringify(new Error('message'))` returns `'{}'`.

Winston has special handling when an `Error` is the first or second argument to a log call:

```ts
logger.log(new Error('cause')) // { message: 'cause', stack: ... }
logger.log('message', new Error('cause')) // { message: 'message cause', stack: ... }
```

But when errors are nested inside structured log data, `message` and `stack` are lost:

```ts
try {
  /* ... */
} catch (error) {
  logger.log('message', { info, error }) // { message: 'message', error: {} }
}
```

`createLogger` solves this with two complementary mechanisms:

- `serializeErrorFormat` runs at the logger level and walks the log info, replacing any `Error` instance (at any depth) with a plain, JSON-serializable object (via the [`serialize-error`](https://www.npmjs.com/package/serialize-error) package). This applies to every transport.
- `serializableErrorReplacer` is passed to the Console transport's final `format.json()` as a safety net — [logform](https://github.com/winstonjs/logform) uses [safe-stable-stringify](https://www.npmjs.com/package/safe-stable-stringify), which accepts a replacer, so any `Error` that slips through is still serialised correctly.

```ts
format.json({ replacer: serializableErrorReplacer })
```

To plug in a custom transformation (for example, an `Error`-normalising function previously applied via a custom winston-transport), pass it via `errorSerializer` — it's threaded into both mechanisms:

```ts
import { createLogger } from '@makerx/node-winston'

const logger = createLogger({
  errorSerializer: (error) => ({ kind: error.name, detail: error.message, trace: error.stack }),
})
```

For direct format usage, `serializeErrorFormat` accepts the same override and `createSerializableErrorReplacer(serializer)` builds a matching JSON replacer:

```ts
import { format } from 'winston'
import { createSerializableErrorReplacer, serializeErrorFormat } from '@makerx/node-winston'

const serializer = (error: Error) => ({ kind: error.name, detail: error.message })

format.combine(serializeErrorFormat({ serializer }), format.json({ replacer: createSerializableErrorReplacer(serializer) }))
```
