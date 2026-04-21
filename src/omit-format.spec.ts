import { TransformableInfo } from 'logform'
import { LEVEL } from 'triple-beam'
import { describe, expect, it } from 'vitest'
import { omitFormat } from './omit-format'

const runOmit = (paths: string[], info: Record<string, unknown>) => {
  const opts = { paths }
  const input = { [LEVEL]: 'info', level: 'info', message: '', ...info } as TransformableInfo
  return omitFormat(opts).transform(input, opts) as Record<string, unknown>
}

describe('omitFormat', () => {
  it('removes top-level keys', () => {
    const result = runOmit(['password'], { message: 'hello', password: 'secret' })

    expect(result).not.toHaveProperty('password')
    expect(result).toHaveProperty('message', 'hello')
  })

  it('removes nested values via dot-notation paths', () => {
    const result = runOmit(['user.credentials.token', 'auth.refreshToken'], {
      message: 'authenticated',
      user: {
        id: 42,
        credentials: { token: 'abc123', scheme: 'bearer' },
      },
      auth: {
        refreshToken: 'xyz789',
        issuer: 'example',
      },
    })

    expect(result.user).toEqual({ id: 42, credentials: { scheme: 'bearer' } })
    expect(result.auth).toEqual({ issuer: 'example' })
  })

  it('is a no-op for paths that do not exist', () => {
    const result = runOmit(['user.missing.deeply.nested'], { user: { id: 1 } })

    expect(result.user).toEqual({ id: 1 })
  })
})
