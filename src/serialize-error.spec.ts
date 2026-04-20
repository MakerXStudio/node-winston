import { describe, expect, it } from 'vitest'
import { createSerializableErrorReplacer, serializableErrorReplacer, serializeError } from './serialize-error'

describe('serializeError', () => {
  it('message and stack are not enumerable (and not serialized) by default', () => {
    const { message, stack } = JSON.parse(JSON.stringify(new Error('message')))
    expect(message).toBeUndefined()
    expect(stack).toBeUndefined()
  })
  it('can serialize error message and stack props', () => {
    const { message, stack } = JSON.parse(JSON.stringify(serializeError(new Error('message')))) as { message: string; stack: string }
    expect(message).toMatchInlineSnapshot(`"message"`)
    expect(stack).toBeDefined()
    expect(stack.split('\n').length).toBeGreaterThan(3)
  })
  it('can serialize a custom error with a cause', () => {
    class CustomError extends Error {
      readonly custom: string
      constructor(message: string, custom: string, options?: ErrorOptions) {
        super(message, options)
        this.custom = custom
      }
    }
    const cause = new Error('cause message')
    const {
      message,
      stack,
      custom,
      cause: serializedCause,
    } = JSON.parse(JSON.stringify(serializeError(new CustomError('message', 'custom', { cause })))) as {
      message: string
      stack: string
      custom: string
      cause: { name: string; message: string; stack: string }
    }
    expect(message).toMatchInlineSnapshot(`"message"`)
    expect(custom).toMatchInlineSnapshot(`"custom"`)
    expect(stack).toBeDefined()
    expect(stack.split('\n').length).toBeGreaterThan(3)
    expect(serializedCause.name).toMatchInlineSnapshot(`"Error"`)
    expect(serializedCause.message).toMatchInlineSnapshot(`"cause message"`)
    expect(serializedCause.stack).toBeDefined()
    expect(serializedCause.stack.split('\n').length).toBeGreaterThan(3)
  })
})

describe('serializableErrorReplacer', () => {
  it('can serialize a nested error', () => {
    const {
      nested: { message, stack },
    } = JSON.parse(JSON.stringify({ nested: new Error('message') }, serializableErrorReplacer)) as {
      nested: {
        message: string
        stack: string
      }
    }
    expect(message).toMatchInlineSnapshot(`"message"`)
    expect(stack).toBeDefined()
    expect(stack.split('\n').length).toBeGreaterThan(3)
  })
})

describe('createSerializableErrorReplacer', () => {
  it('uses the supplied serializer for Error values', () => {
    const replacer = createSerializableErrorReplacer(() => ({ marker: 'custom' }))
    const result = JSON.parse(JSON.stringify({ nested: new Error('message') }, replacer)) as { nested: { marker: string } }
    expect(result.nested.marker).toBe('custom')
  })
})
