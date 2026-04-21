import { JsonOptions } from 'logform'
import { serializeError as baseSerializeError } from 'serialize-error'

/**
 * Signature for a function that converts an `Error` instance into a plain, JSON-serializable
 * representation. Supply your own via `createLogger`'s `errorSerializer` option (or
 * `serializeErrorFormat({ serializer })`) to customise how errors are rendered across all transports.
 */
export type ErrorSerializer = (error: Error) => Record<string, unknown>

/**
 * Serialize an `Error` object into a plain object so that it can be serialized for logging.
 * Delegates to the [`serialize-error`](https://www.npmjs.com/package/serialize-error) package,
 * which captures `name`, `message`, `stack`, own enumerable properties, and recursively follows
 * `cause` / nested `Error` values.
 */
export const serializeError: ErrorSerializer = (error) => baseSerializeError(error) as Record<string, unknown>

/**
 * Builds a JSON replacer that substitutes `Error` instances with the output of the supplied
 * `serializer` (defaults to {@link serializeError}). The `serializableErrorReplacer` export is
 * the default instance, pre-bound to {@link serializeError}.
 */
export const createSerializableErrorReplacer =
  (serializer: ErrorSerializer = serializeError): JsonOptions['replacer'] =>
  (_key, value) =>
    value instanceof Error ? serializer(value) : value

/**
 * Replaces values that are `instanceof Error` with the result of {@link serializeError}.
 */
export const serializableErrorReplacer: JsonOptions['replacer'] = createSerializableErrorReplacer()
