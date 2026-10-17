# Node Winston

A set of [winston](https://github.com/winstonjs/winston) [formats](https://github.com/winstonjs/winston#formats), a console transport and a logger factory that simplify structured logging in Node.js services, with colourised YAML output for local development and records shaped for OpenTelemetry. Start with the [quick start](#quick-start).

## Installation

```sh
npm install @makerx/node-winston
```

`winston`, `logform`, `winston-transport`, `triple-beam` and `es-toolkit` are peer dependencies so the package shares a single instance with your app's `winston`. npm 7+ and pnpm install them automatically; on Yarn Classic, install them yourself.

`@opentelemetry/winston-transport` `>=0.29` is an optional peer dependency. Install it only when you ship logs through OpenTelemetry: see [step 1 of the quick start](#1-instrument-the-app-optional).

Requires Node.js `>=20`.

### Upgrade from an earlier version

See [Migrating from v2](#migrating-from-v2) and [Migrating from v1](#migrating-from-v1) at the bottom for breaking changes and new functionality.

## Quick start

A typical service instruments itself for OpenTelemetry, creates one logger, and sends audit records to a store of their own. Steps 1 and 3 are optional.

### 1. Instrument the app (optional)

Install `@opentelemetry/sdk-node`, `@opentelemetry/instrumentation-winston` and `@opentelemetry/winston-transport`, and the other instrumentations you use, such as `@opentelemetry/instrumentation-http` below. The winston instrumentation loads the transport at runtime but does not depend on it, and without it no record is sent. An ES module app also needs `@opentelemetry/instrumentation`, for the hook that `tracing.ts` registers.

An instrumentation patches a module as that module loads, so tracing must start before anything imports winston. In an ES module app, an entry point with no static imports enforces that order:

```ts
// main.ts
await import('./tracing.js')
await import('./server.js')
```

```ts
// tracing.ts
import { register } from 'node:module'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { WinstonInstrumentation } from '@opentelemetry/instrumentation-winston'
import { NodeSDK } from '@opentelemetry/sdk-node'

const instrumentations = [new HttpInstrumentation(), new WinstonInstrumentation()]

// For an ES module app: winston is loaded by `import`, which only this hook can patch.
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url)

export const sdk = new NodeSDK({ instrumentations })
sdk.start()
```

A CommonJS app can `require('./tracing')` first instead, and needs no `register` call. `NodeSDK` reads its exporters from the standard `OTEL_*` environment variables. Call `sdk.shutdown()` last on shutdown, to send what is still queued.

### 2. Create the logger

```ts
// logger.ts
import { isLocalDev } from '@makerx/node-common'
import { createLogger } from '@makerx/node-winston'

export const logger = createLogger({
  consoleFormat: isLocalDev ? 'pretty' : 'json',
  loggerOptions: {
    level: process.env.LOG_LEVEL ?? 'info',
    defaultMeta: { service: 'my-api' },
  },
  redactPaths: ['headers.authorization', 'token'],
  otel: true,
})
```

`otel: true` shapes what the OpenTelemetry transport from step 1 receives. The console keeps nested JSON, or coloured YAML locally. Without step 1, or where the SDK does not run, as in most tests, `otel` changes nothing. To silence the console in tests, pass `consoleOptions: { silent: true }`. Every option is listed under [Options](#options).

### 3. Send audit records to their own table (optional)

`logger.audit()` writes at the custom `audit` level (see [Log levels](#log-levels)). To keep audit records in a Log Analytics table of their own as well, send them through a [`CallbackTransport`](#callbacktransport). This example uses the Azure Monitor Logs Ingestion API, with a data collection rule for the custom table:

```ts
// audit.ts
import { DefaultAzureCredential } from '@azure/identity'
import { LogsIngestionClient } from '@azure/monitor-ingestion'
import { CallbackTransport, type LogError } from '@makerx/node-winston'

const client = new LogsIngestionClient(process.env.AUDIT_ENDPOINT_URL!, new DefaultAzureCredential())

export const createAuditTransport = (logError: LogError) =>
  new CallbackTransport(
    ({ message, meta }) =>
      client.upload(process.env.AUDIT_RULE_ID!, process.env.AUDIT_STREAM_NAME!, [
        { TimeGenerated: new Date().toISOString(), Message: message, Info: meta },
      ]),
    logError,
    { onlyLevels: ['audit'], closeTimeoutMs: 5_000 },
  )
```

```ts
// logger.ts
import { createAuditTransport } from './audit.js'

const auditTransport = createAuditTransport((message, ...args) => logger.error(message, ...args))

export const logger = createLogger({
  // ...the options from step 2
  transports: [auditTransport],
})

/** Call on shutdown, before `sdk.shutdown()`. Waits up to 5 seconds for audit uploads still running. */
export const closeAuditTransport = () => auditTransport.close()
```

- `onlyLevels: ['audit']` forwards `audit` records only. The `level` option would also forward `error` and `warn`.
- An upload that fails goes to `logError`, which logs it as an error. Errors never reach this transport, so a failing endpoint cannot loop.
- Winston does not wait for a transport to close, so await `close()` yourself. `closeTimeoutMs` bounds the wait, and any uploads still running are reported through `logError`.
- The record's columns, `TimeGenerated`, `Message` and `Info`, must match the stream that the data collection rule declares.

## Creating a Logger

`createLogger` builds a winston `Logger` with a pre-configured `Console` transport and a set of logger-level formats that apply to every transport.

Formats are applied in layers:

- **Logger-level** (applied to all transports, in order): `serializeErrorFormat` → `omitFormat` (if `omitPaths`) → `redactFormat` (if `redactPaths`) → `loggerOptions.format` (if supplied).
- **Console transport** (applied to Console output only): `omitNilFormat` → any `consoleFormats` → either `prettyConsoleFormat` (when `consoleFormat: 'pretty'`) or `timestamp` + `json` (when `consoleFormat: 'json'`).
- **OpenTelemetry transport** (with `otel`): `otelAttributesFormat`, after the logger-level formats. See [OpenTelemetry](#opentelemetry).

### Options

| Option            | Type                                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consoleFormat`   | `'json' \| 'pretty'`                     | Output format for the Console transport. `json` (default) for deployed environments, `pretty` for colourised YAML during local development.                                                                                                                                                                                                                                                                                                                |
| `consoleOptions`  | `ConsoleTransportOptions`                | Options forwarded to the Console transport (e.g. `silent`, per-transport `level`). The `format` property is managed by this library.                                                                                                                                                                                                                                                                                                                       |
| `consoleFormats`  | `Format[]`                               | Extra formats appended to the Console transport's format chain, before the final `json`/`pretty` step. Applies to the Console transport only.                                                                                                                                                                                                                                                                                                              |
| `transports`      | `Transport[]`                            | Additional winston transports attached alongside the Console transport.                                                                                                                                                                                                                                                                                                                                                                                    |
| `omitPaths`       | `string[]`                               | Dot-notation paths to remove from every log entry. Applied at the logger level, so affects all transports.                                                                                                                                                                                                                                                                                                                                                 |
| `redactPaths`     | `string[]`                               | Dot-notation paths whose values are replaced with `redactedValue`. A plain key matches at every depth, inside serialized errors too. Applied at the logger level, so affects all transports.                                                                                                                                                                                                                                                               |
| `redactedValue`   | `string`                                 | Replacement value used by `redactPaths`. Defaults to `'<redacted>'`.                                                                                                                                                                                                                                                                                                                                                                                       |
| `otel`            | `boolean \| OtelAttributesFormatOptions` | Gives each OpenTelemetry transport on the logger, such as the one `@opentelemetry/instrumentation-winston` adds, the `otelAttributesFormat`. Other transports are unchanged. `true` uses the format's defaults, and an object is passed to the format as its options. See [OpenTelemetry](#opentelemetry).                                                                                                                                                 |
| `errorSerializer` | `ErrorSerializer`                        | Custom serializer applied to every `Error` instance at the logger level (via `serializeErrorFormat`) and as the Console transport's `format.json` replacer. Defaults to the library's `serializeError`, which captures `name`/`message`/`stack`/`code`/`cause`/`errors` even when non-enumerable, walks own enumerable properties, and is safe against circular references. Build one with `createErrorSerializer` to leave properties out of every error. |
| `loggerOptions`   | `LoggerOptions`                          | Winston logger options, for example `level` and `defaultMeta`. A `format` supplied here is appended after the library's logger-level formats.                                                                                                                                                                                                                                                                                                              |

### Log levels

`createLogger` applies a level set where `debug` is noisier than `verbose` (unlike winston's default, which has them reversed). This matches the convention used by Seq, CloudWatch and most log aggregators, where Verbose/Trace is expected to be the lowest, noisiest level. An `audit` level sits between `warn` and `info` for audit-trail events that should flow through at `info` and above but be filtered at `warn`:

```ts
{ error: 0, warn: 1, audit: 2, info: 3, debug: 4, verbose: 5 }
```

`audit` is for audit-trail events: a sign-in, a role change, a data export. It is a log level, not an audit store, and it adds no delivery or retention guarantee. To send audit records somewhere else as well, see [step 3 of the quick start](#3-send-audit-records-to-their-own-table-optional). OpenTelemetry has no `audit` severity, so with `otel` an `audit` record is exported at `info` severity with `logLevel: 'audit'`. See [Audit severity](#audit-severity).

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

### `CallbackTransport`

`CallbackTransport` sends records to a promise-returning handler, such as an audit table, a queue or an analytics service. It takes the handler, a `LogError` sink for handler failures, and options:

| Option           | Description                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onlyLevels`     | Forwards only records at these levels.                                                                                                                                                                  |
| `level`          | Forwards a level and every level above it. It compares the string `info.level`, so it stays accurate when a logger-level format such as `mapAuditLevelForOtel` rewrites the triple-beam `LEVEL` symbol. |
| `closeTimeoutMs` | The longest `close()` waits for dispatches still running. By default it waits for all of them.                                                                                                          |

The handler receives `{ level, message, meta }`, the shape `extractTransformableInfo` returns. A handler that rejects is reported to `logError` and never fails the log call. Give it a `logError` whose records this transport does not forward, or a failing endpoint produces a record that fails again. [Step 3 of the quick start](#3-send-audit-records-to-their-own-table-optional) is a complete example.

## OpenTelemetry

Send logs through OpenTelemetry with [`@opentelemetry/instrumentation-winston`](https://www.npmjs.com/package/@opentelemetry/instrumentation-winston) and `createLogger({ otel: true })`, as in steps [1](#1-instrument-the-app-optional) and [2](#2-create-the-logger) of the quick start. The instrumentation adds an [`@opentelemetry/winston-transport`](https://www.npmjs.com/package/@opentelemetry/winston-transport) transport to every logger and stamps trace and span ids on each record. `otel: true` gives that transport `otelAttributesFormat`, which shapes each record into the attributes the logs SDK and most backends need. The console and every other transport are unchanged.

Do not also add an `OpenTelemetryTransportV3` yourself while the instrumentation sends logs: every record would be exported twice. `otel` also shapes a transport passed in `transports`, but a transport added later with `logger.add` gets no format.

### Supported transport lines

| `@opentelemetry/winston-transport` | Matching SDK line | What the transport does                                                                    |
| ---------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| 0.29 – 0.31                        | 0.219 – 0.221     | Records an `err`/`error` value as the record's exception; passes every other value through |
| 0.32 – 0.33                        | 0.222 – 0.223     | As 0.29, and normalises object values into nested map attributes                           |
| 0.34 and later                     | 0.223 and later   | As 0.32, and takes `severityMapping` and `logSeverity` options                             |

A transport before 0.29 is not supported: see [Migrating from v2](#migrating-from-v2).

The transport is tied to an SDK line through its `@opentelemetry/api-logs` dependency, so move the two together. With two copies of `api-logs` in the tree, a transport constructed before the SDK registers its logger provider stays bound to a no-op logger, and every line it writes is dropped.

### What a record looks like

From 0.29 the transport gives the logs SDK an `err`/`error` value as the exception. The SDK keeps only `name`, `message`, `stack` and a cause's message: they become `exception.type`, `exception.message`, `exception.stacktrace` and `error.cause.*`, and every other field of the error is dropped. So `otelAttributesFormat`:

- leaves the error an object with only the fields the SDK reads, and moves the rest of it, such as an HTTP status, a provider's error body or the cause chain, to `errorDetail` as JSON
- writes every other object value as a JSON string, because most backends, Azure Log Analytics included, index only scalar attributes
- leaves scalars as they are, and writes a `Date` as its ISO string
- copies every record's level onto `logLevel`, and exports an `audit` record at `info` severity (see [Audit severity](#audit-severity))

A provider error logged as `logger.error('Chat failed', { error, request: { route: '/chat' } })` is exported as:

```ts
{
  'exception.type': 'ProviderError',
  'exception.message': 'Request too large',
  'exception.stacktrace': 'ProviderError: Request too large\n    at …',
  'error.cause.type': 'Error',
  'error.cause.message': 'body exceeds limit',
  errorDetail: '{"statusCode":413,"data":{"error":{"code":"request_too_large"}},"cause":{…}}',
  request: '{"route":"/chat"}',
  logLevel: 'error',
}
```

The SDK takes a truthy `code` over `name` as `exception.type`, so `code` goes to `errorDetail` unless the error has no `name`.

### Options

Pass options as `otel: { … }`.

| Option               | Default | Description                                                                                                                                                                                                                     |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxAttributeLength` | none    | The longest string the format writes. A longer one is cut short and ends in `[Truncated]`. By default every string is written whole. Strings the record already held are never cut.                                             |
| `replacer`           | none    | `JSON.stringify` replacer for every value the format stringifies, `errorDetail` included. It is called with the object that holds the value as `this`, so it can decide on a property from the other properties of that object. |

### Audit severity

OpenTelemetry's log spec has no severity for the custom `audit` level. Without one, a backend stores the record with no severity or a default one, and a `logSeverity` filter drops it. So the format exports an `audit` record at `info` severity. A logger whose levels have no `audit` has nothing to rewrite.

The format also copies every record's level onto `logLevel`. App Insights stores only a coarse severity, which puts `audit` with `info` and `debug` with `verbose`, so `logLevel` is how to tell them apart. In Azure Log Analytics, query `customDimensions.logLevel == "audit"`.

The format runs on the OpenTelemetry transport only, after that transport's level filter. A logger or transport set to `level: 'audit'` keeps audit records, and the console still shows `"level": "audit"`.

### Record size and privacy

Three options control what a record holds, for errors from any library:

| Option                                                | Effect                                                                                                                                                             | Applies to           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| `redactPaths`                                         | Replaces values on every record. A plain key matches at every depth, inside serialized errors too.                                                                 | Every transport      |
| `errorSerializer`, built with `createErrorSerializer` | Leaves properties out of every error with `omit`. With `dedupe`, writes an object two properties share only once. See [Error serialization](#error-serialization). | Every transport      |
| `maxAttributeLength`                                  | Cuts any string the format writes at a backend's limit, and ends it in `[Truncated]` so the cut is visible.                                                        | OpenTelemetry output |

The logs SDK's own `attributeValueLengthLimit` cuts a value without a marker, and a cut JSON value does not parse. To change only the OpenTelemetry output, use `otel: { replacer }`.

#### Example: AI SDK errors in App Insights

The Vercel AI SDK's `APICallError` carries the whole request body as `requestBodyValues`, the prompt included, and the provider's response as `responseHeaders`, `responseBody` and `data`. Its `RetryError` holds every attempt under `errors`, and the last attempt again under `lastError`. A failed retry can overrun the 8,192-character limit of an App Insights custom dimension, which App Insights then cuts short so it no longer parses as JSON.

```ts
import { createErrorSerializer, createLogger } from '@makerx/node-winston'

const logger = createLogger({
  otel: { maxAttributeLength: 8192 },
  redactPaths: ['requestBodyValues'],
  errorSerializer: createErrorSerializer({
    omit: (key, error) => key === 'responseHeaders' || (key === 'lastError' && 'errors' in error),
  }),
})
```

`dedupe: true` is an alternative to the `lastError` rule: the last attempt is written in full under `errors`, and `lastError` as `'[Duplicate]'`.

### Exceptions found in metadata

With no `err` or `error` on a record, the transport takes the first metadata object that has a `name`, `code`, `message` or `stack` as the record's exception. So `logger.info('created', { name: 'Alice' })` is exported with `exception.type: 'Alice'`, and a backend may file it as an exception. This is the transport's behaviour, not the format's. Log such values under a more specific key, such as `userName`.

## Formats

Every format used by `createLogger` is also exported for direct use with your own winston setup.

| Format                      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serializeErrorFormat`      | Walks the log info (including nested objects and arrays) and replaces `Error` instances with plain objects that include the normally non-enumerable `message`/`stack`. A record that is itself an error, or holds one under `message`, is nested under `error`.                                                                                                                                                            |
| `omitFormat`                | Removes fields by dot-notation path via [es-toolkit's compat `omit`](https://es-toolkit.dev/reference/compat/object/omit.html) (lodash-compatible).                                                                                                                                                                                                                                                                        |
| `omitNilFormat`             | Removes top-level `null` or `undefined` values.                                                                                                                                                                                                                                                                                                                                                                            |
| `redactFormat`              | Recursively replaces values at the given paths with `redactedValue` (default `'<redacted>'`).                                                                                                                                                                                                                                                                                                                              |
| `otelAttributesFormat`      | Shapes a record into OpenTelemetry log attributes for `@opentelemetry/winston-transport` 0.29 and later: the error stays an object the transport records as the exception, the rest of it goes to `errorDetail`, and every other object value becomes a JSON string. It also writes `logLevel` and exports `audit` at `info` severity. `otel` puts it on the OpenTelemetry transport. See [OpenTelemetry](#opentelemetry). |
| `jsonStringifyValuesFormat` | Serialises every top-level value to a JSON string, producing a flat `{ key: string }` shape. Accepts an optional `replacer`. For a sink other than the OpenTelemetry transport; from transport 0.29 use `otelAttributesFormat`.                                                                                                                                                                                            |
| `prettyConsoleFormat`       | Applies `colorize` and `timestamp`, then renders logs as coloured YAML using [`yamlify-object`](https://www.npmjs.com/package/yamlify-object).                                                                                                                                                                                                                                                                             |
| `mapAuditLevelForOtel`      | Rewrites the triple-beam `LEVEL` symbol from `audit` to `info` and copies the original onto `logLevel`, so the custom `audit` level gets an OpenTelemetry severity. `otelAttributesFormat` already does this; use it in a chain you build yourself.                                                                                                                                                                        |

`redactFormat` paths accept plain keys (`email`, matched at every level), dot-notation paths (`user.email`), and `[*]` array wildcards to iterate every element of an array segment — for example `files[*].name`, `users[*].addresses[*].zip`, or `tags[*]` to redact each element of a primitive array.

Direct usage example:

```ts
import { format, createLogger, transports } from 'winston'
import { redactFormat, serializeErrorFormat } from '@makerx/node-winston'

const logger = createLogger({
  format: format.combine(serializeErrorFormat(), redactFormat({ paths: ['user.email', 'files[*].name'] })),
  transports: [new transports.Console({ format: format.json() })],
})
```

### Error serialization

The `Error` class's `message` and `stack` properties [are not enumerable](https://stackoverflow.com/questions/18391212/is-it-not-possible-to-stringify-an-error-using-json-stringify), so `JSON.stringify(new Error('message'))` returns `'{}'`.

Worse, winston treats an `Error` differently depending on where in the call it appears, and none of the four results resemble each other:

```ts
logger.error(new Error('cause')) //                        the record IS the error — { ...info } yields no message, no stack
logger.error(new Error('')) //                             { message: <the error> } — the branch turns on a truthy message
logger.error('failed', new Error('cause')) //              { message: 'failed cause', stack: '…' } — messages concatenated
logger.error('failed', { error: new Error('cause') }) //   { message: 'failed', error: <the error> } — no message, no stack
```

`createLogger` solves all of it with three complementary mechanisms:

- The logger's own level methods (and `log`) normalise their arguments, so an `Error` reaches winston as `{ error }` metadata rather than as the record or the message. This is what makes the four calls above agree; the rest is winston's ordinary metadata handling. Interpolation is the one exception — see below.
- `serializeErrorFormat` runs at the logger level and walks the log info, replacing any `Error` instance (at any depth, the record itself included) with a plain, JSON-serializable object via the library's `serializeError`. This applies to every transport, and still covers the record shapes directly — for `logger.write`, winston's exception handlers, or the format used on its own outside `createLogger`.
- `serializableErrorReplacer` is passed to the Console transport's final `format.json()` as a safety net — [logform](https://github.com/winstonjs/logform) uses [safe-stable-stringify](https://www.npmjs.com/package/safe-stable-stringify), which accepts a replacer, so any `Error` that slips through is still serialised correctly.

```ts
format.json({ replacer: serializableErrorReplacer })
```

#### One shape, however the error was logged

Error detail is always at `error`, and `message` is always the line you wrote:

```ts
logger.error(new Error('boom')) //                      { level, message: 'boom',   error: { name, message, stack } }
logger.error('failed', new Error('boom')) //             { level, message: 'failed', error: { name, message, stack } }
logger.error('failed', { error: new Error('boom') }) //  { level, message: 'failed', error: { name, message, stack } }
logger.error(new Error('')) //                          { level, message: '',       error: { name, message, stack } }
logger.error(new AggregateError([inner])) //             { level, message: '',       error: { name, stack, errors: [ … ] } }
```

An error given as the whole call keeps its own message on the line, so nothing is lost; anything else you pass alongside it is kept as metadata, and a child logger behaves the same way.

Nesting rather than spreading keeps the error out of the record's namespace, which is where `level`, `defaultMeta` and your own metadata live — they overlap on `name`, `message`, `stack`, `code`, `cause` and `errors`, and something has to give. A logger with `defaultMeta: { name: 'my-service' }` keeps both names: `name` is the service, `error.name` is the error.

Normalising the arguments also means the error instance is never written as the record, so winston never assigns `level` or `defaultMeta` onto the error itself. That mattered more than it sounds: V8 formats `stack` lazily on first access, so a `defaultMeta.name` used to rewrite the stack's header to `my-service: boom`.

Interpolation is left alone. A message holding a `util.format` token means the arguments after it are interpolation values rather than metadata — winston merges nothing onto the record for such a call — so `logger.error('failed: %s', err)` keeps the error in the splat position it was passed in, as does any `Error` past the metadata position. Those are still serialised by `serializeErrorFormat` where they lie, so `format.splat()` finds them there.

#### Values that serialise themselves

A value that defines `toJSON` — a `Date`, a `URL`, a date-library instance — is left as it is in log metadata, so a transport receives the `Date` itself and any JSON step writes its ISO string, as 1.x did. Inside a serialized error, where the output must be plain, the value is replaced by what its `toJSON` returns: `{ at: new Date(…) }` on an error becomes `at: '2026-01-02T03:04:05.000Z'`, and an invalid `Date` becomes `null`. An error is never asked for its `toJSON`, so one that defines it (an `AxiosError`, say) is still captured whole.

> **Fixed in 2.2.1.** From 2.0.0 to 2.2.0 a `Date` anywhere in log metadata reached every transport as `{}`.

> **Upgrading from 2.1.** `logger.error(err)` used to put `name`, `message` and `stack` at the top of the record; error detail now sits under `error` instead, matching `logger.error('msg', { error })`. Read `error.stack` rather than `stack`, and adjust any `omitPaths`/`redactPaths` that pointed at the old top-level keys.
>
> `logger.error('msg', err)` no longer has the error's message concatenated onto yours, and no longer copies `stack` to the top of the record: `message` is `'msg'`, and the detail is under `error`.

> **Upgrading from 2.0.** A record that is itself an `Error` now reaches transports as a plain object rather than an `Error` instance. A custom transport that tested `info instanceof Error` should read the serialised properties instead.

To plug in a custom transformation (for example, an `Error`-normalising function previously applied via a custom winston-transport), pass it via `errorSerializer` — it's threaded into both mechanisms:

```ts
import { createLogger } from '@makerx/node-winston'

const logger = createLogger({
  errorSerializer: (error) => ({ kind: error.name, detail: error.message, trace: error.stack }),
})
```

`createErrorSerializer` builds a serializer that works like `serializeError`, with two options:

| Option   | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `omit`   | Leaves a property out of every error the serializer reaches: the error itself, its `cause`, each entry of its `errors`, and any error held in a property. It is called with the property name and the error that holds it, so a rule can depend on the error's other properties. An error is an `Error` instance, or an object with a string `name`, `message` and `stack`, such as an error already serialized elsewhere. It is not called for any other object. |
| `dedupe` | Writes an object that two properties of one error share only once, and each later occurrence as `'[Duplicate]'`. The first property in key order keeps the object.                                                                                                                                                                                                                                                                                                |

```ts
import { createErrorSerializer, createLogger } from '@makerx/node-winston'

const logger = createLogger({
  errorSerializer: createErrorSerializer({ omit: (key) => key === 'headers', dedupe: true }),
})
```

#### `DOMException`

An `AbortSignal` carries a `DOMException` as its `reason`, and an operation cancelled through one rejects with that reason. A `DOMException` is therefore what a `catch` block receives whenever a fetch, a stream or a job is abandoned on a deadline. It needs no special treatment: log it like any other error.

```ts
try {
  await fetch(url, { signal: AbortSignal.timeout(5_000) })
} catch (error) {
  logger.error('delivery failed', { error }) // { error: { name: 'TimeoutError', message: ..., stack: ... } }
}
```

A `DOMException` keeps `message` and `name` as getter-only accessors on its prototype, which makes it the one error type a deep clone cannot rebuild. The library substitutes a serialized object before it clones the log record, using the configured `errorSerializer`, so `redactPaths` handles a `DOMException` like any other value.

For direct format usage, `serializeErrorFormat` accepts the same override and `createSerializableErrorReplacer(serializer)` builds a matching JSON replacer:

```ts
import { format } from 'winston'
import { createSerializableErrorReplacer, serializeErrorFormat } from '@makerx/node-winston'

const serializer = (error: Error) => ({ kind: error.name, detail: error.message })

format.combine(serializeErrorFormat({ serializer }), format.json({ replacer: createSerializableErrorReplacer(serializer) }))
```

## Migrating from v2

v3 has one OpenTelemetry setup, shown in the [quick start](#quick-start): `WinstonInstrumentation` adds the transport, and `createLogger({ otel: true })` shapes what it receives. It supports `@opentelemetry/winston-transport` 0.29 and later only. 2.x gets fixes only, published under the `latest-2` dist-tag.

Breaking changes:

- `flatten`, `flattenReplacer` and `mapAuditLevelForOtel` are removed from `createLogger`. They are type errors, and `createLogger` throws if one is passed, so config-built options cannot silently fall back to nested output. Replace them as follows:

| 2.x                                                                                                                                                                       | 3.0                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `flatten: 'otel'` or `flatten: true`, with `mapAuditLevelForOtel: true`                                                                                                   | `otel: true`                                                                                                                         |
| `flatten: 'otel'` without `mapAuditLevelForOtel`                                                                                                                          | `otel: true`. Records also get `logLevel`, and `audit` is exported at `info` severity.                                               |
| `flattenReplacer: r`                                                                                                                                                      | `otel: { replacer: r }`                                                                                                              |
| An `OpenTelemetryTransportV3` you add yourself, with `otelAttributesFormat()` or `jsonStringifyValuesFormat()`, and `disableLogSending: true` on `WinstonInstrumentation` | Remove the transport and `disableLogSending`, and use `otel: true`. See the [quick start](#quick-start).                             |
| A transport before 0.29                                                                                                                                                   | Move the transport and the SDK to 0.29 or later. If you cannot move yet, stay on 2.x.                                                |
| A hand-written `errorSerializer` that walks `serializeError`'s output to drop properties                                                                                  | `createErrorSerializer({ omit })`, with the rule as the predicate. See [the AI SDK example](#example-ai-sdk-errors-in-app-insights). |

- `@opentelemetry/winston-transport` is an optional peer dependency at `>=0.29`. npm 7 and later refuse to install alongside an older transport, and pnpm and Yarn warn. Consumers that do not ship logs through OpenTelemetry are unaffected.
- `otel` shapes the OpenTelemetry transport only. The console and other transports keep nested values and `level: 'audit'`, so a local `flatten: false` is no longer needed. A logger or transport set to `level: 'audit'` is allowed.
- `otelAttributesFormat` always writes `logLevel` and exports `audit` at `info` severity. In 2.x, `flatten: 'otel'` did neither without `mapAuditLevelForOtel`.
- A `Date` under `otel` is its ISO string, unquoted. `flatten: true` wrote it as a quoted JSON string.

New functionality:

- `otel` finds the transport `WinstonInstrumentation` adds, so the console stays readable while OpenTelemetry receives flat attributes.
- `otelAttributesFormat` takes a `maxAttributeLength` option, beside its `replacer`.
- `createErrorSerializer` builds an error serializer that can leave properties out of every error, or write a shared object once.
- `CallbackTransport` takes `onlyLevels`, to forward only some levels, and `closeTimeoutMs`, to bound how long `close()` waits.

## Migrating from v1

Breaking changes:

- The `lodash` dependency has been replaced with `es-toolkit` as a peer dependency.
- Node.js `>=20` is required.
- **Error serialisation has changed.** `serializeError` now captures `name` (in addition to `message` and `stack`), follows `cause` chains, walks own enumerable properties, captures `AggregateError.errors`, stringifies `BigInt` values, replaces `Buffer` and stream values with sentinel strings, and is safe against circular references. Any consumer asserting against v1's exact `{ message, stack, ...rest }` shape will need to update.
- **Errors nested in structured metadata are now serialised on every transport, not just the Console transport.** v1 only ran `serializableErrorReplacer` inside the Console's `format.json`, so custom transports received the raw `Error` instance (with non-enumerable `message`/`stack` hidden). v2 prepends the new `serializeErrorFormat` at the logger level, which walks the full info tree and substitutes plain objects before any transport sees them. If a custom transport relied on receiving an `Error` instance, switch it to read the serialised shape — or pass `errorSerializer` to `createLogger` (or `serializer` to `serializeErrorFormat` directly) to plug in your own transformation.
- `omitPaths` now applies at the logger level and affects every transport, not just the Console transport. If you added custom transports expecting the un-omitted object, move omit handling into that transport's format.
- A new `audit` level sits between `warn` and `info`. Loggers configured at `level: 'info'` (or more verbose) will now include `audit` messages; loggers at `level: 'warn'` or higher still filter them out.
- Pass a custom `levels` map via `loggerOptions` to opt out of the default level set (including `audit`); the returned logger type narrows to your keys.
- Submodule deep-imports (e.g. `@makerx/node-winston/redact-format`, `@makerx/node-winston/serialize-error`) are no longer exported. The package's `exports` field declares a single `.` entry; every public format, helper and type is re-exported from the root, so import them from `@makerx/node-winston` directly.

New functionality:

- New `redactPaths` / `redactedValue` options replace values at dot-notation paths with a placeholder (default `'<redacted>'`). Like `omitPaths` they apply at the logger level and affect every transport, so they're a drop-in replacement for any hand-rolled redaction you previously bolted onto `loggerOptions.format` or a custom transport. Also exported as the standalone `redactFormat`, plus the `redactValues` / `redactValuesWith` helpers for direct use.
- New `flatten` / `flattenReplacer` options serialise every top-level value on the log info to a JSON string, producing a flat `{ key: string }` shape suited to OTEL + Azure Log Analytics and other scalar-only aggregators. Also available as `jsonStringifyValuesFormat` and `jsonStringifyValues`. (The options were replaced by `otel` in v3.)
- The new `serializeErrorFormat` is exported for direct use in your own format chains, and accepts a `serializer` override for swapping in custom error normalisation.
- `createLogger` is now generic over the level map. When you pass `loggerOptions.levels`, the returned logger's method signatures narrow to your level keys (`logger.fatal(...)` becomes valid, `logger.audit` becomes a type error).
- Colours for the default levels (including `audit`) are registered on first use of the default levels, so `colorize` / pretty output works out of the box without a module-load side effect.
- `defaultLevels` and `defaultLevelColors` are exported directly if you want to extend or re-use them.
- `winstonDefaultLevels` and `winstonDefaultLevelColors` re-export winston's stock `npm` level set (`error`/`warn`/`info`/`http`/`verbose`/`debug`/`silly`) so consumers can opt back into the standard winston levels via `loggerOptions.levels` — colours register automatically on first use.
- New `mapAuditLevelForOtel` option (and standalone format) rewrites the triple-beam `LEVEL` symbol from `audit` to `info` so OTEL maps the record onto a known severity tier, while preserving the original level on a `logLevel` property. (The option was replaced by `otel` in v3; see [Audit severity](#audit-severity).)
