import { createLogger } from './index'
import TransportStream from 'winston-transport'
import { describe, it, expect } from 'vitest'

describe('logger', () => {
  it('verbose logs are screened out when level is debug', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ loggerOptions: { level: 'debug' }, transports: [transport] })
    logger.debug('test a')
    logger.verbose('test b')
    expect(transport.logs.length).toBe(1)
    expect(transport.logs[0].message).toBe('test a')
  })

  it('debug logs are not screened out when level is verbose', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ loggerOptions: { level: 'verbose' }, transports: [transport] })
    logger.debug('test a')
    logger.verbose('test b')
    expect(transport.logs.length).toBe(2)
    expect(transport.logs[0].message).toBe('test a')
    expect(transport.logs[1].message).toBe('test b')
  })
})

class InMemoryTransport extends TransportStream {
  logs: {
    level: string
    message: string
  }[]

  constructor(opts: TransportStream.TransportStreamOptions) {
    super(opts)
    this.logs = []
  }

  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  log(info: any, next: () => void): void {
    const { level, message } = info
    this.logs.push({ level, message })
    next()
  }

  close(): void {}
}
