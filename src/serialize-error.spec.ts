import { serializableErrorReplacer, serializeError } from './serialize-error'
import { EOL } from 'os'

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
    expect(stack.split(EOL).length).toBeGreaterThan(3)
  })
  it('can serialize a custom error', () => {
    class CustomError extends Error {
      readonly custom: string
      constructor(message: string, custom: string) {
        super(message)
        this.custom = custom
      }
    }
    const { message, stack, custom } = JSON.parse(JSON.stringify(serializeError(new CustomError('message', 'custom')))) as {
      message: string
      stack: string
      custom: string
    }
    expect(message).toMatchInlineSnapshot(`"message"`)
    expect(custom).toMatchInlineSnapshot(`"custom"`)
    expect(stack).toBeDefined()
    expect(stack.split(EOL).length).toBeGreaterThan(3)
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
    expect(stack.split(EOL).length).toBeGreaterThan(3)
  })
})
