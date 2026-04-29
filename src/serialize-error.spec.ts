import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createSerializableErrorReplacer, serializableErrorReplacer, serializeError } from './serialize-error'

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
})
