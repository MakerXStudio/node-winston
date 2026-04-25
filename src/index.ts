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
import { jsonStringifyValuesFormat } from './json-stringify-values-format'
import { omitFormat } from './omit-format'
import { omitNilFormat } from './omit-nil-format'
import { prettyConsoleFormat } from './pretty-console-format'
import { redactFormat } from './redact-format'
import { createSerializableErrorReplacer, ErrorSerializer, serializeError } from './serialize-error'
import { serializeErrorFormat } from './serialize-error-format'
import { mapAuditLevelForOtel } from './map-audit-level-for-otel'

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
   * When `true`, appends `jsonStringifyValuesFormat` as the final logger-level format — applied after every
   * other logger-level format (including any `loggerOptions.format`) — serialising every top-level value on
   * the log info to a JSON string. Produces a flat `{ key: string }` shape suitable for transports/aggregators
   * that expect scalar values (e.g. OTEL + Azure Log Analytics).
   */
  flatten?: boolean

  /**
   * Optional `JSON.stringify` replacer forwarded to `flatten` when serialising each top-level value.
   * Only applied when `flatten` is `true`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flattenReplacer?: (this: any, key: string, value: any) => any

  /**
   * When `true`, prepends `mapAuditLevelForOtel` to the logger-level format chain. Rewrites the
   * triple-beam `LEVEL` symbol from `audit` to `info` so OTEL maps the record onto a known severity
   * tier, and copies the original level onto a `logLevel` property so it survives as an OTEL attribute
   * (the OTEL winston-transport strips the string `level`). Enable when shipping logs via OTEL — most
   * visibly for Azure Monitor / Log Analytics, but applies to any OTEL backend that relies on the
   * spec-defined severity.
   */
  mapAuditLevelForOtel?: boolean

  /**
   * Custom serializer used whenever an `Error` instance is encountered, both by the logger-level
   * `serializeErrorFormat` (walks the full info tree) and by the Console transport's
   * `format.json` replacer (safety net for errors that slip through). Defaults to the library's
   * `serializeError`, which delegates to the
   * [`serialize-error`](https://www.npmjs.com/package/serialize-error) package.
   */
  errorSerializer?: ErrorSerializer

  /**
   * Winston `LoggerOptions` forwarded to the underlying logger (e.g. `level`, `defaultMeta`).
   * `transports` is managed by this library; pass extras via `transports` instead.
   * A `format` provided here is appended after the library's logger-level formats, but still runs
   * before `flatten` (which is always last when enabled).
   */
  loggerOptions?: Omit<LoggerOptions, 'transports'>
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
  const {
    omitPaths,
    redactPaths,
    redactedValue = '<redacted>',
    flatten,
    flattenReplacer,
    errorSerializer,
    mapAuditLevelForOtel: mapAuditForOtel,
  } = options

  // register default colours on first use of a known level set so `colorize` / pretty output works.
  // Detected by referential equality: an unknown `levels` map means the caller is responsible for
  // registering colours themselves via `winston.addColors`.
  const userLevels = options.loggerOptions?.levels
  if (!userLevels || userLevels === defaultLevels) registerDefaultColors()
  else if (userLevels === winstonDefaultLevels) registerWinstonDefaultColors()

  // Guard against silent audit-record loss: the format rewrites the LEVEL symbol from 'audit' to 'info',
  // which the filter on any transport set to level:'audit' would then drop (info is more verbose than audit).
  if (mapAuditForOtel) {
    const misconfigured: string[] = []
    if (options.loggerOptions?.level === 'audit') misconfigured.push('loggerOptions.level')
    if (options.consoleOptions?.level === 'audit') misconfigured.push('consoleOptions.level')
    options.transports?.forEach((t, i) => {
      if (t.level === 'audit') misconfigured.push(`transports[${i}].level`)
    })
    if (misconfigured.length > 0) {
      throw new Error(
        `mapAuditLevelForOtel rewrites the triple-beam LEVEL symbol from 'audit' to 'info', ` +
          `which would be dropped by the 'audit'-level filter on ${misconfigured.join(', ')}. ` +
          `Use 'info' (or a more verbose level) instead.`,
      )
    }
  }

  // aggregate transports
  const consoleTransport = createConsoleTransport(options)
  const transports: Transport[] = [consoleTransport]
  if (options.transports) transports.push(...options.transports)

  // logger-level formats apply to all transports
  const loggerFormats: Format[] = [serializeErrorFormat({ serializer: errorSerializer })]
  if (mapAuditForOtel) loggerFormats.push(mapAuditLevelForOtel())
  if (omitPaths) loggerFormats.push(omitFormat({ paths: omitPaths }))
  if (redactPaths) loggerFormats.push(redactFormat({ paths: redactPaths, redactedValue }))
  if (options.loggerOptions?.format) loggerFormats.push(options.loggerOptions.format)
  // flatten is applied last so all prior transformations are captured in the stringified values
  if (flatten) loggerFormats.push(jsonStringifyValuesFormat({ replacer: flattenReplacer }))

  // create logger options using supplied options + transports; loggerOptions.levels (if any) overrides defaultLevels
  const loggerOptions: LoggerOptions = {
    levels: defaultLevels,
    ...options.loggerOptions,
    format: format.combine(...loggerFormats),
    transports,
  }

  return winstonCreateLogger(loggerOptions)
}
