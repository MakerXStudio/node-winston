import { describe, expect, it } from 'vitest'
import { normalizeErrorArgs, withNormalizedErrorArgs } from './normalize-error-args'

describe('normalizeErrorArgs', () => {
  it('moves an error in the message position to `error`, keeping its message on the line', () => {
    const error = new TypeError('boom')

    expect(normalizeErrorArgs([error], 0)).toEqual(['boom', { error }])
  })

  it('merges with metadata already in place', () => {
    const error = new TypeError('boom')

    expect(normalizeErrorArgs([error, { requestId: 'x' }], 0)).toEqual(['boom', { requestId: 'x', error }])
  })

  it('moves an error in the metadata position to `error`, keeping the caller message', () => {
    const error = new TypeError('boom')

    expect(normalizeErrorArgs(['delivery failed', error], 0)).toEqual(['delivery failed', { error }])
  })

  it('reads the message from the given position, for `log(level, message, meta)`', () => {
    const error = new TypeError('boom')

    expect(normalizeErrorArgs(['error', error], 1)).toEqual(['error', 'boom', { error }])
    expect(normalizeErrorArgs(['error', 'delivery failed', error], 1)).toEqual(['error', 'delivery failed', { error }])
  })

  it('leaves a call holding no error alone, by reference', () => {
    const args = ['hello', { requestId: 'x' }]

    expect(normalizeErrorArgs(args, 0)).toBe(args)
  })

  it('leaves splat interpolation alone', () => {
    const args = ['hi %s, you are %d', 'there', 42]

    expect(normalizeErrorArgs(args, 0)).toBe(args)
  })

  it('leaves an error further along the arguments to the format', () => {
    // Past the metadata position it is a splat interpolation value, not metadata.
    const args = ['hi %j', { a: 1 }, new TypeError('boom')]

    expect(normalizeErrorArgs(args, 0)).toBe(args)
  })

  it('inserts rather than overwrites when the metadata position is not a plain object', () => {
    const error = new TypeError('boom')
    const second = new RangeError('other')

    expect(normalizeErrorArgs([error, second], 0)).toEqual(['boom', { error }, second])
    expect(normalizeErrorArgs([error, 'a splat value'], 0)).toEqual(['boom', { error }, 'a splat value'])
  })

  it('does not mutate the arguments it was given', () => {
    const error = new TypeError('boom')
    const meta = { requestId: 'x' }
    const args = [error, meta]

    normalizeErrorArgs(args, 0)

    expect(args).toEqual([error, meta])
    expect(meta).toEqual({ requestId: 'x' })
  })

  it('treats a DOMException as an error', () => {
    const error = new DOMException('the operation timed out', 'TimeoutError')

    expect(normalizeErrorArgs([error], 0)).toEqual(['the operation timed out', { error }])
  })

  it('handles an empty argument list', () => {
    const args: unknown[] = []

    expect(normalizeErrorArgs(args, 0)).toBe(args)
  })
})

describe('withNormalizedErrorArgs', () => {
  const spy = () => {
    const calls: unknown[][] = []
    return { calls, fn: (...args: unknown[]) => calls.push(args) }
  }

  it('normalises each level method and forwards `this`', () => {
    const error = new TypeError('boom')
    const receivers: unknown[] = []
    const calls: unknown[][] = []
    const logger = {
      marker: 'the logger',
      error(this: unknown, ...args: unknown[]) {
        receivers.push((this as { marker?: string } | undefined)?.marker)
        calls.push(args)
      },
    }
    withNormalizedErrorArgs(logger, ['error', 'info'])

    logger.error(error)

    expect(calls).toEqual([['boom', { error }]])
    expect(receivers).toEqual(['the logger'])
  })

  it('normalises the positional form of `log` but not the object form', () => {
    const error = new TypeError('boom')
    const log$ = spy()
    const logger = { log: log$.fn }
    withNormalizedErrorArgs(logger, [])

    logger.log('error', error)
    logger.log({ level: 'error', message: error })

    expect(log$.calls[0]).toEqual(['error', 'boom', { error }])
    expect(log$.calls[1]).toEqual([{ level: 'error', message: error }])
  })

  it('skips a level with no method on the logger', () => {
    const logger: Record<string, unknown> = {}

    expect(() => withNormalizedErrorArgs(logger, ['error'])).not.toThrow()
    expect(logger.error).toBeUndefined()
  })

  it('is inherited by an object created from the wrapped logger, as winston builds a child', () => {
    const error = new TypeError('boom')
    const receivers: unknown[] = []
    const calls: unknown[][] = []
    const parent = {
      from: 'parent',
      error(this: unknown, ...args: unknown[]) {
        receivers.push((this as { from?: string } | undefined)?.from)
        calls.push(args)
      },
    }
    withNormalizedErrorArgs(parent, ['error'])

    const child = Object.create(parent) as typeof parent
    child.from = 'child'
    child.error(error)

    // Normalised on the way through, and still writing as the child.
    expect(calls).toEqual([['boom', { error }]])
    expect(receivers).toEqual(['child'])
  })
})
