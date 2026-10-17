import { type TransformableInfo } from 'logform'
import { LEVEL } from 'triple-beam'
import { describe, expect, it, vi } from 'vitest'
import { CallbackTransport } from './callback-transport'
import { defaultLevels } from './index'
import { type TransformedInfo } from './utils'

const buildInfo = (level: string, message: string, meta: Record<string, unknown> = {}): TransformableInfo =>
  ({ [LEVEL]: level, level, message, ...meta }) as TransformableInfo

const attachLevels = (transport: CallbackTransport, levels: Record<string, number> = defaultLevels): CallbackTransport => {
  ;(transport as unknown as { levels: Record<string, number> }).levels = levels
  return transport
}

describe('CallbackTransport', () => {
  it('forwards each record to the handler with extracted info', async () => {
    const received: TransformedInfo[] = []
    const transport = new CallbackTransport(
      async (info) => {
        received.push(info)
      },
      () => {},
    )

    transport.log!(buildInfo('info', 'hello', { user: 'u-1' }), () => {})
    transport.log!(buildInfo('audit', 'audit-event', { actor: 'a-1' }), () => {})

    await transport.close!()

    expect(received).toHaveLength(2)
    expect(received[0]).toEqual({ level: 'info', message: 'hello', meta: { user: 'u-1' } })
    expect(received[1]).toEqual({ level: 'audit', message: 'audit-event', meta: { actor: 'a-1' } })
  })

  it('routes handler rejections to the logError sink', async () => {
    const failure = new Error('endpoint down')
    const logError = vi.fn()
    const transport = new CallbackTransport(() => Promise.reject(failure), logError)

    transport.log!(buildInfo('info', 'boom'), () => {})

    await transport.close!()

    expect(logError).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith('Error in CallbackTransport:', { error: failure })
  })

  it('calls next exactly once per record without awaiting the handler', () => {
    let resolveHandler!: () => void
    const handlerPromise = new Promise<void>((resolve) => {
      resolveHandler = resolve
    })
    const transport = new CallbackTransport(
      () => handlerPromise,
      () => {},
    )
    const next = vi.fn()

    transport.log!(buildInfo('info', 'pending'), next)

    expect(next).toHaveBeenCalledTimes(1)
    resolveHandler()
  })

  it('drains in-flight dispatches on close', async () => {
    let resolveHandler!: () => void
    const handlerPromise = new Promise<void>((resolve) => {
      resolveHandler = resolve
    })
    let handlerSettled = false
    const transport = new CallbackTransport(
      () =>
        handlerPromise.then(() => {
          handlerSettled = true
        }),
      () => {},
    )

    transport.log!(buildInfo('info', 'pending'), () => {})

    const closing = transport.close!()
    expect(handlerSettled).toBe(false)

    resolveHandler()
    await closing

    expect(handlerSettled).toBe(true)
  })

  it('filters records below the configured level using the string info.level', async () => {
    const received: TransformedInfo[] = []
    const transport = attachLevels(
      new CallbackTransport(
        async (info) => {
          received.push(info)
        },
        () => {},
        { level: 'audit' },
      ),
    )

    transport.log!(buildInfo('error', 'error-event'), () => {})
    transport.log!(buildInfo('audit', 'audit-event'), () => {})
    transport.log!(buildInfo('info', 'info-event'), () => {})
    transport.log!(buildInfo('verbose', 'verbose-event'), () => {})

    await transport.close!()

    expect(received.map((info) => info.message)).toEqual(['error-event', 'audit-event'])
  })

  it('filters on the string info.level even when LEVEL symbol has been rewritten', async () => {
    const received: TransformedInfo[] = []
    const transport = attachLevels(
      new CallbackTransport(
        async (info) => {
          received.push(info)
        },
        () => {},
        { level: 'audit' },
      ),
    )

    // As `mapAuditLevelForOtel` leaves a record: LEVEL rewritten from 'audit' to 'info', the string
    // `level` untouched. winston-transport's stock filter would drop this record, and ours must not.
    const audit = { [LEVEL]: 'info', level: 'audit', message: 'audit-event' } as TransformableInfo

    transport.log!(audit, () => {})

    await transport.close!()

    expect(received.map((info) => info.message)).toEqual(['audit-event'])
  })

  it('does not expose the configured level on the underlying winston Transport', () => {
    const transport = new CallbackTransport(
      async () => {},
      () => {},
      { level: 'audit' },
    )
    // The constructor keeps `level` for itself, so the base class's filter, which reads the LEVEL
    // symbol, never runs.
    expect(transport.level).toBeUndefined()
  })

  it('routes audit records at level audit after a logger-level mapAuditLevelForOtel', async () => {
    const { createLogger, mapAuditLevelForOtel } = await import('./index')
    const received: TransformedInfo[] = []
    const transport = new CallbackTransport(
      async (info) => {
        received.push(info)
      },
      () => {},
      { level: 'audit' },
    )

    // The mapping rewrites LEVEL before any transport filters, so a filter on LEVEL would drop the
    // audit record.
    const logger = createLogger({
      consoleOptions: { silent: true },
      loggerOptions: { format: mapAuditLevelForOtel() },
      transports: [transport],
    })

    logger.audit('audit-event', { actor: 'a-1' })
    logger.info('info-event')
    logger.verbose('verbose-event')

    await transport.close!()

    expect(received.map((info) => info.message)).toEqual(['audit-event'])
  })

  it('forwards only the levels in onlyLevels', async () => {
    const received: TransformedInfo[] = []
    const transport = attachLevels(
      new CallbackTransport(
        async (info) => {
          received.push(info)
        },
        () => {},
        { onlyLevels: ['audit'] },
      ),
    )

    for (const level of ['error', 'warn', 'audit', 'info']) transport.log!(buildInfo(level, `${level}-event`), () => {})
    await transport.close!()

    expect(received.map((info) => info.message)).toEqual(['audit-event'])
  })

  it('forwards only audit records through createLogger with onlyLevels, so an error it logs is not sent back to it', async () => {
    const { createLogger } = await import('./index')
    const received: TransformedInfo[] = []
    const transport = new CallbackTransport(
      async (info) => {
        received.push(info)
      },
      (message, ...args) => logger.error(message, ...args),
      { onlyLevels: ['audit'] },
    )
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })

    logger.error('error-event')
    logger.audit('audit-event', { actor: 'a-1' })
    logger.info('info-event')
    await transport.close!()

    expect(received).toEqual([{ level: 'audit', message: 'audit-event', meta: { actor: 'a-1' } }])
  })

  it('stops waiting at closeTimeoutMs and reports the dispatches still running', async () => {
    const logError = vi.fn()
    const transport = new CallbackTransport(() => new Promise(() => {}), logError, { closeTimeoutMs: 20 })

    transport.log!(buildInfo('info', 'never-finishes'), () => {})
    await transport.close!()

    expect(logError).toHaveBeenCalledWith('CallbackTransport closed after 20 ms with 1 dispatch(es) still running')
  })

  it('reports nothing when dispatches finish within closeTimeoutMs', async () => {
    const logError = vi.fn()
    const transport = new CallbackTransport(() => Promise.resolve(), logError, { closeTimeoutMs: 1_000 })

    transport.log!(buildInfo('info', 'quick'), () => {})
    await transport.close!()

    expect(logError).not.toHaveBeenCalled()
  })
})
