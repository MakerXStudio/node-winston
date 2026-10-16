# Node Winston

A set of [winston](https://github.com/winstonjs/winston) [formats](https://github.com/winstonjs/winston#formats), a console transport and a logger factory that simplify structured logging in Node.js services — with colourised YAML output for local development and support for OTEL integration.

## Installation

```sh
npm install @makerx/node-winston
```

`winston`, `logform`, `winston-transport`, `triple-beam` and `es-toolkit` are peer dependencies so the package shares a single instance with your app's `winston`. npm 7+ and pnpm install them automatically; on Yarn Classic, install them yourself.

`@opentelemetry/winston-transport` `>=0.29` is an optional peer dependency. Install it only when you ship logs through OpenTelemetry: see [OpenTelemetry](#opentelemetry).

Requires Node.js `>=20`.

### Upgrading

See [Migrating from v2](#migrating-from-v2) and [Migrating from v1](#migrating-from-v1) at the bottom for breaking changes and new functionality.

## Creating a Logger

`createLogger` builds a winston `Logger` with a pre-configured `Console` transport and a set of logger-level formats that apply to every transport.

Formats are applied in two layers:

- **Logger-level** (applied to all transports, in order): `serializeErrorFormat` → `omitFormat` (if `omitPaths`) → `redactFormat` (if `redactPaths`) → `loggerOptions.format` (if supplied) → `otelAttributesFormat` (if `otel`); always last so it captures every prior transformation.
- **Console transport** (applied to Console output only): `omitNilFormat` → any `consoleFormats` → either `prettyConsoleFormat` (when `consoleFormat: 'pretty'`) or `timestamp` + `json` (when `consoleFormat: 'json'`).

### Options

| Option            | Type                                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consoleFormat`   | `'json' \| 'pretty'`                     | Output format for the Console transport. `json` (default) for deployed environments, `pretty` for colourised YAML during local development.                                                                                                                                                                                                                                                                                                                               |
| `consoleOptions`  | `ConsoleTransportOptions`                | Options forwarded to the Console transport (e.g. `silent`, per-transport `level`). The `format` property is managed by this library.                                                                                                                                                                                                                                                                                                                                      |
| `consoleFormats`  | `Format[]`                               | Extra formats appended to the Console transport's format chain, before the final `json`/`pretty` step. Applies to the Console transport only.                                                                                                                                                                                                                                                                                                                             |
| `transports`      | `Transport[]`                            | Additional winston transports attached alongside the Console transport.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `omitPaths`       | `string[]`                               | Dot-notation paths to remove from every log entry. Applied at the logger level, so affects all transports.                                                                                                                                                                                                                                                                                                                                                                |
| `redactPaths`     | `string[]`                               | Dot-notation paths whose values are replaced with `redactedValue`. Applied at the logger level, so affects all transports.                                                                                                                                                                                                                                                                                                                                                |
| `redactedValue`   | `string`                                 | Replacement value used by `redactPaths`, and by `otel` redaction unless `otel.redactedValue` is set. Defaults to `'<redacted>'`.                                                                                                                                                                                                                                                                                                                                          |
| `otel`            | `boolean \| OtelAttributesFormatOptions` | Shapes every record for `@opentelemetry/winston-transport` 0.29 and later, as the last logger-level format. `true` uses the defaults of `otelAttributesFormat`; an object is passed to it as its options. Use it when `@opentelemetry/instrumentation-winston` adds the transport; otherwise put the format on the transport. See [OpenTelemetry](#opentelemetry).                                                                                                        |
| `errorSerializer` | `ErrorSerializer`                        | Custom serializer applied to every `Error` instance at the logger level (via `serializeErrorFormat`) and as the Console transport's `format.json` replacer. Defaults to the library's `serializeError`, which captures `name`/`message`/`stack`/`code`/`cause`/`errors` even when non-enumerable, walks own enumerable properties, and is safe against circular references. Pass `compactErrorSerializer` to leave out what makes a failed AI SDK retry too large to log. |
| `loggerOptions`   | `LoggerOptions`                          | Winston logger options (e.g. `level`, `defaultMeta`). A `format` supplied here is appended after the library's logger-level formats but still runs before `otel` when enabled.                                                                                                                                                                                                                                                                                            |

### Log levels

`createLogger` applies a level set where `debug` is noisier than `verbose` (unlike winston's default, which has them reversed). This matches the convention used by Seq, CloudWatch and most log aggregators, where Verbose/Trace is expected to be the lowest, noisiest level. An `audit` level sits between `warn` and `info` for audit-trail events that should flow through at `info` and above but be filtered at `warn`:

```ts
{ error: 0, warn: 1, audit: 2, info: 3, debug: 4, verbose: 5 }
```

`audit` is for audit-trail events: a sign-in, a role change, a data export. It is a log level, not an audit store, so it adds no delivery or retention guarantee: route it with a transport if it needs one (see [`CallbackTransport`](#callbacktransport)). A logger at `info` or more verbose writes `audit` records, and a logger at `warn` drops them. OpenTelemetry has no `audit` severity, so the OTel output exports an `audit` record at `info` severity with `logLevel: 'audit'` (see [Audit severity](#audit-severity)). In Azure Log Analytics, query it as `customDimensions.logLevel == "audit"`.

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

### Custom transport as an integration point

A custom `winston-transport` is a clean place to fan selected log records out to an external destination — an audit endpoint, a queue, an analytics service. Subclass `Transport`, override `log` to filter and dispatch, and override `close` to drain in-flight work on shutdown so records aren't lost when the process exits.

The library exports `extractTransformableInfo`, a small helper that strips winston's internal `triple-beam` symbols (`LEVEL`, `SPLAT`) from the `TransformableInfo` and splits out `level`, `message` and the remaining metadata:

```ts
import Transport from 'winston-transport'
import { type TransformableInfo } from 'logform'
import { extractTransformableInfo } from '@makerx/node-winston'

export type LogError = (message: string, ...args: any[]) => void

class AuditTransport extends Transport {
  private readonly inFlight = new Set<Promise<unknown>>()

  constructor(private readonly logError: LogError) {
    super()
  }

  override log(info: TransformableInfo, next: () => void): void {
    const { level, message, meta } = extractTransformableInfo(info)

    if (level !== 'audit') {
      next()
      return
    }

    const promise = Promise.resolve()
      .then(() => sendToAuditEndpoint({ level, message, ...meta }))
      .catch((error) => this.logError('Error in AuditTransport:', { error }))
      .finally(() => this.inFlight.delete(promise))

    this.inFlight.add(promise)

    next()
  }

  override async close(): Promise<void> {
    await Promise.allSettled([...this.inFlight])
  }
}

const logger = createLogger({
  transports: [new AuditTransport((message, ...args) => logger.error(message, ...args))],
})
```

A few things worth calling out:

- Always call `next()` exactly once per record, including when the level filter rejects it — winston-transport is a `Writable` stream, and skipping the callback stalls the pipeline.
- Don't `await` the dispatch inside `log`. Track the promise in a `Set` so `close()` can wait on it later, and let the dispatch run in the background.
- Inject an error sink (`logError`) rather than logging dispatch failures via the same logger this transport is attached to — otherwise a failing endpoint produces an audit record that produces another failing dispatch.
- Override `close()` and `Promise.allSettled` the in-flight set so a failing dispatch doesn't reject the drain. Winston calls `close` from `logger.close()` / `logger.end()`, so transports get a chance to flush before exit.

#### `CallbackTransport`

For the common case where the only thing you'd customise is the dispatch itself, the library exports `CallbackTransport` — a ready-made subclass that wraps the boilerplate above. Construct it with a promise-returning `LogHandler` (receives a `TransformedInfo` — the same `{ level, message, meta }` shape `extractTransformableInfo` returns) and a `LogError` sink for dispatch failures, and pass any standard winston-transport options (e.g. `level`) through the third argument:

```ts
import { CallbackTransport, createLogger } from '@makerx/node-winston'

const logger = createLogger({
  transports: [
    new CallbackTransport(
      ({ level, message, meta }) => sendToAuditEndpoint({ level, message, ...meta }),
      (message, ...args) => logger.error(message, ...args),
      { level: 'audit' },
    ),
  ],
})
```

In-flight dispatches are tracked internally and drained via `Promise.allSettled` on `close()`, and any rejection from the handler is routed to the supplied `logError` so a failing endpoint can't recurse back through this transport.

`CallbackTransport` filters on the string `info.level` rather than the triple-beam `LEVEL` symbol, so the `level` option remains accurate when paired with `createLogger({ otel: true })`, whose audit mapping rewrites the symbol but leaves the string untouched. For the same reason it sidesteps the `otel` + `level: 'audit'` guard in `createLogger` — the option is intercepted by the transport rather than passed down to the base `winston-transport` class.

## OpenTelemetry

[`@opentelemetry/winston-transport`](https://www.npmjs.com/package/@opentelemetry/winston-transport) forwards each winston record through the OpenTelemetry Logs SDK. Add it yourself, or let [`@opentelemetry/instrumentation-winston`](https://www.npmjs.com/package/@opentelemetry/instrumentation-winston) add it to every logger. It is an optional peer dependency of this library, and version 0.29 or later is required.

`otelAttributesFormat` shapes each record into the attributes the transport and the logs SDK need. Most backends, Azure Log Analytics included, index only scalar attributes, so a nested value has to arrive as a JSON string to be queryable.

### Where to apply it

When you construct the transport yourself, put the format on that transport. The console and every other transport keep their nested output:

```ts
import { OpenTelemetryTransportV3 } from '@opentelemetry/winston-transport'
import { createLogger, otelAttributesFormat } from '@makerx/node-winston'

const logger = createLogger({
  transports: [new OpenTelemetryTransportV3({ format: otelAttributesFormat() })],
})
```

`@opentelemetry/instrumentation-winston` constructs its transport without a format, so with it use the `otel` option. It applies the format at the logger level, which changes what every transport receives, the console included:

```ts
const logger = createLogger({ otel: true })
```

`otel` also takes the format's [options](#options-1), for example `otel: { redactKeys: [...defaultOtelRedactKeys, 'prompt'] }`.

### Supported transport lines

| `@opentelemetry/winston-transport` | Matching SDK line | What the transport does                                                                    |
| ---------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| 0.29 – 0.31                        | 0.219 – 0.221     | Records an `err`/`error` value as the record's exception; passes every other value through |
| 0.32 – 0.33                        | 0.222 – 0.223     | As 0.29, and normalises object values into nested map attributes                           |
| 0.34 and later                     | 0.223 and later   | As 0.32, and takes `severityMapping` and `logSeverity` options                             |

A transport before 0.29 is not supported: see [Migrating from v2](#migrating-from-v2).

The transport is tied to an SDK line through its `@opentelemetry/api-logs` dependency, so move the two together. With two copies of `api-logs` in the tree, the transport binds to a logger provider nobody registers, and every log line goes nowhere.

### What the format does

From 0.29 the transport gives the logs SDK an `err`/`error` value as the exception. The SDK keeps only `name`, `message`, `stack` and a cause's message: they become `exception.type`, `exception.message`, `exception.stacktrace` and `error.cause.*`, and every other field of the error is dropped. The format works with that:

- The error stays an object with only the fields the SDK reads. The rest of it, such as an HTTP status, a provider's error body or the cause chain, goes to `errorDetail` as JSON.
- Every other object value becomes a JSON string. Scalars are left alone, and a `Date` becomes its ISO string.
- Every record gets `logLevel`, and an `audit` record is exported at `info` severity. See [Audit severity](#audit-severity).
- `requestBodyValues` is redacted, a failed AI SDK retry is compacted, and every string the format writes is capped at 8,192 characters. See [Errors from the AI SDK](#errors-from-the-ai-sdk).

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

Without the format, two things go wrong:

- **`jsonStringifyValuesFormat`** turns the error into a JSON string first, and the SDK records the whole string as `exception.message`, with no `exception.type` or stack trace.
- **No format** records the exception, but loses the rest of the error, and other object values arrive as nested maps.

### Options

| Option               | Default                 | Description                                                                                                                                                            |
| -------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mapAuditLevel`      | `true`                  | Exports an `audit` record at `info` severity and copies every record's level onto `logLevel`. See [Audit severity](#audit-severity).                                   |
| `redactKeys`         | `defaultOtelRedactKeys` | Keys whose values are replaced with `redactedValue`, matched at every depth. The list replaces the default: spread `defaultOtelRedactKeys` to add a key, or pass `[]`. |
| `redactedValue`      | `'<redacted>'`          | Replacement value for `redactKeys`. With `otel`, defaults to the logger's `redactedValue`.                                                                             |
| `compactErrors`      | `true`                  | Leaves `responseHeaders` out of every error, and `lastError` out of an error whose `errors` already holds it.                                                          |
| `maxAttributeLength` | `8192`                  | The longest string the format writes. A longer one is cut short and ends in `[Truncated]`. `Infinity` writes every string whole.                                       |
| `replacer`           | none                    | `JSON.stringify` replacer for every value the format stringifies, `errorDetail` included. Runs after redaction and compaction.                                         |

`defaultOtelRedactKeys` is `['requestBodyValues']`.

### Audit severity

OpenTelemetry's log spec defines a fixed severity enumeration, so the transport has no severity for winston's `audit` level. Azure Monitor ignores a record without one, and a transport's `logSeverity` filter drops it. So the format exports an `audit` record at `info` severity by rewriting the triple-beam `LEVEL` symbol. It also copies every record's level onto `logLevel`, so the original survives as an attribute. The string `level` is not changed, so console JSON still shows `"level": "audit"`.

`LEVEL` also drives level filtering, so where the mapping runs matters:

- **On a transport's own format**, it runs after that transport's level filter. A transport set to `level: 'audit'` keeps audit records, and other transports never see the rewrite.
- **With `otel`**, it runs before every transport's filter. A logger, console or transport set to `level: 'audit'` would then drop audit records, so `createLogger` throws for that combination. Use `'info'` there, or put the format on the transport instead.

Under `otel`, pretty console output colours an `audit` line as `info`.

From 0.34 the transport can map the level itself and keep `severityText: 'audit'`. Turn the format's mapping off and give the transport a `severityMapping`:

```ts
import { SeverityNumber } from '@opentelemetry/api-logs'

new OpenTelemetryTransportV3({
  format: otelAttributesFormat({ mapAuditLevel: false }),
  severityMapping: { audit: SeverityNumber.INFO },
})
```

`WinstonInstrumentation` takes the same `severityMapping` option: pair it with `otel: { mapAuditLevel: false }`. Do not turn the mapping off without a `severityMapping` when you set `logSeverity`, because an `audit` record with no severity is dropped.

### Errors from the AI SDK

An AI SDK `APICallError` carries the whole request as `requestBodyValues`: the prompt and everything it was built from. A `RetryError` holds every attempt under `errors` and the last one again under `lastError`, each with its response headers. That overruns the 8,192-character limit of an App Insights custom dimension, which App Insights then cuts short so it no longer parses as JSON.

So by default the format:

- replaces `requestBodyValues` with `'<redacted>'`, at every depth
- leaves `responseHeaders` out of every error, and `lastError` out of an error whose `errors` already holds it
- cuts any string it writes that is longer than 8,192 characters, ending it in `[Truncated]` so the cut is visible

These defaults apply to OpenTelemetry output only. To apply them to the console and every other transport as well:

```ts
import { compactErrorSerializer, createLogger } from '@makerx/node-winston'

const logger = createLogger({
  redactPaths: ['requestBodyValues'],
  errorSerializer: compactErrorSerializer,
})
```

### Exceptions found in metadata

With no `err` or `error` on a record, the transport takes the first metadata object that has a `name`, `code`, `message` or `stack` as the record's exception. So `logger.info('created', { name: 'Alice' })` is exported with `exception.type: 'Alice'`, and a backend may file it as an exception. This is the transport's behaviour, not the format's. Log such values under a more specific key, such as `userName`.

## Formats

Every format used by `createLogger` is also exported for direct use with your own winston setup.

| Format                      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serializeErrorFormat`      | Walks the log info (including nested objects and arrays) and replaces `Error` instances with plain objects that include the normally non-enumerable `message`/`stack`. A record that is itself an error, or holds one under `message`, is nested under `error`.                                                                                                                                                                                     |
| `omitFormat`                | Removes fields by dot-notation path via [es-toolkit's compat `omit`](https://es-toolkit.dev/reference/compat/object/omit.html) (lodash-compatible).                                                                                                                                                                                                                                                                                                 |
| `omitNilFormat`             | Removes top-level `null` or `undefined` values.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `redactFormat`              | Recursively replaces values at the given paths with `redactedValue` (default `'<redacted>'`).                                                                                                                                                                                                                                                                                                                                                       |
| `otelAttributesFormat`      | Shapes a record into OpenTelemetry log attributes for `@opentelemetry/winston-transport` 0.29 and later: the error stays an object the transport records as the exception, the rest of it goes to `errorDetail`, and every other object value becomes a JSON string. By default it also exports `audit` at `info` severity, redacts `requestBodyValues`, compacts a failed AI SDK retry and caps long strings. See [OpenTelemetry](#opentelemetry). |
| `jsonStringifyValuesFormat` | Serialises every top-level value to a JSON string, producing a flat `{ key: string }` shape. Accepts an optional `replacer`. For a sink other than the OpenTelemetry transport; from transport 0.29 use `otelAttributesFormat`.                                                                                                                                                                                                                     |
| `prettyConsoleFormat`       | Applies `colorize` and `timestamp`, then renders logs as coloured YAML using [`yamlify-object`](https://www.npmjs.com/package/yamlify-object).                                                                                                                                                                                                                                                                                                      |
| `mapAuditLevelForOtel`      | Rewrites the triple-beam `LEVEL` symbol from `audit` to `info` and copies the original onto `logLevel` so custom levels survive OTEL's severity enumeration. `otelAttributesFormat` already does this; use it in a chain you build yourself.                                                                                                                                                                                                        |

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

`compactErrorSerializer` is a ready-made serializer: `serializeError` without `responseHeaders` on any error, and without `lastError` on an error whose `errors` already holds it. Pass it as `errorSerializer` to keep a failed AI SDK retry small on every transport. See [Errors from the AI SDK](#errors-from-the-ai-sdk).

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

v3 puts OpenTelemetry behind one option, `otel`, and supports `@opentelemetry/winston-transport` 0.29 and later only. 2.x gets fixes only, published under the `latest-2` dist-tag.

Breaking changes:

- **`flatten`, `flattenReplacer` and `mapAuditLevelForOtel` are removed from `createLogger`.** They are type errors, and `createLogger` throws if one is passed, so config-built options cannot silently fall back to nested output. Replace them as follows:

| 2.x                                                                          | 3.0                                                                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flatten: 'otel', mapAuditLevelForOtel: true`                                | `otel: true`                                                                                                                                     |
| `flattenReplacer: r` with `flatten: 'otel'`                                  | `otel: { replacer: r }`                                                                                                                          |
| `otelAttributesFormat()` on the transport, plus `mapAuditLevelForOtel: true` | `otelAttributesFormat()` on the transport alone. A transport set to `level: 'audit'` is now allowed.                                             |
| `flatten: true`, or `jsonStringifyValuesFormat()` on a transport before 0.29 | Move the transport and the SDK to 0.29 or later, then use `otelAttributesFormat()` or `otel`. If you cannot move yet, stay on 2.x.               |
| An `errorSerializer` that drops `responseHeaders` and `lastError`            | Nothing for OpenTelemetry output, which now does it by default. To keep it on the console too, use `errorSerializer: compactErrorSerializer`.    |
| `redactPaths: ['requestBodyValues', …]`                                      | Nothing for OpenTelemetry output, which now redacts it by default. **Keep it** in `redactPaths` if the console must not carry the prompt either. |

- **`@opentelemetry/winston-transport` is an optional peer dependency at `>=0.29`.** npm 7 and later refuse to install alongside an older transport; pnpm and Yarn warn. Consumers that do not ship logs through OpenTelemetry are unaffected.
- **The audit mapping runs last.** With `otel`, a `loggerOptions.format` now sees `LEVEL: 'audit'`; in 2.x it saw `info`.
- **OpenTelemetry output changes shape for anyone who logs these keys on purpose.** `requestBodyValues` is redacted, `responseHeaders` and a repeated `lastError` are left out of errors, and strings the format writes are capped at 8,192 characters. Each has an option to turn it off: see [Options](#options-1).
- **A `Date` under `otel` is its ISO string, unquoted.** `flatten: true` wrote it as a quoted JSON string.

New functionality:

- `otelAttributesFormat` takes `mapAuditLevel`, `redactKeys`, `redactedValue`, `compactErrors`, `maxAttributeLength` and `replacer` options.
- `compactErrorSerializer` compacts a failed AI SDK retry on every transport.
- `defaultOtelRedactKeys` lists the keys the format redacts by default.

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
