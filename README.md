# Node Winston

A set of [winston](https://github.com/winstonjs/winston) [formats](https://github.com/winstonjs/winston#formats), a console transport and a logger factory that simplify structured logging in Node.js services — with colourised YAML output for local development.

## Installation

```sh
npm install @makerx/node-winston
```

`winston`, `logform`, `winston-transport`, `triple-beam` and `es-toolkit` are declared as peer dependencies, so bring your own versions (>=3, >=2, >=4, >=1, >=1 respectively).

## Migrating from v1

Breaking changes:

- The `lodash` dependency has been replaced with `es-toolkit` as a peer dependency.
- `omitPaths` now applies at the logger level and affects every transport, not just the Console transport. If you added custom transports expecting the unredacted object, move omit/redact handling into that transport's format.
- A new `audit` level sits between `warn` and `info`. Loggers configured at `level: 'info'` (or more verbose) will now include `audit` messages; loggers at `level: 'warn'` or higher still filter them out.
- Pass a custom `levels` map via `loggerOptions` to opt out of the default level set (including `audit`); the returned logger type narrows to your keys.

New functionality:

- New `redactPaths` / `redactedValue` options replace values at dot-notation paths across every transport. Also available as the standalone `redactFormat`, and the `redactValues` / `redactValuesWith` helpers for direct use.
- New `flatten` / `flattenReplacer` options serialise every top-level value on the log info to a JSON string, producing a flat `{ key: string }` shape suited to OTEL + Azure Log Analytics and other scalar-only aggregators. Also available as `jsonStringifyValuesFormat` and `jsonStringifyValues`.
- Errors nested inside structured metadata are now fully serialised at the logger level (not just the Console transport) via the new `serializeErrorFormat`. It walks the whole info object — including nested objects and arrays — replacing every `Error` with a plain object that carries `name`, `message` and `stack`.
- `createLogger` is now generic over the level map. When you pass `loggerOptions.levels`, the returned logger's method signatures narrow to your level keys (`logger.fatal(...)` becomes valid, `logger.audit` becomes a type error).
- Colours for the default levels (including `audit`) are registered on first use of the default levels, so `colorize` / pretty output works out of the box without a module-load side effect.
- `defaultLevels` is exported directly if you want to extend or re-use it.

## Creating a Logger

`createLogger` builds a winston `Logger` with a pre-configured `Console` transport and a set of logger-level formats that apply to every transport.

Formats are applied in two layers:

- **Logger-level** (applied to all transports, in order): `serializeErrorFormat` → `omitFormat` (if `omitPaths`) → `redactFormat` (if `redactPaths`) → `loggerOptions.format` (if supplied) → `jsonStringifyValuesFormat` (if `flatten`; always last so it captures every prior transformation).
- **Console transport** (applied to Console output only): `omitNilFormat` → any `consoleFormats` → either `prettyConsoleFormat` (when `consoleFormat: 'pretty'`) or `timestamp` + `json` (when `consoleFormat: 'json'`).

### Options

| Option            | Type                      | Description                                                                                                                                                                                          |
| ----------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consoleFormat`   | `'json' \| 'pretty'`      | Output format for the Console transport. `json` (default) for deployed environments, `pretty` for colourised YAML during local development.                                                          |
| `consoleOptions`  | `ConsoleTransportOptions` | Options forwarded to the Console transport (e.g. `silent`, per-transport `level`). The `format` property is managed by this library.                                                                 |
| `consoleFormats`  | `Format[]`                | Extra formats appended to the Console transport's format chain, before the final `json`/`pretty` step. Applies to the Console transport only.                                                        |
| `transports`      | `Transport[]`             | Additional winston transports attached alongside the Console transport.                                                                                                                              |
| `omitPaths`       | `string[]`                | Dot-notation paths to remove from every log entry. Applied at the logger level, so affects all transports.                                                                                           |
| `redactPaths`     | `string[]`                | Dot-notation paths whose values are replaced with `redactedValue`. Applied at the logger level, so affects all transports.                                                                           |
| `redactedValue`   | `string`                  | Replacement value used by `redactPaths`. Defaults to `'<redacted>'`.                                                                                                                                 |
| `flatten`         | `boolean`                 | When `true`, serialises every top-level value on the log info to a JSON string, producing a flat `{ key: string }` shape for transports that expect scalar values (e.g. OTEL + Azure Log Analytics). |
| `flattenReplacer` | `(key, value) => any`     | Optional `JSON.stringify` replacer used when `flatten` serialises each top-level value.                                                                                                              |
| `loggerOptions`   | `LoggerOptions`           | Winston logger options (e.g. `level`, `defaultMeta`). A `format` supplied here is appended after the library's logger-level formats but still runs before `flatten` when enabled.                    |

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

| Format                      | Purpose                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serializeErrorFormat`      | Walks the log info (including nested objects and arrays) and replaces `Error` instances with plain objects that include the normally non-enumerable `message`/`stack`. |
| `omitFormat`                | Removes fields by dot-notation path via [es-toolkit's compat `omit`](https://es-toolkit.dev/reference/compat/object/omit.html) (lodash-compatible).                    |
| `omitNilFormat`             | Removes top-level `null` or `undefined` values.                                                                                                                        |
| `redactFormat`              | Recursively replaces values at the given paths with `redactedValue` (default `'<redacted>'`).                                                                          |
| `jsonStringifyValuesFormat` | Serialises every top-level value to a JSON string, producing a flat `{ key: string }` shape. Accepts an optional `replacer`.                                           |
| `prettyConsoleFormat`       | Applies `colorize` and `timestamp`, then renders logs as coloured YAML using [`yamlify-object`](https://www.npmjs.com/package/yamlify-object).                         |

Direct usage example:

```ts
import { format, createLogger } from 'winston'
import { Console } from 'winston/lib/winston/transports'
import { redactFormat, serializeErrorFormat } from '@makerx/node-winston'

const logger = createLogger({
  format: format.combine(serializeErrorFormat(), redactFormat({ paths: ['user.email'] })),
  transports: [new Console({ format: format.json() })],
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

- `serializeErrorFormat` runs at the logger level and walks the log info, replacing any `Error` instance (at any depth) with a plain, JSON-serializable object that includes `name`, `message` and `stack`. This applies to every transport.
- `serializableErrorReplacer` is passed to the Console transport's final `format.json()` as a safety net — [logform](https://github.com/winstonjs/logform) uses [safe-stable-stringify](https://www.npmjs.com/package/safe-stable-stringify), which accepts a replacer, so any `Error` that slips through is still serialised correctly.

```ts
format.json({ replacer: serializableErrorReplacer })
```
