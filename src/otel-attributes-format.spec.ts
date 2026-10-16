import { TransformableInfo } from 'logform'
import { LEVEL } from 'triple-beam'
import { describe, expect, it } from 'vitest'
import { defaultOtelRedactKeys, otelAttributesFormat, OtelAttributesFormatOptions } from './otel-attributes-format'

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
  const at = (level: string, opts?: OtelAttributesFormatOptions) => run({ [LEVEL]: level, level }, opts)

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

  it('maps nothing with mapAuditLevel: false', () => {
    const result = at('audit', { mapAuditLevel: false })
    expect(result[LEVEL]).toBe('audit')
    expect(result).not.toHaveProperty('logLevel')
  })
})

/** An AI SDK `APICallError` as `serializeError` writes it. */
const apiCallError = (attempt: number) => ({
  name: 'AI_APICallError',
  message: `attempt ${attempt} failed`,
  stack: `AI_APICallError: attempt ${attempt} failed\n    at x`,
  statusCode: 429,
  requestBodyValues: { messages: [{ role: 'user', content: 'the whole prompt' }] },
  responseHeaders: { 'retry-after': '1', 'x-request-id': `req-${attempt}` },
  responseBody: '{"error":"rate limited"}',
})

/** An AI SDK `RetryError`: every attempt under `errors`, and the last once more under `lastError`. */
const retryError = () => ({
  name: 'AI_RetryError',
  message: 'Failed after 2 attempts',
  stack: 'AI_RetryError: Failed after 2 attempts\n    at x',
  reason: 'maxRetriesExceeded',
  errors: [apiCallError(1), apiCallError(2)],
  lastError: apiCallError(2),
})

describe('otelAttributesFormat — redaction', () => {
  it('redacts requestBodyValues in errorDetail', () => {
    const detail = JSON.parse(run({ error: apiCallError(1) }).errorDetail as string) as Record<string, unknown>
    expect(detail.requestBodyValues).toBe('<redacted>')
    expect(detail.statusCode).toBe(429)
  })

  it('redacts it inside every attempt of a retry', () => {
    const detail = JSON.parse(run({ error: retryError() }).errorDetail as string) as { errors: Record<string, unknown>[] }
    expect(detail.errors.map((attempt) => attempt.requestBodyValues)).toEqual(['<redacted>', '<redacted>'])
  })

  it('redacts it at the top of the record and nested in other values', () => {
    const result = run({ requestBodyValues: { prompt: 'p' }, ctx: { call: { requestBodyValues: 'p' } } })
    expect(result.requestBodyValues).toBe('<redacted>')
    expect(JSON.parse(result.ctx as string)).toEqual({ call: { requestBodyValues: '<redacted>' } })
  })

  it('leaves a nil value as it is', () => {
    expect(JSON.parse(run({ ctx: { requestBodyValues: null } }).ctx as string)).toEqual({ requestBodyValues: null })
  })

  it('redacts nothing with redactKeys: []', () => {
    const detail = JSON.parse(run({ error: apiCallError(1) }, { redactKeys: [] }).errorDetail as string) as Record<string, unknown>
    expect(detail.requestBodyValues).toEqual(apiCallError(1).requestBodyValues)
  })

  it('redacts added keys beside the defaults, with a custom redactedValue', () => {
    const result = run(
      { error: serialized({ prompt: 'p', requestBodyValues: 'v' }) },
      { redactKeys: [...defaultOtelRedactKeys, 'prompt'], redactedValue: '***' },
    )
    expect(JSON.parse(result.errorDetail as string)).toEqual({ prompt: '***', requestBodyValues: '***' })
  })

  it('runs before the replacer, which sees the redacted value', () => {
    const seen: unknown[] = []
    const replacer = (key: string, value: unknown) => {
      if (key === 'requestBodyValues') seen.push(value)
      return value
    }
    run({ ctx: { requestBodyValues: 'p' } }, { replacer })
    expect(seen).toEqual(['<redacted>'])
  })
})

describe('otelAttributesFormat — retry compaction', () => {
  it('drops responseHeaders from the error and from every attempt, and lastError beside errors', () => {
    const result = run({ error: retryError() })
    const detail = JSON.parse(result.errorDetail as string) as { errors: Record<string, unknown>[] }
    expect(detail).not.toHaveProperty('lastError')
    expect(detail.errors).toHaveLength(2)
    expect(detail.errors.every((attempt) => !('responseHeaders' in attempt))).toBe(true)
    expect(detail.errors[1].responseBody).toBe('{"error":"rate limited"}')
    expect(result.error).toEqual({ name: 'AI_RetryError', message: 'Failed after 2 attempts', stack: retryError().stack })
  })

  it('drops responseHeaders from an error logged on its own', () => {
    expect(JSON.parse(run({ error: apiCallError(1) }).errorDetail as string)).not.toHaveProperty('responseHeaders')
  })

  it('keeps lastError when there is no errors list to hold it', () => {
    const detail = JSON.parse(run({ error: serialized({ lastError: apiCallError(1), errors: [] }) }).errorDetail as string)
    expect(detail.lastError).toMatchObject({ message: 'attempt 1 failed' })
  })

  it("keeps a caller's own responseHeaders on a value that is not an error", () => {
    expect(JSON.parse(run({ response: { status: 200, responseHeaders: { etag: 'x' } } }).response as string)).toEqual({
      status: 200,
      responseHeaders: { etag: 'x' },
    })
  })

  it('keeps everything with compactErrors: false', () => {
    const detail = JSON.parse(run({ error: retryError() }, { compactErrors: false }).errorDetail as string) as Record<string, unknown>
    expect(detail).toHaveProperty('lastError')
    expect((detail.errors as Record<string, unknown>[])[0]).toHaveProperty('responseHeaders')
  })
})

describe('otelAttributesFormat — length cap', () => {
  const long = 'x'.repeat(20_000)

  it('cuts errorDetail to 8,192 characters, ending in [Truncated]', () => {
    const detail = run({ error: serialized({ body: long }) }).errorDetail as string
    expect(detail).toHaveLength(8192)
    expect(detail.endsWith('[Truncated]')).toBe(true)
  })

  it('cuts other stringified values too', () => {
    const value = run({ ctx: { body: long } }).ctx as string
    expect(value).toHaveLength(8192)
    expect(value.endsWith('[Truncated]')).toBe(true)
  })

  it('leaves strings the caller wrote, the message and the exception whole', () => {
    const result = run({ message: long, text: long, error: serialized({ message: long, stack: long }) })
    expect(result.message).toBe(long)
    expect(result.text).toBe(long)
    expect(result.error).toMatchObject({ message: long, stack: long })
  })

  it('honours a custom maxAttributeLength, and Infinity writes every string whole', () => {
    expect(run({ ctx: { body: long } }, { maxAttributeLength: 100 }).ctx).toHaveLength(100)
    expect(JSON.parse(run({ ctx: { body: long } }, { maxAttributeLength: Infinity }).ctx as string)).toEqual({ body: long })
  })

  it('does not split a surrogate pair', () => {
    const value = run({ ctx: { body: '😀'.repeat(100) } }, { maxAttributeLength: 30 }).ctx as string
    expect(value.endsWith('[Truncated]')).toBe(true)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(value)).toBe(false)
  })
})

describe('otelAttributesFormat — shared state', () => {
  it('changes no nested value, so a transport placement leaves its siblings their own objects', () => {
    const error = retryError()
    const ctx = { requestBodyValues: 'p', inner: { a: 1 } }
    const before = structuredClone({ error, ctx })
    run({ error, ctx })
    expect({ error, ctx }).toEqual(before)
  })

  it('applied twice writes the same record as applied once', () => {
    const fmt = otelAttributesFormat()
    const input = { [LEVEL]: 'audit', level: 'audit', message: 'm', error: retryError(), ctx: { a: 1 } } as unknown as TransformableInfo
    const once = fmt.transform(structuredClone(input), fmt.options) as TransformableInfo
    const onceCopy = { ...once }
    const twice = fmt.transform(once, fmt.options) as TransformableInfo
    expect(twice).toEqual(onceCopy)
    expect(twice[LEVEL]).toBe('info')
    expect(twice.logLevel).toBe('audit')
  })
})
