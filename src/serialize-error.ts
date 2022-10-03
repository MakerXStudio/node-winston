import { JsonOptions } from 'logform'

/**
 * Serialize an `Error` object into a plain object so that it can be serialized for logging, including the message and stack
 * - `message` and `stack` are explicitly copied
 * - other enumerable properties copied via `...rest`
 */
export const serializeError = ({ message, stack, ...rest }: Error): object => ({
  message,
  stack,
  ...rest,
})

/**
 * Replaces values that are `instanceof Error` with the result of `serializeError`
 */
export const serializableErrorReplacer: JsonOptions['replacer'] = (_key, value) => (value instanceof Error ? serializeError(value) : value)
