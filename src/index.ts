import { format, Format } from 'logform'
import { createLogger as winstonCreateLogger, Logger as WinstonLogger, LoggerOptions, LeveledLogMethod, addColors } from 'winston'
import * as Transport from 'winston-transport'
import { Console, ConsoleTransportOptions } from 'winston/lib/winston/transports'
import { jsonStringifyValuesFormat } from './json-stringify-values-format'
import { omitFormat } from './omit-format'
import { omitNilFormat } from './omit-nil-format'
import { prettyConsoleFormat } from './pretty-console-format'
import { redactFormat } from './redact-format'
import { serializableErrorReplacer } from './serialize-error'
import { serializeErrorFormat } from './serialize-error-format'

export * from './json-stringify-values'
export * from './json-stringify-values-format'
export * from './omit-format'
export * from './omit-nil-format'
export * from './pretty-console-format'
export * from './redact-format'
export * from './redact-values'
export * from './serialize-error'
export * from './serialize-error-format'

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

// Register colours for the default levels so `colorize` / pretty output works out of the box.
// Callers who override `levels` should register their own colours via `winston.addColors`.
addColors({
  error: 'red',
  warn: 'yellow',
  audit: 'magenta',
  info: 'green',
  debug: 'blue',
  verbose: 'cyan',
})

export type LoggerWithLevels<L extends Record<string, number>> = Pick<WinstonLogger, 'child' | 'log'> & {
  [K in keyof L]: LeveledLogMethod
}

export type Logger = LoggerWithLevels<typeof defaultLevels>

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
   * Winston `LoggerOptions` forwarded to the underlying logger (e.g. `level`, `defaultMeta`).
   * `transports` is managed by this library; pass extras via `transports` instead.
   * A `format` provided here is appended after the library's logger-level formats, but still runs
   * before `flatten` (which is always last when enabled).
   */
  loggerOptions?: Omit<LoggerOptions, 'transports'>
}

export const createConsoleTransport = ({ consoleFormat = 'json', consoleOptions, consoleFormats }: CreateLoggerOptions) => {
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
      : format.combine(format.timestamp(), ...formats, format.json({ replacer: serializableErrorReplacer })),
  }
  return new Console(options)
}

export function createLogger<const L extends Record<string, number>>(
  options: CreateLoggerOptions & { loggerOptions: Omit<LoggerOptions, 'transports'> & { levels: L } },
): LoggerWithLevels<L>
export function createLogger(options: CreateLoggerOptions): Logger
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createLogger(options: CreateLoggerOptions): any {
  const { omitPaths, redactPaths, redactedValue = '<redacted>', flatten, flattenReplacer } = options

  // aggregate transports
  const consoleTransport = createConsoleTransport(options)
  const transports: Transport[] = [consoleTransport]
  if (options.transports) transports.push(...options.transports)

  // logger-level formats apply to all transports
  const loggerFormats: Format[] = [serializeErrorFormat()]
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
