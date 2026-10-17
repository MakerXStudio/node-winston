import { LEVEL, SPLAT } from 'triple-beam'
import { config, format } from 'winston'
import TransportStream from 'winston-transport'
import { describe, expect, it } from 'vitest'
import {
  createErrorSerializer,
  createLogger,
  defaultLevelColors,
  defaultLevels,
  winstonDefaultLevelColors,
  winstonDefaultLevels,
} from './index'

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

describe('default level exports', () => {
  it('exports defaultLevels with the audit tier between warn and info', () => {
    expect(defaultLevels).toEqual({ error: 0, warn: 1, audit: 2, info: 3, debug: 4, verbose: 5 })
  })

  it('exports defaultLevelColors covering every default level', () => {
    expect(Object.keys(defaultLevelColors).sort()).toEqual(Object.keys(defaultLevels).sort())
  })

  it('exports winstonDefaultLevels matching winston.config.npm.levels', () => {
    expect(winstonDefaultLevels).toEqual(config.npm.levels)
  })

  it('exports winstonDefaultLevelColors matching winston.config.npm.colors', () => {
    expect(winstonDefaultLevelColors).toEqual(config.npm.colors)
  })
})

describe('createLogger with winstonDefaultLevels', () => {
  it('exposes winston npm methods (http/silly) and rejects audit at the type level', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      loggerOptions: { levels: winstonDefaultLevels, level: 'silly' },
    })
    logger.error('e')
    logger.warn('w')
    logger.info('i')
    logger.http('h')
    logger.verbose('v')
    logger.debug('d')
    logger.silly('s')
    expect(transport.logs.map((l) => l.level)).toEqual(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'])
    // @ts-expect-error audit is not part of the winston default level set
    logger.audit
  })

  it('orders winston levels with debug noisier than verbose (opposite of defaultLevels)', () => {
    const verboseTransport = new InMemoryTransport({})
    const verboseLogger = createLogger({
      consoleOptions: { silent: true },
      transports: [verboseTransport],
      loggerOptions: { levels: winstonDefaultLevels, level: 'verbose' },
    })
    verboseLogger.verbose('seen')
    verboseLogger.debug('filtered')
    expect(verboseTransport.logs.map((l) => l.message)).toEqual(['seen'])
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

describe('createLogger Date metadata', () => {
  const when = new Date('2026-01-02T03:04:05.000Z')

  it('a transport receives a Date in metadata as the Date itself', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })
    logger.info('db query', { parameters: [when, 1] })
    const { parameters } = transport.logs[0] as { parameters: unknown[] }
    expect(parameters[0]).toBe(when)
    expect(JSON.stringify(parameters)).toBe('["2026-01-02T03:04:05.000Z",1]')
  })

  it('otel writes a Date in metadata as its ISO string, unquoted', () => {
    const transport = new OpenTelemetryTransportV3({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport], otel: true })
    logger.info('db query', { parameters: [when, 1], at: when })
    const info = transport.logs[0] as Record<string, unknown>
    expect(info.parameters).toBe('["2026-01-02T03:04:05.000Z",1]')
    expect(info.at).toBe('2026-01-02T03:04:05.000Z')
  })

  it('a Date survives redaction beside a redacted key', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport], redactPaths: ['token'] })
    logger.info('grant', { token: 'secret', at: when })
    const info = transport.logs[0] as Record<string, unknown>
    expect(info.token).toBe('<redacted>')
    expect(info.at).toBeInstanceOf(Date)
    expect(JSON.stringify(info.at)).toBe('"2026-01-02T03:04:05.000Z"')
  })

  it('a Date logged beside an error is kept', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })
    logger.error('db query error', { parameters: [when], error: new Error('timeout') })
    const info = transport.logs[0] as { parameters: unknown[]; error: { message: string } }
    expect(info.parameters[0]).toBe(when)
    expect(info.error.message).toBe('timeout')
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

  it('redacts every array element using a [*] wildcard path', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      redactPaths: ['files[*].name'],
    })
    logger.info('hello', {
      files: [
        { name: 'a.txt', size: 1 },
        { name: 'b.txt', size: 2 },
      ],
      name: 'top',
    })
    const info = transport.logs[0] as { files: { name: string; size: number }[]; name: string }
    expect(info.files.map((f) => f.name)).toEqual(['<redacted>', '<redacted>'])
    expect(info.files.map((f) => f.size)).toEqual([1, 2])
    // Wildcard is path-scoped, so a top-level `name` is not touched.
    expect(info.name).toBe('top')
  })

  it('supports nested [*] wildcards and bare-array element redaction', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      redactPaths: ['users[*].addresses[*].zip', 'tags[*]'],
    })
    logger.info('hello', {
      users: [{ addresses: [{ zip: '1000' }, { zip: '2000' }] }, { addresses: [{ zip: '3000' }] }],
      tags: ['secret', 'public'],
    })
    const info = transport.logs[0] as {
      users: { addresses: { zip: string }[] }[]
      tags: string[]
    }
    expect(info.users[0].addresses.map((a) => a.zip)).toEqual(['<redacted>', '<redacted>'])
    expect(info.users[1].addresses[0].zip).toBe('<redacted>')
    expect(info.tags).toEqual(['<redacted>', '<redacted>'])
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

describe('createLogger otel', () => {
  it('gives the format to an OpenTelemetry transport and leaves other transports nested', () => {
    const otelTransport = new OpenTelemetryTransportV3({})
    const sibling = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [otelTransport, sibling], otel: true })
    logger.error('failed', { error: Object.assign(new Error('boom'), { statusCode: 500 }), obj: { a: 1 }, count: 3 })
    expect(otelTransport.logs[0]).toMatchObject({ obj: '{"a":1}', count: 3, error: { name: 'Error', message: 'boom' } })
    expect(JSON.parse(otelTransport.logs[0].errorDetail as string)).toEqual({ statusCode: 500 })
    expect(sibling.logs[0]).toMatchObject({ obj: { a: 1 }, error: { message: 'boom', statusCode: 500 } })
    expect(sibling.logs[0]).not.toHaveProperty('errorDetail')
  })

  it('leaves an OpenTelemetry transport that has its own format alone', () => {
    const own = format((info) => Object.assign(info, { shapedBy: 'own' }))
    const otelTransport = new OpenTelemetryTransportV3({ format: own() })
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [otelTransport], otel: true })
    logger.info('hello', { obj: { a: 1 } })
    expect(otelTransport.logs[0]).toMatchObject({ shapedBy: 'own', obj: { a: 1 } })
  })

  it('passes its options to the format, replacer included', () => {
    const transport = new OpenTelemetryTransportV3({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      otel: { replacer: (key, value: unknown) => (key === 'secret' ? '<hidden>' : value) },
    })
    logger.info('hello', { data: { secret: 'abc', other: 'def' } })
    const { data } = transport.logs[0] as { data: string }
    expect(JSON.parse(data)).toEqual({ secret: '<hidden>', other: 'def' })
  })

  it('shapes the record after the logger-level formats, redaction and loggerOptions.format included', () => {
    const transport = new OpenTelemetryTransportV3({})
    const inject = format((info) => Object.assign(info, { injected: { a: 1 } }))
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      otel: true,
      redactPaths: ['body'],
      loggerOptions: { format: inject() },
    })
    logger.error('failed', { error: Object.assign(new Error('boom'), { body: { prompt: 'secret' }, statusCode: 500 }) })
    expect(JSON.parse(transport.logs[0].errorDetail as string)).toEqual({ body: '<redacted>', statusCode: 500 })
    expect(transport.logs[0].injected).toBe('{"a":1}')
  })

  it('leaves out error properties with an errorSerializer from createErrorSerializer', () => {
    const transport = new OpenTelemetryTransportV3({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      otel: true,
      errorSerializer: createErrorSerializer({ omit: (key) => key === 'headers' }),
    })
    logger.error('failed', { error: Object.assign(new Error('boom'), { headers: { a: '1' }, statusCode: 500 }) })
    expect(JSON.parse(transport.logs[0].errorDetail as string)).toEqual({ statusCode: 500 })
  })

  it('leaves the OpenTelemetry transport nested without it', () => {
    const transport = new OpenTelemetryTransportV3({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })
    logger.info('hello', { obj: { a: 1 } })
    expect(transport.logs[0].obj).toEqual({ a: 1 })
  })
})

describe('createLogger otel audit level', () => {
  it('exports audit at info on the OpenTelemetry transport only, with logLevel audit', () => {
    const otelTransport = new OpenTelemetryTransportV3({})
    const sibling = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [otelTransport, sibling], otel: true })
    logger.audit('audit-event', { actor: 'user-1' })
    expect(otelTransport.logs[0]).toMatchObject({ level: 'audit', logLevel: 'audit', actor: 'user-1' })
    expect((otelTransport.logs[0] as Record<symbol, unknown>)[LEVEL]).toBe('info')
    expect((sibling.logs[0] as Record<symbol, unknown>)[LEVEL]).toBe('audit')
    expect(sibling.logs[0]).not.toHaveProperty('logLevel')
  })

  it('records logLevel on every other level and leaves its LEVEL alone', () => {
    const transport = new OpenTelemetryTransportV3({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport], otel: true })
    logger.warn('heads-up')
    expect(transport.logs[0].logLevel).toBe('warn')
    expect((transport.logs[0] as Record<symbol, unknown>)[LEVEL]).toBe('warn')
  })

  it('records logLevel and rewrites nothing for a logger whose own levels have no audit', () => {
    const transport = new OpenTelemetryTransportV3({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      otel: true,
      loggerOptions: { levels: { error: 0, info: 1, trace: 2 }, level: 'trace' },
    })
    logger.trace('trace-event')
    expect((transport.logs[0] as Record<symbol, unknown>)[LEVEL]).toBe('trace')
    expect(transport.logs[0].logLevel).toBe('trace')
  })

  it('maps audit after a loggerOptions.format that colorizes the string level', () => {
    const transport = new OpenTelemetryTransportV3({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      otel: true,
      loggerOptions: { format: format.colorize() },
    })
    logger.audit('audit-event')
    expect((transport.logs[0] as Record<symbol, unknown>)[LEVEL]).toBe('info')
    expect(transport.logs[0].logLevel).toBe('audit')
  })

  it('keeps audit records when the logger, the console or the OpenTelemetry transport is set to level audit', () => {
    const otelTransport = new OpenTelemetryTransportV3({ level: 'audit' })
    const other = new InMemoryTransport({ level: 'audit' })
    const logger = createLogger({
      consoleOptions: { silent: true, level: 'audit' },
      transports: [otelTransport, other],
      otel: true,
      loggerOptions: { level: 'audit' },
    })
    logger.audit('audit-event')
    logger.info('info-event')
    expect(otelTransport.logs.map((info) => info.message)).toEqual(['audit-event'])
    expect(otelTransport.logs[0].logLevel).toBe('audit')
    expect(other.logs.map((info) => info.message)).toEqual(['audit-event'])
  })
})

describe('createLogger removed 2.x options', () => {
  it.each([
    ['flatten', true],
    ['flatten', false],
    ['flattenReplacer', () => undefined],
    ['mapAuditLevelForOtel', true],
  ])('throws for %s, pointing to the migration guide', (key, value) => {
    const options = { consoleOptions: { silent: true }, [key]: value }
    expect(() => createLogger(options)).toThrow(/Migrating from v2/)
  })

  it('rejects them at compile time in an object literal', () => {
    expect(() =>
      // @ts-expect-error removed in 3.0
      createLogger({ consoleOptions: { silent: true }, flatten: 'otel' }),
    ).toThrow(/flatten/)
    expect(() =>
      // @ts-expect-error removed in 3.0
      createLogger({ consoleOptions: { silent: true }, mapAuditLevelForOtel: true }),
    ).toThrow(/mapAuditLevelForOtel/)
  })
})

describe('createLogger error as the whole record', () => {
  // `logger.error(err)` makes the error the record. `message`, `stack` and `name` are not own
  // enumerable properties, so a transport that spreads or enumerates it used to receive neither
  // a message nor a stack.
  it('gives a transport the message and the error detail', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })

    logger.error(Object.assign(new TypeError('boom'), { code: 'E_BOOM' }) as unknown as string)

    expect(transport.logs[0]).toMatchObject({ message: 'boom', level: 'error' })
    expect(transport.logs[0].error).toMatchObject({ name: 'TypeError', message: 'boom', code: 'E_BOOM' })
    expect(transport.logs[0].error.stack).toContain('TypeError: boom')
    // The error's own properties stay with the error rather than being spread across the record.
    expect(transport.logs[0].code).toBeUndefined()
  })

  it('leaves the error instance unmutated, so its name and stack header survive', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      loggerOptions: { defaultMeta: { name: 'my-service' } },
    })
    const error = new TypeError('boom')

    logger.error(error as unknown as string)

    // `defaultMeta` used to be assigned onto the error itself, and V8 formats `stack` lazily, so a
    // colliding key rewrote the header to `my-service: boom` and took the error's name with it.
    expect(transport.logs[0].name).toBe('my-service')
    expect(transport.logs[0].error).toMatchObject({ name: 'TypeError', message: 'boom' })
    expect(transport.logs[0].error.stack).toContain('TypeError: boom')
    expect(Object.keys(error)).toEqual([])
  })

  // Winston decides between making the error the record and wrapping it as `{ message: err }` purely
  // on whether the message is truthy, so an empty one used to reach transports as an object under
  // `message` — `[object Object]` in the pretty console.
  it('gives a transport the same shape when the error has an empty message', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })

    logger.error(new Error('') as unknown as string)
    logger.error(new AggregateError([new Error('inner')]) as unknown as string)

    expect(transport.logs[0]).toMatchObject({ message: '', error: { name: 'Error', message: '' } })
    expect(transport.logs[0].error.stack).toContain('Error')
    expect(transport.logs[1]).toMatchObject({ message: '', error: { name: 'AggregateError' } })
    expect(transport.logs[1].error.errors[0]).toMatchObject({ name: 'Error', message: 'inner' })
  })

  // `defaultMeta` is assigned onto the record before any format runs, and in this branch the record
  // is the error, so a flat shape had the two `name`s fight over one key.
  it('keeps defaultMeta and the error detail side by side', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      loggerOptions: { defaultMeta: { name: 'my-service' } },
    })

    logger.error(new Error('') as unknown as string)

    expect(transport.logs[0].name).toBe('my-service')
    expect(transport.logs[0].error).toMatchObject({ name: 'Error' })
  })

  it('still routes at the right level', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      loggerOptions: { level: 'warn' },
    })

    logger.error(new TypeError('kept') as unknown as string)
    logger.info(new TypeError('filtered out') as unknown as string)

    expect(transport.logs.map((l) => l.message)).toEqual(['kept'])
  })

  it('leaves a plain info object alone', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })

    logger.log({ level: 'info', message: 'plain', stack: 'a string' })

    expect(transport.logs[0]).toMatchObject({ message: 'plain', stack: 'a string' })
  })
})

describe('createLogger error argument shapes', () => {
  // Winston branches three ways on an `Error` argument and produces three unrelated records. The
  // arguments are normalised on the way in so it only ever sees the one shape that needs no repair.
  const logged = (log: (logger: ReturnType<typeof createLogger>) => void) => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })
    log(logger)
    return transport.logs
  }

  it('puts the error under `error` however it was passed', () => {
    const detail = { name: 'TypeError', message: 'boom' }

    expect(logged((l) => l.error(new TypeError('boom') as unknown as string))[0]).toMatchObject({ message: 'boom', error: detail })
    expect(logged((l) => l.error('failed', new TypeError('boom')))[0]).toMatchObject({ message: 'failed', error: detail })
    expect(logged((l) => l.error('failed', { error: new TypeError('boom') }))[0]).toMatchObject({ message: 'failed', error: detail })
    expect(logged((l) => l.error(new TypeError('') as unknown as string))[0]).toMatchObject({ message: '', error: { name: 'TypeError' } })
  })

  it('keeps metadata passed alongside an error', () => {
    const logs = logged((l) => l.error(new TypeError('boom') as unknown as string, { requestId: 'x' }))

    expect(logs[0]).toMatchObject({ message: 'boom', requestId: 'x', error: { name: 'TypeError' } })
  })

  it('normalises `log(level, message, error)` too', () => {
    const logs = logged((l) => l.log('error', 'failed', new TypeError('boom')))

    expect(logs[0]).toMatchObject({ message: 'failed', error: { name: 'TypeError', message: 'boom' } })
  })

  it('nests an error given to the object form of `log`, via the format', () => {
    const logs = logged((l) => l.log({ level: 'error', message: new TypeError('boom') as unknown as string }))

    expect(logs[0]).toMatchObject({ message: 'boom', error: { name: 'TypeError' } })
  })

  it('normalises a child logger', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })

    logger.child({ requestId: 'x' }).error(new TypeError('boom') as unknown as string)

    expect(transport.logs[0]).toMatchObject({ requestId: 'x', message: 'boom', error: { name: 'TypeError' } })
  })

  it('leaves the error in the splat position when the message holds a format token', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })

    logger.error('failed: %s', new TypeError('boom'))

    // The error was passed as an interpolation value, so it stays one — serialised where it lies
    // rather than moved to `error`, which is what `format.splat()` needs to find there.
    expect(transport.logs[0].message).toBe('failed: %s')
    expect(transport.logs[0].error).toBeUndefined()
    const splat = (transport.logs[0] as unknown as Record<symbol, unknown>)[SPLAT] as { name: string; message: string }[]
    expect(splat[0]).toMatchObject({ name: 'TypeError', message: 'boom' })
    expect(splat[0]).not.toBeInstanceOf(Error)
  })

  it('nests an error whose own message holds a format token', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport] })

    logger.error(new TypeError('bad format: %s') as unknown as string)

    expect(transport.logs[0]).toMatchObject({
      message: 'bad format: %s',
      error: { name: 'TypeError', message: 'bad format: %s' },
    })
  })

  it('leaves a call with no error untouched, splat interpolation included', () => {
    const logs = logged((l) => {
      l.info('hi %s', 'there')
      l.info('plain', { requestId: 'x' })
    })

    expect(logs[0]).toMatchObject({ message: 'hi %s' })
    expect(logs[0].error).toBeUndefined()
    expect(logs[1]).toMatchObject({ message: 'plain', requestId: 'x' })
    expect(logs[1].error).toBeUndefined()
  })
})

describe('createLogger DOMException', () => {
  // An operation cancelled through an `AbortSignal` rejects with a `DOMException`, whose `message` and `name` are
  // getter-only prototype accessors. A deep clone cannot rebuild one, so redaction used to throw a
  // TypeError out of the log call itself, costing the caller the log line and everything after it.
  const aborted = () => new DOMException('the operation timed out', 'TimeoutError')

  it('logs one held in metadata, at any depth', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      redactPaths: ['authorization'],
    })

    logger.error('flat', { error: aborted() })
    logger.error('nested', { context: { error: aborted() } })
    logger.error('in an array', { errors: [aborted()] })

    expect(transport.logs.length).toBe(3)
    expect(transport.logs[0].error).toMatchObject({ name: 'TimeoutError', message: 'the operation timed out' })
    expect(transport.logs[0].error.stack).toBeDefined()
    expect(transport.logs[1].context.error).toMatchObject({ name: 'TimeoutError' })
    expect(transport.logs[2].errors[0]).toMatchObject({ name: 'TimeoutError' })
  })

  // A separate winston code path: with a message and a non-plain second argument it lifts
  // `message`, `stack` and `cause` onto a fresh info object and keeps the raw error under `SPLAT`,
  // which is where the clone used to find it.
  it('logs one passed as the second argument', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      redactPaths: ['authorization'],
    })

    logger.error('delivery failed', aborted() as unknown as string)

    // Winston would have concatenated the two messages and copied `stack` up; normalising the
    // arguments keeps the caller's message and puts the error where every other call shape has it.
    expect(transport.logs[0].message).toBe('delivery failed')
    expect(transport.logs[0].stack).toBeUndefined()
    expect(transport.logs[0].error).toMatchObject({ name: 'TimeoutError', message: 'the operation timed out' })
    expect(transport.logs[0].error.stack).toContain('TimeoutError')
  })

  it('logs one passed as the whole record', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      redactPaths: ['authorization'],
    })

    logger.error(aborted() as unknown as string)

    expect(transport.logs[0]).toMatchObject({
      message: 'the operation timed out',
      error: { name: 'TimeoutError', message: 'the operation timed out' },
    })
  })

  it('logs one with every logger-level format enabled', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      omitPaths: ['service'],
      redactPaths: ['authorization'],
      otel: true,
    })

    logger.error('everything on', { service: 'svc', authorization: 'Bearer abc', error: aborted() })

    expect(transport.logs[0].service).toBeUndefined()
    expect(transport.logs[0].authorization).toBe('<redacted>')
    expect(transport.logs[0].error).toMatchObject({ name: 'TimeoutError', message: 'the operation timed out' })
  })

  it('serialises one with a configured errorSerializer, wherever it sits in the record', () => {
    const transport = new InMemoryTransport({})
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [transport],
      redactPaths: ['authorization'],
      errorSerializer: (error) => ({ kind: error.name, detail: error.message }),
    })

    logger.error('nested', { error: aborted() })
    logger.error(aborted() as unknown as string)

    expect(transport.logs[0].error).toEqual({ kind: 'TimeoutError', detail: 'the operation timed out' })
    // Whichever way it was logged, the error detail is in the same place, in the same shape.
    expect(transport.logs[1].error).toEqual(transport.logs[0].error)
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

/** Named as `@opentelemetry/winston-transport`'s class is, which is how `otel` finds the transport. */
class OpenTelemetryTransportV3 extends InMemoryTransport {}
