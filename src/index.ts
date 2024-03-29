import { format, Format } from 'logform'
import { createLogger as winstonCreateLogger, Logger as WinstonLogger, LoggerOptions } from 'winston'
import * as Transport from 'winston-transport'
import { Console, ConsoleTransportOptions } from 'winston/lib/winston/transports'
import { omitFormat } from './omit-format'
import { omitNilFormat } from './omit-nil-format'
import { prettyConsoleFormat } from './pretty-console-format'
import { serializableErrorReplacer } from './serialize-error'

export * from './omit-format'
export * from './omit-nil-format'

export type Logger = Pick<
  WinstonLogger,
  // Supports child loggers
  | 'child'
  // Common levels
  | 'debug'
  | 'error'
  | 'info'
  | 'verbose'
  | 'warn'
  // General log method
  | 'log'
>

// winstonjs' default levels have debug and verbose reversed, which is confusing and causes filtering issues with Seq,
// CloudWatch etc (given they assume Verbose/Trace should be the lowest/noisiest log level)
const levels = {
  error: 0,
  warn: 1,
  info: 3,
  debug: 4,
  verbose: 5,
}

export interface CreateLoggerOptions {
  consoleFormat?: 'pretty' | 'json'
  transports?: Transport[]
  consoleOptions?: Omit<ConsoleTransportOptions, 'format'>
  consoleFormats?: Format[]
  omitPaths?: string[]
  loggerOptions?: Omit<LoggerOptions, 'transports'>
}

export const createConsoleTransport = ({ consoleFormat = 'json', consoleOptions, consoleFormats, omitPaths }: CreateLoggerOptions) => {
  // aggregate the console formats
  const formats: Format[] = [omitNilFormat()]
  if (omitPaths) formats.push(omitFormat({ paths: omitPaths }))
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

export const createLogger = (options: CreateLoggerOptions): Logger => {
  // aggregate transports
  const consoleTransport = createConsoleTransport(options)
  const transports: Transport[] = [consoleTransport]
  if (options.transports) transports.push(...options.transports)

  // create logger options using supplied options + transports
  const loggerOptions: LoggerOptions = {
    levels, // loggerOptions should still be allowed to override our defaults
    ...options.loggerOptions,
    transports,
  }

  return winstonCreateLogger(loggerOptions)
}
