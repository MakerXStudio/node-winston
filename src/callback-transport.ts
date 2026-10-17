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

export interface CallbackTransportOptions extends Transport.TransportStreamOptions {
  /**
   * Forwards only records at these levels. `level` forwards a level and every level above it, so
   * `level: 'audit'` also forwards `error` and `warn`. `onlyLevels: ['audit']` forwards `audit`
   * records alone.
   */
  onlyLevels?: readonly string[]

  /**
   * The longest `close()` waits for dispatches that are still running, in milliseconds. When it
   * stops waiting, it reports how many are still running through `logError`. By default `close()`
   * waits for every dispatch to finish.
   */
  closeTimeoutMs?: number
}

/**
 * Custom winston transport that forwards each log record to a promise-returning callback, with
 * built-in tracking of in-flight dispatches so `close()` can drain them on shutdown. Construct
 * with the dispatch handler, an error sink for dispatch failures, and (optionally) the standard
 * winston-transport options and {@link CallbackTransportOptions}.
 *
 * The stock winston-transport `level` filter compares the triple-beam `LEVEL` symbol. This transport
 * filters on the string `info.level` instead, so its `level` option stays accurate when a
 * logger-level format such as `mapAuditLevelForOtel` rewrites the `LEVEL` symbol. The constructor
 * keeps the option and does not pass it to the base class, so the base filter never runs.
 *
 * Winston does not wait for a transport's `close()`. Await it yourself on shutdown, so that
 * dispatches still running can finish before the process exits.
 *
 * @example
 * ```ts
 * const auditTransport = new CallbackTransport(
 *   ({ message, meta }) => sendToAuditEndpoint({ message, ...meta }),
 *   (message, ...args) => logger.error(message, ...args),
 *   { onlyLevels: ['audit'], closeTimeoutMs: 5_000 },
 * )
 * const logger = createLogger({ transports: [auditTransport] })
 *
 * // on shutdown
 * await auditTransport.close()
 * ```
 */
export class CallbackTransport extends Transport {
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly minLevel: string | undefined
  private readonly onlyLevels: ReadonlySet<string> | undefined
  private readonly closeTimeoutMs: number | undefined

  constructor(
    private readonly handler: LogHandler,
    private readonly logError: LogError,
    options?: CallbackTransportOptions,
  ) {
    const { level, onlyLevels, closeTimeoutMs, ...rest } = options ?? {}
    super(rest)
    this.minLevel = level
    this.onlyLevels = onlyLevels ? new Set(onlyLevels) : undefined
    this.closeTimeoutMs = closeTimeoutMs
  }

  override log(info: TransformableInfo, next: () => void): void {
    const transformed = extractTransformableInfo(info)

    // `levels` is set on the transport by winston when it's piped from a logger; the stock
    // `winston-transport` type definitions don't declare it, so we read it via cast.
    const levels = (this as unknown as { levels?: Record<string, number> }).levels
    const belowMinLevel = this.minLevel !== undefined && levels && levels[this.minLevel] < levels[transformed.level]
    if (belowMinLevel || (this.onlyLevels && !this.onlyLevels.has(transformed.level))) {
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
    const settled = Promise.allSettled([...this.inFlight])
    if (this.closeTimeoutMs === undefined) {
      await settled
      return
    }

    let timer: NodeJS.Timeout | undefined
    const timedOut = await Promise.race([
      settled.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), this.closeTimeoutMs)
      }),
    ])
    clearTimeout(timer)
    if (timedOut) {
      this.logError(`CallbackTransport closed after ${this.closeTimeoutMs} ms with ${this.inFlight.size} dispatch(es) still running`)
    }
  }
}
