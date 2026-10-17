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

describe('otelAttributesFormat — level', () => {
  const at = (level: string) => run({ [LEVEL]: level, level })

  it('exports an audit record at info severity and keeps the original on logLevel', () => {
    const result = at('audit')
    expect(result[LEVEL]).toBe('info')
    expect(result.level).toBe('audit')
    expect(result.logLevel).toBe('audit')
  })

  it('records logLevel on every other level and leaves its LEVEL alone', () => {
    const result = at('warn')
    expect(result[LEVEL]).toBe('warn')
    expect(result.logLevel).toBe('warn')
  })

  it('reads the level from LEVEL, so a colorized string level still maps', () => {
    const result = run({ [LEVEL]: 'audit', level: '\u001b[35maudit\u001b[39m' })
    expect(result[LEVEL]).toBe('info')
    expect(result.logLevel).toBe('audit')
  })

  it('keeps a string logLevel the record already has', () => {
    expect(run({ [LEVEL]: 'audit', level: 'audit', logLevel: 'custom' }).logLevel).toBe('custom')
  })
})

/** A serialized error holding other errors: a cause, a list of attempts, and the latest attempt again. */
const withAttempts = () => {
  const attempt = (n: number) => serialized({ message: `attempt ${n}`, headers: { 'x-request-id': `req-${n}` } })
  const attempts = [attempt(1), attempt(2)]
  return serialized({ cause: serialized({ message: 'root' }), attempts, latest: attempts[1] })
}

describe('otelAttributesFormat — replacer', () => {
  it('is called with the holding object as `this`, so it can leave a property out by its siblings', () => {
    function replacer(this: Record<string, unknown>, key: string, value: unknown) {
      if (key === 'headers') return undefined
      if (key === 'latest' && Array.isArray(this.attempts)) return undefined
      return value
    }
    const detail = JSON.parse(run({ error: withAttempts() }, { replacer }).errorDetail as string) as Record<string, unknown>
    expect(detail).not.toHaveProperty('latest')
    expect(detail.attempts).toEqual([
      { name: 'Error', message: 'attempt 1', stack: 'Error: boom\n    at x' },
      { name: 'Error', message: 'attempt 2', stack: 'Error: boom\n    at x' },
    ])
  })
})

describe('otelAttributesFormat — length cap', () => {
  const long = 'x'.repeat(20_000)

  it('writes every string whole by default', () => {
    expect(JSON.parse(run({ ctx: { body: long } }).ctx as string)).toEqual({ body: long })
    expect(JSON.parse(run({ error: serialized({ body: long }) }).errorDetail as string)).toEqual({ body: long })
  })

  it('cuts errorDetail to maxAttributeLength, ending in [Truncated]', () => {
    const detail = run({ error: serialized({ body: long }) }, { maxAttributeLength: 8192 }).errorDetail as string
    expect(detail).toHaveLength(8192)
    expect(detail.endsWith('[Truncated]')).toBe(true)
  })

  it('cuts other stringified values too', () => {
    const value = run({ ctx: { body: long } }, { maxAttributeLength: 100 }).ctx as string
    expect(value).toHaveLength(100)
    expect(value.endsWith('[Truncated]')).toBe(true)
  })

  it('leaves strings the caller wrote, the message and the exception whole', () => {
    const result = run({ message: long, text: long, error: serialized({ message: long, stack: long }) }, { maxAttributeLength: 100 })
    expect(result.message).toBe(long)
    expect(result.text).toBe(long)
    expect(result.error).toMatchObject({ message: long, stack: long })
  })

  // `{"body":"` is 9 characters and each emoji is 2, so at 31 the cut falls inside a pair and at 30
  // it falls between two pairs.
  it.each([30, 31])('does not split a surrogate pair at maxAttributeLength %i', (max) => {
    const value = run({ ctx: { body: '😀'.repeat(100) } }, { maxAttributeLength: max }).ctx as string
    expect(value.length).toBeLessThanOrEqual(max)
    expect(value.endsWith('[Truncated]')).toBe(true)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(value)).toBe(false)
  })

  it('writes as much of the marker as fits when maxAttributeLength is shorter than it', () => {
    expect(run({ ctx: { body: 'x'.repeat(100) } }, { maxAttributeLength: 5 }).ctx).toBe('[Trun')
  })

  it('cuts nothing when maxAttributeLength is negative or NaN', () => {
    expect(JSON.parse(run({ ctx: { body: 'x' } }, { maxAttributeLength: -1 }).ctx as string)).toEqual({ body: 'x' })
    expect(JSON.parse(run({ ctx: { body: 'x' } }, { maxAttributeLength: NaN }).ctx as string)).toEqual({ body: 'x' })
  })
})

describe('otelAttributesFormat — shared state', () => {
  it('changes no nested value, so other transports keep their own objects', () => {
    const error = withAttempts()
    const ctx = { inner: { a: 1 }, list: [{ b: 2 }] }
    const before = structuredClone({ error, ctx })
    run({ error, ctx })
    expect({ error, ctx }).toEqual(before)
  })

  it('applied twice writes the same record as applied once', () => {
    const fmt = otelAttributesFormat()
    const input = { [LEVEL]: 'audit', level: 'audit', message: 'm', error: withAttempts(), ctx: { a: 1 } } as unknown as TransformableInfo
    const once = fmt.transform(input, fmt.options) as TransformableInfo
    const onceCopy = { ...once }
    const twice = fmt.transform(once, fmt.options) as TransformableInfo
    expect(twice).toEqual(onceCopy)
    expect(twice[LEVEL]).toBe('info')
    expect(twice.logLevel).toBe('audit')
  })
})
