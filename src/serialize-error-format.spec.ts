import { TransformableInfo } from 'logform'
import { LEVEL, SPLAT } from 'triple-beam'
import { describe, expect, it } from 'vitest'
import { serializeErrorFormat, SerializeErrorFormatOptions } from './serialize-error-format'

const run = (info: Record<string, unknown>, opts?: SerializeErrorFormatOptions) => {
  const input = { [LEVEL]: 'info', level: 'info', message: '', ...info } as TransformableInfo
  const fmt = serializeErrorFormat(opts)
  return fmt.transform(input, fmt.options) as Record<string, unknown>
}

describe('serializeErrorFormat', () => {
  it('serializes a top-level nested error', () => {
    const result = run({ error: new Error('boom') })
    const error = result.error as { name: string; message: string; stack: string }
    expect(error.name).toBe('Error')
    expect(error.message).toBe('boom')
    expect(error.stack).toBeDefined()
  })

  it('serializes errors nested inside objects and arrays', () => {
    const result = run({
      context: { cause: new Error('deep') },
      items: [{ err: new Error('in-array') }, 'plain'],
    })
    const cause = (result.context as { cause: { message: string } }).cause
    const arrErr = ((result.items as unknown[])[0] as { err: { message: string } }).err
    expect(cause.message).toBe('deep')
    expect(arrErr.message).toBe('in-array')
  })

  it('leaves non-error values untouched', () => {
    const result = run({ a: 1, b: 'two', c: { nested: true } })
    expect(result).toMatchObject({ a: 1, b: 'two', c: { nested: true } })
  })

  it('does not mutate nested caller objects or arrays', () => {
    const cause = new Error('deep')
    const arrErr = new Error('in-array')
    const ctx = { cause }
    const items = [{ err: arrErr }]
    run({ context: ctx, items })
    expect(ctx.cause).toBe(cause)
    expect(items[0].err).toBe(arrErr)
  })

  it('uses the supplied serializer instead of the default', () => {
    const result = run({ context: { cause: new Error('deep') } }, { serializer: (error) => ({ marker: 'custom', message: error.message }) })
    const cause = (result.context as { cause: { marker: string; message: string } }).cause
    expect(cause).toEqual({ marker: 'custom', message: 'deep' })
  })

  it('replaces nested circular references with [Circular]', () => {
    const ctx: Record<string, unknown> = { name: 'parent' }
    ctx.self = ctx
    const result = run({ ctx })
    const walked = result.ctx as { name: string; self: unknown }
    expect(walked.name).toBe('parent')
    expect(walked.self).toBe('[Circular]')
  })

  it('replaces a direct cycle on the info object with [Circular]', () => {
    const input = { [LEVEL]: 'info', level: 'info', message: '' } as TransformableInfo & { self?: unknown }
    input.self = input
    const fmt = serializeErrorFormat()
    const result = fmt.transform(input, fmt.options) as unknown as { self: unknown }
    expect(result.self).toBe('[Circular]')
  })

  it('serialises sibling references to the same object independently (no false positive)', () => {
    const shared = { value: 42 }
    const result = run({ a: shared, b: shared })
    expect(result.a).toEqual({ value: 42 })
    expect(result.b).toEqual({ value: 42 })
  })

  it('serialises errors held under the SPLAT symbol', () => {
    const error = new Error('boom')
    const input = { [LEVEL]: 'info', level: 'info', message: '', [SPLAT]: [{ error }] } as TransformableInfo
    const fmt = serializeErrorFormat()

    const result = fmt.transform(input, fmt.options) as unknown as Record<symbol, { error: { message: string } }[]>

    expect(result[SPLAT][0].error).not.toBeInstanceOf(Error)
    expect(result[SPLAT][0].error.message).toBe('boom')
  })

  it('leaves a SPLAT holding no errors alone', () => {
    const input = { [LEVEL]: 'info', level: 'info', message: '', [SPLAT]: ['a', 1] } as TransformableInfo
    const fmt = serializeErrorFormat()

    const result = fmt.transform(input, fmt.options) as unknown as Record<symbol, unknown[]>

    expect(result[SPLAT]).toEqual(['a', 1])
  })
  it('leaves non-error splat arguments as they are, so format.splat() can interpolate them', () => {
    const date = new Date('2020-01-02T03:04:05Z')
    const nested = { when: date, n: 1 }
    const input = { [LEVEL]: 'info', level: 'info', message: '', [SPLAT]: [date, nested] } as TransformableInfo
    const fmt = serializeErrorFormat()

    const result = fmt.transform(input, fmt.options) as unknown as Record<symbol, unknown[]>

    // Same references: rebuilt as plain records these hold no own enumerable keys, and `%j` would
    // render `{}` in place of the date.
    expect(result[SPLAT][0]).toBe(date)
    expect(result[SPLAT][1]).toBe(nested)
  })

  it('rebuilds only the splat branch that holds an error', () => {
    const untouched = { n: 1 }
    const input = {
      [LEVEL]: 'info',
      level: 'info',
      message: '',
      [SPLAT]: [untouched, { error: new Error('boom'), when: new Date('2020-01-02T03:04:05Z') }],
    } as TransformableInfo
    const fmt = serializeErrorFormat()

    const result = fmt.transform(input, fmt.options) as unknown as Record<symbol, Record<string, unknown>[]>

    expect(result[SPLAT][0]).toBe(untouched)
    expect(result[SPLAT][1].error).toMatchObject({ message: 'boom' })
    expect(result[SPLAT][1].when).toBeInstanceOf(Date)
  })
  it('replaces a record that is itself an error, keeping level and the routing symbols', () => {
    const error = Object.assign(new TypeError('boom'), { [LEVEL]: 'error', level: 'error' })
    const fmt = serializeErrorFormat()

    const result = fmt.transform(error as unknown as TransformableInfo, fmt.options) as unknown as Record<string | symbol, unknown>

    expect(result).not.toBeInstanceOf(Error)
    expect(result).toMatchObject({ name: 'TypeError', message: 'boom', level: 'error' })
    expect(result.stack).toBeDefined()
    expect(result[LEVEL]).toBe('error')
  })

  it('serialises a record that is itself an error with the configured serializer', () => {
    const error = Object.assign(new TypeError('boom'), { [LEVEL]: 'error', level: 'error' })
    const fmt = serializeErrorFormat({ serializer: (e: Error) => ({ kind: e.name }) })

    const result = fmt.transform(error as unknown as TransformableInfo, fmt.options) as unknown as Record<string | symbol, unknown>

    expect(result).toMatchObject({ kind: 'TypeError', level: 'error' })
    expect(result[LEVEL]).toBe('error')
  })

  it('leaves a plain info object that merely looks like a log record alone', () => {
    const result = run({ message: 'not an error', stack: 'a string' })
    expect(result).toMatchObject({ message: 'not an error', stack: 'a string' })
  })
})
