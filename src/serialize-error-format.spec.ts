import { TransformableInfo } from 'logform'
import { LEVEL } from 'triple-beam'
import { describe, expect, it } from 'vitest'
import { serializeErrorFormat } from './serialize-error-format'

const run = (info: Record<string, unknown>) => {
  const input = { [LEVEL]: 'info', level: 'info', message: '', ...info } as TransformableInfo
  return serializeErrorFormat().transform(input, {}) as Record<string, unknown>
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
})
