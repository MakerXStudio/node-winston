import { TransformableInfo } from 'logform'
import { LEVEL } from 'triple-beam'
import { describe, expect, it } from 'vitest'
import { redactFormat } from './redact-format'

const run = (info: Record<string, unknown>, opts: Record<string, unknown>) => {
  const input = { [LEVEL]: 'info', level: 'info', message: '', ...info } as TransformableInfo
  const fmt = redactFormat(opts)
  return fmt.transform(input, fmt.options) as unknown as Record<string, unknown>
}

describe('redactFormat', () => {
  it('redacts the given paths', () => {
    const result = run({ authorization: 'Bearer abc' }, { paths: ['authorization'] })
    expect(result.authorization).toBe('<redacted>')
  })

  it('honours a custom redactedValue', () => {
    const result = run({ token: 'abc' }, { paths: ['token'], redactedValue: '***' })
    expect(result.token).toBe('***')
  })

  // Composed on its own, without `serializeErrorFormat` ahead of it, this is the only thing
  // standing between a `DOMException` and a deep clone that cannot rebuild one.
  it('substitutes a DOMException with the supplied errorSerializer', () => {
    const result = run(
      { error: new DOMException('the operation timed out', 'TimeoutError') },
      { paths: ['authorization'], errorSerializer: (error: Error) => ({ kind: error.name }) },
    )
    expect(result.error).toEqual({ kind: 'TimeoutError' })
  })

  it('falls back to the library serializer when none is supplied', () => {
    const result = run({ error: new DOMException('the operation timed out', 'TimeoutError') }, { paths: ['authorization'] })
    expect(result.error).toMatchObject({ name: 'TimeoutError', message: 'the operation timed out' })
  })
})
