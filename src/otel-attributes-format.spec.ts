import { TransformableInfo } from 'logform'
import { LEVEL } from 'triple-beam'
import { describe, expect, it } from 'vitest'
import { otelAttributesFormat, OtelAttributesFormatOptions } from './otel-attributes-format'

const run = (info: Record<string, unknown>, opts?: OtelAttributesFormatOptions) => {
  const input = { [LEVEL]: 'error', level: 'error', message: 'failed', ...info } as TransformableInfo
  const fmt = otelAttributesFormat(opts)
  return fmt.transform(input, fmt.options) as unknown as Record<string | symbol, unknown>
}

const serialized = (fields: Record<string, unknown> = {}) => ({ name: 'Error', message: 'boom', stack: 'Error: boom\n    at x', ...fields })

describe('otelAttributesFormat — the error', () => {
  it('keeps name, message and stack on `error` for the transport to record as the exception', () => {
    expect(run({ error: serialized() }).error).toEqual(serialized())
  })

  it('moves every other field of the error to errorDetail as JSON', () => {
    const result = run({ error: serialized({ statusCode: 413, data: { code: 'too_large' } }) })
    expect(result.error).toEqual(serialized())
    expect(JSON.parse(result.errorDetail as string)).toEqual({ statusCode: 413, data: { code: 'too_large' } })
  })

  it('writes no errorDetail when the error has nothing beyond name, message and stack', () => {
    expect(run({ error: serialized() })).not.toHaveProperty('errorDetail')
  })

  it('moves `code` to errorDetail so the SDK takes `name`, not `code`, as exception.type', () => {
    const result = run({ error: serialized({ code: 'ECONNREFUSED' }) })
    expect(result.error).not.toHaveProperty('code')
    expect(JSON.parse(result.errorDetail as string)).toEqual({ code: 'ECONNREFUSED' })
  })

  it('keeps `code` on an error with no name, where it is the only type there is', () => {
    expect(run({ error: { code: 'ECONNRESET', message: 'socket hang up' } }).error).toEqual({
      code: 'ECONNRESET',
      message: 'socket hang up',
    })
  })

  it('keeps a cause with a message on the error, and the whole cause chain under errorDetail', () => {
    const cause = { name: 'Error', message: 'middle', cause: { name: 'Error', message: 'inner' } }
    const result = run({ error: serialized({ cause }) })
    expect(result.error).toEqual(serialized({ cause }))
    expect(JSON.parse(result.errorDetail as string)).toEqual({ cause })
  })

  it('leaves a cause with nothing to describe off the error, where the transport would write [object Object]', () => {
    const cause = { type: 'error', sequence_number: 3 }
    const result = run({ error: serialized({ cause }) })
    expect(result.error).toEqual(serialized())
    expect(JSON.parse(result.errorDetail as string)).toEqual({ cause })
  })

  it('serializes a raw Error first when used without serializeErrorFormat', () => {
    const result = run({ error: Object.assign(new Error('raw'), { statusCode: 500 }) })
    expect(result.error).toMatchObject({ name: 'Error', message: 'raw' })
    expect(JSON.parse(result.errorDetail as string)).toEqual({ statusCode: 500 })
  })

  it('treats `err` as the exception when both are present, as the transport does, and stringifies `error`', () => {
    const result = run({ err: serialized({ statusCode: 1 }), error: serialized() })
    expect(result.err).toEqual(serialized())
    expect(JSON.parse(result.errDetail as string)).toEqual({ statusCode: 1 })
    expect(typeof result.error).toBe('string')
  })

  it('leaves a string error alone, which the transport records as exception.message', () => {
    expect(run({ error: 'timed out' }).error).toBe('timed out')
  })
})

describe('otelAttributesFormat — other values', () => {
  it('stringifies objects and arrays and leaves scalars alone', () => {
    const result = run({ obj: { a: 1 }, arr: [1, 2], count: 3, flag: true, text: 'literal', none: null })
    expect(result).toMatchObject({ obj: '{"a":1}', arr: '[1,2]', count: 3, flag: true, text: 'literal', none: null })
  })

  it('writes a Date as its ISO string, unquoted', () => {
    expect(run({ at: new Date('2026-01-02T03:04:05.000Z') }).at).toBe('2026-01-02T03:04:05.000Z')
  })

  it('serializes an error nested inside another value rather than writing {}', () => {
    const result = run({ ctx: { failure: new Error('deep') } })
    expect(JSON.parse(result.ctx as string)).toMatchObject({ failure: { name: 'Error', message: 'deep' } })
  })

  it('writes a BigInt as <n>n rather than throwing out of the log call', () => {
    expect(run({ ids: [10n] }).ids).toBe('["10n"]')
  })

  it('applies the replacer to stringified values and to errorDetail', () => {
    const replacer = (key: string, value: unknown) => (key === 'secret' ? '<hidden>' : value)
    const result = run({ data: { secret: 'a', other: 'b' }, error: serialized({ secret: 'c' }) }, { replacer })
    expect(JSON.parse(result.data as string)).toEqual({ secret: '<hidden>', other: 'b' })
    expect(JSON.parse(result.errorDetail as string)).toEqual({ secret: '<hidden>' })
  })

  it('keeps the routing symbols, so the record still reaches its transports', () => {
    expect(run({ obj: { a: 1 } })[LEVEL]).toBe('error')
  })
})
