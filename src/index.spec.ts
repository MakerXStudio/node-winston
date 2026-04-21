import { format } from 'winston'
import TransportStream from 'winston-transport'
import { describe, expect, it } from 'vitest'
import { createLogger } from './index'

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

describe('createLogger audit level', () => {
  it('writes audit logs at the audit level', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })
    logger.audit('audit-event', { actor: 'user-1' })
    expect(transport.logs.length).toBe(1)
    expect(transport.logs[0].level).toBe('audit')
    expect(transport.logs[0].message).toBe('audit-event')
    expect((transport.logs[0] as { actor: string }).actor).toBe('user-1')
  })

  it('includes audit logs at info level and filters them at warn level', () => {
    const infoTransport = new InMemoryTransport({})
    const infoLogger = createLogger({
      consoleOptions: { silent: true },
      transports: [infoTransport],
      loggerOptions: { level: 'info' },
    })
    infoLogger.audit('included-at-info')

    const warnTransport = new InMemoryTransport({})
    const warnLogger = createLogger({
      consoleOptions: { silent: true },
      transports: [warnTransport],
      loggerOptions: { level: 'warn' },
    })
    warnLogger.audit('filtered-at-warn')

    expect(infoTransport.logs.map((l) => l.message)).toEqual(['included-at-info'])
    expect(warnTransport.logs.length).toBe(0)
  })
})

describe('createLogger custom levels', () => {
  it('exposes the custom level methods and omits the defaults from the type', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      loggerOptions: { levels: { fatal: 0, trace: 1 }, level: 'trace' },
    })
    logger.fatal('bang')
    logger.trace('tick')
    expect(transport.logs.map((l) => l.level)).toEqual(['fatal', 'trace'])
    // @ts-expect-error audit is not part of the custom level set
    logger.audit
  })
})

describe('createLogger error serialization', () => {
  it('serializes an Error passed as structured metadata', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })
    logger.info('boom', { error: new Error('cause') })
    const { error } = transport.logs[0] as { error: { name: string; message: string; stack: string } }
    expect(error.name).toBe('Error')
    expect(error.message).toBe('cause')
    expect(error.stack).toContain('Error: cause')
  })

  it('serializes errors nested inside objects and arrays', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })
    logger.info('nested', { ctx: { cause: new Error('deep') }, items: [{ err: new Error('in-array') }] })
    const info = transport.logs[0] as {
      ctx: { cause: { message: string } }
      items: [{ err: { message: string } }]
    }
    expect(info.ctx.cause.message).toBe('deep')
    expect(info.items[0].err.message).toBe('in-array')
  })
})

describe('createLogger omitPaths', () => {
  it('removes top-level and nested dot-path fields', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      omitPaths: ['service', 'user.password'],
    })
    logger.info('hello', { service: 'svc', user: { id: 1, password: 'secret' } })
    const info = transport.logs[0] as { service?: string; user: { id: number; password?: string } }
    expect(info.service).toBeUndefined()
    expect(info.user).toEqual({ id: 1 })
  })
})

describe('createLogger redactPaths', () => {
  it('redacts values at the given paths with the default value', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      redactPaths: ['authorization', 'user.email'],
    })
    logger.info('hello', { authorization: 'Bearer abc', user: { id: 1, email: 'x@y.z' } })
    const info = transport.logs[0] as { authorization: string; user: { id: number; email: string } }
    expect(info.authorization).toBe('<redacted>')
    expect(info.user.email).toBe('<redacted>')
    expect(info.user.id).toBe(1)
  })

  it('honours a custom redactedValue', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      redactPaths: ['token'],
      redactedValue: '***',
    })
    logger.info('hello', { token: 'abc' })
    expect((transport.logs[0] as { token: string }).token).toBe('***')
  })

  it('redacts matching keys inside arrays recursively', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      redactPaths: ['email'],
    })
    logger.info('hello', { users: [{ email: 'a@b.c' }, { email: 'd@e.f' }] })
    const info = transport.logs[0] as { users: { email: string }[] }
    expect(info.users.map((u) => u.email)).toEqual(['<redacted>', '<redacted>'])
  })
})

describe('createLogger child loggers', () => {
  it('merges metadata across chained .child() calls', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })
    const requestLogger = logger.child({ requestInfo: { id: 'req-1', path: '/items' } })
    const instanceLogger = requestLogger.child({ instanceInfo: { podId: 'pod-42' } })
    instanceLogger.info('handled')
    const info = transport.logs[0] as {
      message: string
      requestInfo: { id: string; path: string }
      instanceInfo: { podId: string }
    }
    expect(info.message).toBe('handled')
    expect(info.requestInfo).toEqual({ id: 'req-1', path: '/items' })
    expect(info.instanceInfo).toEqual({ podId: 'pod-42' })
  })
})

describe('createLogger flatten', () => {
  it('stringifies object and array values and leaves scalars alone', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      flatten: true,
    })
    logger.info('hello', { obj: { a: 1 }, arr: [1, 2], count: 3, flag: true, text: 'literal' })
    const info = transport.logs[0] as Record<string, unknown>
    expect(info.obj).toBe('{"a":1}')
    expect(info.arr).toBe('[1,2]')
    expect(info.count).toBe(3)
    expect(info.flag).toBe(true)
    expect(info.text).toBe('literal')
  })

  it('forwards flattenReplacer to JSON.stringify for each value', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      flatten: true,
      flattenReplacer: (key, value) => (key === 'secret' ? '<hidden>' : value),
    })
    logger.info('hello', { data: { secret: 'abc', other: 'def' } })
    const { data } = transport.logs[0] as { data: string }
    const parsed = JSON.parse(data) as { secret: string; other: string }
    expect(parsed.secret).toBe('<hidden>')
    expect(parsed.other).toBe('def')
  })

  it('runs after loggerOptions.format so injected object values are stringified', () => {
    const transport = new InMemoryTransport({})
    const injectFormat = format((info) => {
      info.injected = { a: 1 }
      return info
    })
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      flatten: true,
      loggerOptions: { format: injectFormat() },
    })
    logger.info('hello')
    expect((transport.logs[0] as { injected: unknown }).injected).toBe('{"a":1}')
  })
})

class InMemoryTransport extends TransportStream {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logs: Record<string, any>[]

  constructor(opts: TransportStream.TransportStreamOptions) {
    super(opts)
    this.logs = []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log(info: any, next: () => void): void {
    this.logs.push({ ...(info as Record<string, unknown>) })
    next()
  }

  close(): void {}
}
