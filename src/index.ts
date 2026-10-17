import { format, Format } from 'logform'
import {
  createLogger as winstonCreateLogger,
  Logger as WinstonLogger,
  LoggerOptions,
  LeveledLogMethod,
  addColors,
  transports,
} from 'winston'
import * as Transport from 'winston-transport'
import { otelAttributesFormat, OtelAttributesFormatOptions } from './otel-attributes-format'
import { omitFormat } from './omit-format'
import { omitNilFormat } from './omit-nil-format'
import { prettyConsoleFormat } from './pretty-console-format'
import { redactFormat } from './redact-format'
import { createSerializableErrorReplacer, ErrorSerializer, serializeError } from './serialize-error'
import { serializeErrorFormat } from './serialize-error-format'
import { withNormalizedErrorArgs } from './normalize-error-args'

// `winston/lib/winston/transports` is a CJS deep import that can't be consumed from ESM: it's a
// directory import, and even with a `/index.js` suffix its named exports are defined via
// `Object.defineProperty(exports, 'X', { get() {...} })` which cjs-module-lexer doesn't expose
// as ESM named bindings. Go through winston's main entry instead.
const { Console } = transports
type ConsoleTransportOptions = transports.ConsoleTransportOptions

export * from './callback-transport'
export * from './json-stringify-values'
export * from './json-stringify-values-format'
export * from './omit-format'
export * from './omit-nil-format'
export * from './pretty-console-format'
export * from './redact-format'
export * from './redact-values'
export * from './serialize-error'
export * from './serialize-error-format'
export * from './map-audit-level-for-otel'
export * from './otel-attributes-format'
export * from './utils'

// winstonjs' default levels have debug and verbose reversed, which is confusing and causes filtering issues with Seq,
// CloudWatch etc (given they assume Verbose/Trace should be the lowest/noisiest log level).
// `audit` sits between `warn` and `info`, so audit logs are included at `info` and above but filtered at `warn`.
export const defaultLevels = {
  error: 0,
  warn: 1,
  audit: 2,
  info: 3,
  debug: 4,
  verbose: 5,
}

// Colours for the default levels, registered on first `createLogger` call that uses them
// so importing a single format doesn't silently mutate winston's global colour map.
// Callers who override `levels` should register their own colours via `winston.addColors`.
export const defaultLevelColors = {
  error: 'red',
  warn: 'yellow',
  audit: 'magenta',
  info: 'green',
  debug: 'blue',
  verbose: 'cyan',
}

// Winston's stock npm levels — exposed so consumers can opt back into them via
// `loggerOptions.levels` without reaching into `winston.config.npm`. Re-declared here (rather than
// re-exported from winston) so the keys stay literal and the generic `createLogger` overload narrows
// the returned logger's method signatures correctly.
export const winstonDefaultLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6,
}

export const winstonDefaultLevelColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'green',
  verbose: 'cyan',
  debug: 'blue',
  silly: 'magenta',
}

let defaultColorsRegistered = false
const registerDefaultColors = () => {
  if (defaultColorsRegistered) return
  addColors(defaultLevelColors)
  defaultColorsRegistered = true
}

let winstonDefaultColorsRegistered = false
const registerWinstonDefaultColors = () => {
  if (winstonDefaultColorsRegistered) return
  addColors(winstonDefaultLevelColors)
  winstonDefaultColorsRegistered = true
}

export type LoggerWithLevels<L extends Record<string, number>> = Pick<WinstonLogger, 'log'> & {
  child(options: object): LoggerWithLevels<L>
} & {
  [K in keyof L]: LeveledLogMethod
}

export type Logger = LoggerWithLevels<typeof defaultLevels>
export type WinstonDefaultLogger = LoggerWithLevels<typeof winstonDefaultLevels>

export interface CreateLoggerOptions {
  /**
   * Output format for the Console transport.
   * - `json` (default) — structured JSON output, suitable for deployed environments.
   * - `pretty` — colourised YAML output, useful for local development.
   */
  consoleFormat?: 'pretty' | 'json'

  /**
   * Additional winston transports to attach to the logger, alongside the built-in Console transport.
   */
  transports?: Transport[]

  /**
   * Options forwarded to the built-in Console transport (e.g. `silent`, per-transport `level`).
   * The `format` property is managed by this library and cannot be overridden here.
   */
  consoleOptions?: Omit<ConsoleTransportOptions, 'format'>

  /**
   * Extra formats appended to the Console transport's format chain, before the final
   * `json`/`pretty` step. Applies to the Console transport only.
   */
  consoleFormats?: Format[]

  /**
   * Dot-notation paths to remove from every log entry. Applied at the logger level, so affects all transports.
   * @example ['user.password', 'service']
   */
  omitPaths?: string[]

  /**
   * Dot-notation paths whose values are replaced with `redactedValue` on every log entry.
   * Applied at the logger level, so affects all transports.
   * @example ['user.email', 'authorization']
   */
  redactPaths?: string[]

  /**
   * Replacement value used by `redactPaths`. Defaults to `'<redacted>'`.
   */
  redactedValue?: string

  /**
   * Shapes what `@opentelemetry/winston-transport` 0.29 and later receives. Each
   * `OpenTelemetryTransportV3` on the logger that has no format of its own gets
   * {@link otelAttributesFormat}: the transport `WinstonInstrumentation` adds, and any passed in
   * `transports`. Other transports, the console included, keep their nested output. `true` uses the
   * format's defaults, and an object is passed to the format as its options.
   *
   * The format runs after the transport's level filter, so its audit mapping never drops a record.
   * A transport added later with `logger.add` is not shaped: give it `otelAttributesFormat()`.
   */
  otel?: boolean | OtelAttributesFormatOptions

  /**
   * Custom serializer used whenever an `Error` instance is encountered: by the logger-level
   * `serializeErrorFormat` (walks the full info tree), by `redactFormat` (which substitutes a
   * `DOMException` no deep clone can rebuild), and by the Console transport's `format.json`
   * replacer (safety net for errors that slip through). Defaults to the library's
   * `serializeError`, which captures `name`/`message`/`stack`/`code`/`cause`/`errors` even when
   * non-enumerable, walks own enumerable properties, and is safe against circular references.
   * Build one with `createErrorSerializer` to leave properties out of every error.
   */
  errorSerializer?: ErrorSerializer

  /**
   * Winston `LoggerOptions` forwarded to the underlying logger (e.g. `level`, `defaultMeta`).
   * `transports` is managed by this library; pass extras via `transports` instead.
   * A `format` provided here is appended after the library's logger-level formats.
   */
  loggerOptions?: Omit<LoggerOptions, 'transports'>
}

/** 2.x options that 3.0 removed. Each maps onto `otel`. See "Migrating from v2" in the README. */
const REMOVED_OPTIONS = ['flatten', 'flattenReplacer', 'mapAuditLevelForOtel'] as const

/**
 * Throws for an option that 3.0 removed. TypeScript rejects one in an object literal, but not in
 * options built from config or spread from another object. Ignoring it would send OpenTelemetry
 * records nested, with no warning.
 */
const rejectRemovedOptions = (options: CreateLoggerOptions) => {
  const given = REMOVED_OPTIONS.filter((key) => (options as Record<string, unknown>)[key] !== undefined)
  if (given.length === 0) return
  throw new Error(
    `createLogger no longer accepts ${given.join(', ')}. Use the \`otel\` option. ` +
      `See "Migrating from v2" in the @makerx/node-winston README.`,
  )
}

/**
 * The class `@opentelemetry/winston-transport` exports. It is matched by name because this library
 * does not depend on the transport, which is an optional peer.
 */
const OTEL_TRANSPORT_CLASS = 'OpenTelemetryTransportV3'

/**
 * Gives each OpenTelemetry transport on the logger that has no format of its own the
 * `otelAttributesFormat`. `WinstonInstrumentation` adds its transport while winston configures the
 * logger, so it is on the logger by the time winston's `createLogger` returns.
 */
const shapeOtelTransports = (logger: WinstonLogger, otelOptions: OtelAttributesFormatOptions) => {
  const otelFormat = otelAttributesFormat(otelOptions)
  for (const transport of logger.transports) {
    if (transport.constructor?.name === OTEL_TRANSPORT_CLASS && !transport.format) transport.format = otelFormat
  }
}

export const createConsoleTransport = ({
  consoleFormat = 'json',
  consoleOptions,
  consoleFormats,
  errorSerializer = serializeError,
}: CreateLoggerOptions) => {
  // aggregate the console formats
  const formats: Format[] = [omitNilFormat()]

  if (consoleFormats) formats.push(...consoleFormats)

  // load the pretty format, if requested (and if dependencies available)
  const prettyFormat = consoleFormat === 'pretty' ? prettyConsoleFormat() : undefined

  // construct the console transport
  const options: ConsoleTransportOptions = {
    handleExceptions: false,
    ...consoleOptions,
    format: prettyFormat
      ? format.combine(...formats, prettyFormat)
      : format.combine(format.timestamp(), ...formats, format.json({ replacer: createSerializableErrorReplacer(errorSerializer) })),
  }
  return new Console(options)
}

export function createLogger<const L extends Record<string, number>>(
  options: CreateLoggerOptions & { loggerOptions: Omit<LoggerOptions, 'transports'> & { levels: L } },
): LoggerWithLevels<L>
export function createLogger(options: CreateLoggerOptions): Logger
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createLogger(options: CreateLoggerOptions): any {
  const { omitPaths, redactPaths, redactedValue = '<redacted>', errorSerializer, otel } = options

  rejectRemovedOptions(options)

  const otelOptions: OtelAttributesFormatOptions | undefined = otel === true ? {} : otel || undefined

  // register default colours on first use of a known level set so `colorize` / pretty output works.
  // Detected by referential equality: an unknown `levels` map means the caller is responsible for
  // registering colours themselves via `winston.addColors`.
  const userLevels = options.loggerOptions?.levels
  if (!userLevels || userLevels === defaultLevels) registerDefaultColors()
  else if (userLevels === winstonDefaultLevels) registerWinstonDefaultColors()

  // aggregate transports
  const consoleTransport = createConsoleTransport(options)
  const transports: Transport[] = [consoleTransport]
  if (options.transports) transports.push(...options.transports)

  // logger-level formats apply to all transports
  const loggerFormats: Format[] = [serializeErrorFormat({ serializer: errorSerializer })]
  if (omitPaths) loggerFormats.push(omitFormat({ paths: omitPaths }))
  // `errorSerializer` is passed for consistency rather than for effect: `serializeErrorFormat` runs
  // first and leaves no live `Error` behind, so redaction has nothing left to substitute here. It
  // matters when `redactFormat` is composed on its own, and it keeps the shapes aligned if a future
  // path ever does let one through.
  if (redactPaths) loggerFormats.push(redactFormat({ paths: redactPaths, redactedValue, errorSerializer }))
  if (options.loggerOptions?.format) loggerFormats.push(options.loggerOptions.format)

  // create logger options using supplied options + transports; loggerOptions.levels (if any) overrides defaultLevels
  const loggerOptions: LoggerOptions = {
    levels: defaultLevels,
    ...options.loggerOptions,
    format: format.combine(...loggerFormats),
    transports,
  }

  const logger = winstonCreateLogger(loggerOptions)
  if (otelOptions) shapeOtelTransports(logger, otelOptions)

  // Wrapped rather than returned bare: winston branches three ways on an `Error` argument, and only
  // one of the shapes it produces needs no repair. See {@link withNormalizedErrorArgs}.
  return withNormalizedErrorArgs(logger, Object.keys(loggerOptions.levels ?? defaultLevels))
}
