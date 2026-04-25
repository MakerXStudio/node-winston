import { type TransformableInfo } from 'logform'
import Transport from 'winston-transport'
import { extractTransformableInfo, type TransformedInfo } from './utils'

/**
 * Sink for dispatch failures inside {@link CallbackTransport}. Pass a function that logs to a
 * different logger / channel than the one this transport is attached to — otherwise a failing
 * dispatch produces a record that produces another failing dispatch.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LogError = (message: string, ...args: any[]) => void

/**
 * Promise-returning callback invoked for every record forwarded to a {@link CallbackTransport}.
 * Receives the {@link TransformedInfo} produced by {@link extractTransformableInfo}.
 */
export type LogHandler = (info: TransformedInfo) => Promise<unknown>

/**
 * Custom winston transport that forwards each log record to a promise-returning callback, with
 * built-in tracking of in-flight dispatches so `close()` can drain them on shutdown. Construct
 * with the dispatch handler, an error sink for dispatch failures, and (optionally) the standard
 * winston-transport options.
 *
 * Unlike the stock winston-transport `level` filter — which compares the triple-beam `LEVEL`
 * symbol — this transport filters on the string `info.level` instead. That makes the `level`
 * option safe to combine with `mapAuditLevelForOtel`, which rewrites the `LEVEL` symbol but
 * leaves `info.level` alone. The option is intercepted in the constructor (not forwarded to
 * the base class), so `createLogger`'s `mapAuditLevelForOtel` + `level: 'audit'` guard does not
 * trip on it.
 *
 * @example
 * ```ts
 * const logger = createLogger({
 *   mapAuditLevelForOtel: true,
 *   transports: [
 *     new CallbackTransport(
 *       ({ level, message, meta }) => sendToAuditEndpoint({ level, message, ...meta }),
 *       (message, ...args) => logger.error(message, ...args),
 *       { level: 'audit' },
 *     ),
 *   ],
 * })
 * ```
 */
export class CallbackTransport extends Transport {
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly minLevel: string | undefined

  constructor(
    private readonly handler: LogHandler,
    private readonly logError: LogError,
    options?: Transport.TransportStreamOptions,
  ) {
    const { level, ...rest } = options ?? {}
    super(rest)
    this.minLevel = level
  }

  override log(info: TransformableInfo, next: () => void): void {
    const transformed = extractTransformableInfo(info)

    // `levels` is set on the transport by winston when it's piped from a logger; the stock
    // `winston-transport` type definitions don't declare it, so we read it via cast.
    const levels = (this as unknown as { levels?: Record<string, number> }).levels
    if (this.minLevel !== undefined && levels && levels[this.minLevel] < levels[transformed.level]) {
      next()
      return
    }

    const promise = Promise.resolve()
      .then(() => this.handler(transformed))
      .catch((error) => this.logError('Error in CallbackTransport:', { error }))
      .finally(() => this.inFlight.delete(promise))

    this.inFlight.add(promise)

    next()
  }

  override async close(): Promise<void> {
    await Promise.allSettled([...this.inFlight])
  }
}
