import { type TransformableInfo } from 'logform'
import { LEVEL } from 'triple-beam'
import { describe, expect, it, vi } from 'vitest'
import { CallbackTransport } from './callback-transport'
import { type TransformedInfo } from './utils'

const buildInfo = (level: string, message: string, meta: Record<string, unknown> = {}): TransformableInfo =>
  ({ [LEVEL]: level, level, message, ...meta }) as TransformableInfo

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

  it('forwards winston-transport options to the base class', () => {
    const transport = new CallbackTransport(
      async () => {},
      () => {},
      { level: 'audit' },
    )
    expect(transport.level).toBe('audit')
  })
})
