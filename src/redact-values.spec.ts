import { LEVEL } from 'triple-beam'
import { describe, expect, it } from 'vitest'
import { redactValues, redactValuesWith } from './redact-values'

describe('redactValues', () => {
  it('clones a DOMException instead of failing on its getter-only properties', () => {
    const aborted = new DOMException('the operation timed out', 'TimeoutError')

    const result = redactValues({ error: aborted }, 'authorization') as { error: Record<string, unknown> }

    expect(result.error).toMatchObject({
      name: 'TimeoutError',
      message: 'the operation timed out',
      stack: aborted.stack,
    })
  })

  it('redacts inside a DOMException', () => {
    const aborted = Object.assign(new DOMException('the operation timed out', 'TimeoutError'), {
      authorization: 'Bearer secret',
    })

    const result = redactValues({ error: aborted }, 'authorization') as { error: Record<string, unknown> }

    expect(result.error.authorization).toBe('<redacted>')
    expect(aborted.authorization).toBe('Bearer secret')
  })

  it('keeps the symbol properties of a DOMException logged as the whole record', () => {
    const info = Object.assign(new DOMException('the operation timed out', 'TimeoutError'), {
      [LEVEL]: 'error',
      level: 'error',
    })

    const result = redactValues(info, 'authorization') as Record<string | symbol, unknown>

    expect(result).toMatchObject({ name: 'TimeoutError', message: 'the operation timed out', level: 'error' })
    expect(result[LEVEL]).toBe('error')
  })
  it('substitutes a DOMException with the supplied serializer', () => {
    const aborted = new DOMException('the operation timed out', 'TimeoutError')
    const redact = redactValuesWith('<redacted>', (error) => ({ kind: error.name, detail: error.message }))

    const result = redact({ error: aborted }, 'authorization') as { error: Record<string, unknown> }

    expect(result.error).toEqual({ kind: 'TimeoutError', detail: 'the operation timed out' })
  })
  it('does not mutate the record a custom serializer returns', () => {
    const record = Object.assign(new DOMException('the operation timed out', 'TimeoutError'), {
      [LEVEL]: 'error',
      level: 'error',
    })
    const redact = redactValuesWith('<redacted>', (error) => Object.freeze({ kind: error.name }))

    const result = redact(record, 'authorization') as Record<string | symbol, unknown>

    expect(result).toMatchObject({ kind: 'TimeoutError' })
    expect(result[LEVEL]).toBe('error')
  })
  it('does not write into the nested values a serializer returns', () => {
    const cached = { context: { authorization: 'secret' } }
    const redact = redactValuesWith('<redacted>', () => cached)

    const result = redact({ error: new DOMException('t', 'TimeoutError') }, 'authorization') as {
      error: { context: { authorization: string } }
    }

    expect(result.error.context.authorization).toBe('<redacted>')
    expect(cached.context.authorization).toBe('secret')
  })

  it('substitutes a serializer that returns the error it was given', () => {
    const aborted = new DOMException('the operation timed out', 'TimeoutError')
    const redact = redactValuesWith('<redacted>', (error) => ({ kind: error.name, original: error }))

    const result = redact({ error: aborted }, 'authorization') as { error: Record<string, unknown> }

    expect(result.error.kind).toBe('TimeoutError')
    expect(result.error.original).toBe(result.error)
  })
  it('redacts a cyclic record instead of overflowing the stack', () => {
    const cyclic: Record<string, unknown> = { authorization: 'secret' }
    cyclic.self = cyclic

    const result = redactValues({ a: cyclic }, 'authorization') as { a: Record<string, unknown> }

    expect(result.a.authorization).toBe('<redacted>')
    expect(result.a.self).toBe(result.a)
    expect(cyclic.authorization).toBe('secret')
  })
})
