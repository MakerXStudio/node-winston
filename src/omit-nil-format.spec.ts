import { TransformableInfo } from 'logform'
import { LEVEL, MESSAGE } from 'triple-beam'
import { describe, expect, it } from 'vitest'
import { omitNilFormat } from './omit-nil-format'

const runOmitNil = (info: Record<string | symbol, unknown>) => {
  const transform = omitNilFormat()
  const input = { [LEVEL]: 'info', [MESSAGE]: 'msg', level: 'info', message: 'msg', ...info } as TransformableInfo
  return transform.transform(input, {}) as Record<string | symbol, unknown>
}

describe('omitNilFormat', () => {
  it('removes null and undefined values', () => {
    const result = runOmitNil({ a: 1, b: null, c: undefined, d: 'x' })

    expect(result).toMatchObject({ a: 1, d: 'x' })
    expect(result).not.toHaveProperty('b')
    expect(result).not.toHaveProperty('c')
  })

  it('keeps falsy-but-not-nil values', () => {
    const result = runOmitNil({ zero: 0, empty: '', no: false })

    expect(result).toMatchObject({ zero: 0, empty: '', no: false })
  })

  it('preserves the LEVEL and MESSAGE symbols (regression: pg error length splat)', () => {
    // pg errors carry a numeric `length` property; older es-toolkit/compat
    // omitBy treated this object as array-like and stripped triple-beam symbols,
    // breaking downstream colorize.
    const result = runOmitNil({ length: 4, name: 'error', code: '23505' })

    expect(result[LEVEL]).toBe('info')
    expect(result[MESSAGE]).toBe('msg')
    expect(result).toMatchObject({ length: 4, name: 'error', code: '23505' })
  })
})
