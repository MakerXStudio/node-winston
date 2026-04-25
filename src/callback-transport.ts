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
 * with the dispatch handler and an error sink for dispatch failures; filter records via
 * winston-transport's standard `level` option (or by inspecting the info inside the handler).
 *
 * @example
 * ```ts
 * const logger = createLogger({
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

  constructor(
    private readonly handler: LogHandler,
    private readonly logError: LogError,
    options?: Transport.TransportStreamOptions,
  ) {
    super(options)
  }

  override log(info: TransformableInfo, next: () => void): void {
    const transformed = extractTransformableInfo(info)

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
