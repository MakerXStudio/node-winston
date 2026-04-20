import { JsonOptions } from 'logform'

/**
 * Serialize an `Error` object into a plain object so that it can be serialized for logging.
 * Captures all own properties (including non-enumerable `message`/`stack`) plus `name` from the prototype.
 */
export const serializeError = (error: Error): Record<string, unknown> => {
  const out: Record<string, unknown> = { name: error.name }
  for (const key of Object.getOwnPropertyNames(error)) {
    const value = (error as unknown as Record<string, unknown>)[key]
    out[key] = value instanceof Error ? serializeError(value) : value
  }
  return out
}

/**
 * Replaces values that are `instanceof Error` with the result of `serializeError`
 */
export const serializableErrorReplacer: JsonOptions['replacer'] = (_key, value) => (value instanceof Error ? serializeError(value) : value)
