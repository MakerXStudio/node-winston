import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createErrorSerializer, createSerializableErrorReplacer, serializableErrorReplacer, serializeError } from './serialize-error'

describe('serializeError', () => {
  it('message and stack are not enumerable (and not serialized) by default', () => {
    const { message, stack } = JSON.parse(JSON.stringify(new Error('message')))
    expect(message).toBeUndefined()
    expect(stack).toBeUndefined()
  })

  it('captures non-enumerable name, message, and stack on a plain Error', () => {
    const out = JSON.parse(JSON.stringify(serializeError(new Error('boom')))) as {
      name: string
      message: string
      stack: string
    }
    expect(out.name).toBe('Error')
    expect(out.message).toBe('boom')
    expect(out.stack).toBeDefined()
    expect(out.stack.split('\n').length).toBeGreaterThan(3)
  })

  it('preserves a custom subclass name and own enumerable properties', () => {
    class CustomError extends Error {
      readonly custom: string
      constructor(message: string, custom: string, options?: ErrorOptions) {
        super(message, options)
        this.name = 'CustomError'
        this.custom = custom
      }
    }
    const cause = new Error('cause message')
    const out = JSON.parse(JSON.stringify(serializeError(new CustomError('message', 'custom', { cause })))) as {
      name: string
      message: string
      stack: string
      custom: string
      cause: { name: string; message: string; stack: string }
    }
    expect(out.name).toBe('CustomError')
    expect(out.message).toBe('message')
    expect(out.custom).toBe('custom')
    expect(out.stack.split('\n').length).toBeGreaterThan(3)
    expect(out.cause.name).toBe('Error')
    expect(out.cause.message).toBe('cause message')
    expect(out.cause.stack.split('\n').length).toBeGreaterThan(3)
  })

  it('walks a multi-level cause chain', () => {
    const root = new Error('root')
    const middle = new Error('middle', { cause: root })
    const top = new Error('top', { cause: middle })
    const out = serializeError(top) as { message: string; cause: { message: string; cause: { message: string } } }
    expect(out.message).toBe('top')
    expect(out.cause.message).toBe('middle')
    expect(out.cause.cause.message).toBe('root')
  })

  it('captures AggregateError.errors with each entry serialised', () => {
    const aggregate = new AggregateError([new Error('first'), new Error('second')], 'multiple failures')
    const out = JSON.parse(JSON.stringify(serializeError(aggregate))) as {
      name: string
      message: string
      errors: { name: string; message: string }[]
    }
    expect(out.name).toBe('AggregateError')
    expect(out.message).toBe('multiple failures')
    expect(out.errors).toHaveLength(2)
    expect(out.errors[0].message).toBe('first')
    expect(out.errors[1].message).toBe('second')
  })

  it('renders cycles as [Circular] without throwing', () => {
    const a = new Error('a') as Error & { cause?: unknown }
    const b = new Error('b') as Error & { cause?: unknown }
    a.cause = b
    b.cause = a
    const out = serializeError(a) as { message: string; cause: { message: string; cause: string } }
    expect(out.message).toBe('a')
    expect(out.cause.message).toBe('b')
    expect(out.cause.cause).toBe('[Circular]')
  })

  it('renders self-referential errors as [Circular]', () => {
    const e = new Error('self') as Error & { self?: unknown }
    e.self = e
    const out = serializeError(e) as { message: string; self: string }
    expect(out.message).toBe('self')
    expect(out.self).toBe('[Circular]')
  })

  it('wraps a non-Error string throw as a NonError', () => {
    const out = serializeError('just a string' as unknown as Error)
    expect(out).toEqual({ name: 'NonError', message: 'just a string' })
  })

  it('wraps null and undefined as NonError without throwing', () => {
    expect(serializeError(null as unknown as Error)).toEqual({ name: 'NonError', message: 'null' })
    expect(serializeError(undefined as unknown as Error)).toEqual({ name: 'NonError', message: 'undefined' })
  })

  it('serialises BigInt properties as suffixed strings', () => {
    const e = Object.assign(new Error('big'), { count: 9007199254740993n })
    const out = serializeError(e) as { count: string }
    expect(out.count).toBe('9007199254740993n')
    expect(JSON.stringify(out)).toContain('"count":"9007199254740993n"')
  })

  it('renders Buffer-typed properties as a sentinel string', () => {
    const e = Object.assign(new Error('buf'), { body: Buffer.from('hello') })
    const out = serializeError(e) as { body: string }
    expect(out.body).toBe('[object Buffer]')
  })

  it('renders stream-like properties as a sentinel string', () => {
    const e = Object.assign(new Error('stream'), { source: Readable.from(['chunk']) })
    const out = serializeError(e) as { source: string }
    expect(out.source).toBe('[object Stream]')
  })

  it('skips properties whose getters throw', () => {
    const e = new Error('with throwing getter')
    Object.defineProperty(e, 'broken', {
      enumerable: true,
      get() {
        throw new Error('getter exploded')
      },
    })
    const out = serializeError(e) as Record<string, unknown>
    expect(out.message).toBe('with throwing getter')
    expect(out).not.toHaveProperty('broken')
  })

  it('truncates structures deeper than the configured maximum', () => {
    interface Nested {
      next?: Nested
    }
    const root: Nested = {}
    let cursor = root
    for (let i = 0; i < 20; i++) {
      cursor.next = {}
      cursor = cursor.next
    }
    const e = Object.assign(new Error('deep'), { tree: root })
    const out = serializeError(e) as { tree: Nested }

    const findTruncation = (node: unknown, depth = 0): number | null => {
      if (node === '[Truncated]') return depth
      if (!node || typeof node !== 'object') return null
      const next = (node as Nested).next
      return next === undefined ? null : findTruncation(next, depth + 1)
    }

    expect(findTruncation(out.tree)).not.toBeNull()
  })
})

describe('serializableErrorReplacer', () => {
  it('replaces nested Error values during JSON.stringify', () => {
    const out = JSON.parse(JSON.stringify({ nested: new Error('message') }, serializableErrorReplacer)) as {
      nested: { message: string; stack: string }
    }
    expect(out.nested.message).toBe('message')
    expect(out.nested.stack.split('\n').length).toBeGreaterThan(3)
  })
})

describe('createSerializableErrorReplacer', () => {
  it('uses the supplied serializer for Error values', () => {
    const replacer = createSerializableErrorReplacer(() => ({ marker: 'custom' }))
    const result = JSON.parse(JSON.stringify({ nested: new Error('message') }, replacer)) as { nested: { marker: string } }
    expect(result.nested.marker).toBe('custom')
  })

  it('writes a Date property as its ISO string, as JSON.stringify would, not as {}', () => {
    const error = Object.assign(new Error('boom'), { at: new Date('2026-01-02T03:04:05.000Z') })
    expect(serializeError(error).at).toBe('2026-01-02T03:04:05.000Z')
  })

  it('writes an invalid Date property as null rather than throwing', () => {
    const error = Object.assign(new Error('boom'), { at: new Date('not a date') })
    expect(serializeError(error).at).toBeNull()
  })

  it('writes a URL property as its href', () => {
    const error = Object.assign(new Error('boom'), { url: new URL('https://example.test/a?b=1') })
    expect(serializeError(error).url).toBe('https://example.test/a?b=1')
  })

  it("walks a value's own keys when its toJSON throws", () => {
    const awkward = {
      id: 7,
      toJSON: () => {
        throw new Error('no')
      },
    }
    expect(serializeError(Object.assign(new Error('boom'), { awkward })).awkward).toEqual({ id: 7 })
  })

  it('never asks an error for its toJSON, so an error that defines one is still captured whole', () => {
    class HttpClientError extends Error {
      readonly status = 502
      toJSON() {
        return { summary: 'trimmed' }
      }
    }
    const out = serializeError(new HttpClientError('bad gateway'))
    expect(out).toMatchObject({ message: 'bad gateway', status: 502 })
    expect(out.stack).toBeDefined()
    expect(out.summary).toBeUndefined()
  })
})

describe('createErrorSerializer', () => {
  /** An error with response headers as an own property, as an HTTP client's error might carry. */
  const httpError = (attempt: number) =>
    Object.assign(new Error(`attempt ${attempt} failed`), { statusCode: 429, headers: { 'x-request-id': `req-${attempt}` } })

  /** An error holding each attempt under `attempts`, and the latest one again under `latest`. */
  const retryError = () => {
    const attempts = [httpError(1), httpError(2)]
    return Object.assign(new Error('failed after 2 attempts'), { attempts, latest: attempts[1] })
  }

  it('with no options, writes what serializeError writes', () => {
    const error = Object.assign(new Error('plain'), { code: 'E_X', detail: { a: [1, 2] } })
    expect(createErrorSerializer()(error)).toEqual(serializeError(error))
  })

  it('omit leaves a property out of the error and of every error inside it', () => {
    const serializer = createErrorSerializer({ omit: (key) => key === 'headers' })
    const out = serializer(new Error('wrapped', { cause: retryError() })) as { cause: { attempts: object[]; latest: object } }
    expect(out.cause.attempts).toHaveLength(2)
    expect(out.cause.attempts.every((attempt) => !('headers' in attempt))).toBe(true)
    expect(out.cause.latest).not.toHaveProperty('headers')
    expect(out.cause.attempts[0]).toMatchObject({ message: 'attempt 1 failed', statusCode: 429 })
  })

  it('omit is given the error, so it can decide by its other properties', () => {
    const serializer = createErrorSerializer({ omit: (key, error) => key === 'latest' && 'attempts' in error })
    expect(serializer(retryError())).not.toHaveProperty('latest')
    expect(serializer(Object.assign(new Error('x'), { latest: httpError(1) }))).toHaveProperty('latest')
  })

  it('omit can leave out a well-known property', () => {
    expect(createErrorSerializer({ omit: (key) => key === 'stack' })(new Error('x'))).not.toHaveProperty('stack')
  })

  it('omit is called for a plain object with a string name, message and stack', () => {
    const serialized = { name: 'RemoteError', message: 'm', stack: 'RemoteError: m', headers: { a: '1' } }
    const out = createErrorSerializer({ omit: (key) => key === 'headers' })(Object.assign(new Error('x'), { remote: serialized }))
    expect(out.remote).toEqual({ name: 'RemoteError', message: 'm', stack: 'RemoteError: m' })
  })

  it('omit is never asked about any other plain object', () => {
    const asked: string[] = []
    const serializer = createErrorSerializer({
      omit: (key) => {
        asked.push(key)
        return false
      },
    })
    serializer(Object.assign(new Error('x'), { context: { headers: {} } }))
    expect(asked).not.toContain('headers')
    expect(asked).toContain('context')
  })

  it('omit that throws keeps the property', () => {
    const serializer = createErrorSerializer({
      omit: () => {
        throw new Error('bad predicate')
      },
    })
    expect(serializer(new Error('x'))).toMatchObject({ name: 'Error', message: 'x' })
  })

  it('dedupe writes a shared object once, and every later occurrence as [Duplicate]', () => {
    const out = createErrorSerializer({ dedupe: true })(retryError()) as { attempts: object[]; latest: unknown }
    expect(out.attempts[1]).toMatchObject({ message: 'attempt 2 failed' })
    expect(out.latest).toBe('[Duplicate]')
  })

  it('dedupe still writes a Date in full each time, and a cycle as [Circular]', () => {
    const at = new Date('2026-01-02T03:04:05.000Z')
    const error = Object.assign(new Error('x'), { first: at, second: at })
    Object.assign(error, { self: error })
    const out = createErrorSerializer({ dedupe: true })(error)
    expect(out).toMatchObject({ first: '2026-01-02T03:04:05.000Z', second: '2026-01-02T03:04:05.000Z', self: '[Circular]' })
  })

  it('without dedupe, writes a shared object every time', () => {
    const out = createErrorSerializer()(retryError()) as { latest: unknown }
    expect(out.latest).toMatchObject({ message: 'attempt 2 failed' })
  })

  it('shapes what a transport receives when passed to createLogger as errorSerializer', async () => {
    const { CallbackTransport, createLogger } = await import('./index')
    const received: Record<string, unknown>[] = []
    const transport = new CallbackTransport(
      async ({ meta }) => void received.push(meta),
      () => undefined,
    )
    const logger = createLogger({
      consoleOptions: { silent: true },
      errorSerializer: createErrorSerializer({ omit: (key) => key === 'headers', dedupe: true }),
      transports: [transport],
    })
    logger.error('request failed', { error: retryError() })
    await transport.close!()
    const error = received[0].error as { attempts: object[]; latest: unknown }
    expect(error.attempts[0]).not.toHaveProperty('headers')
    expect(error.latest).toBe('[Duplicate]')
  })
})
