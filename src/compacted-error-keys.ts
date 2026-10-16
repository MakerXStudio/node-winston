// Internal: deliberately not re-exported from index.ts.

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** An error as `serializeError` writes one, or a provider's own error object: it has a string `name` and `message`. */
const isErrorShaped = (value: unknown): value is Record<string, unknown> =>
  isObject(value) && typeof value.name === 'string' && typeof value.message === 'string'

/**
 * Whether `key` is left out when a serialized error is compacted.
 *
 * An AI SDK `RetryError` holds every attempt's `APICallError` under `errors`, and the last attempt
 * once more under `lastError`. Each attempt carries its response headers. Together they overrun the
 * 8,192-character limit of an App Insights custom dimension, so the dimension is cut off and no longer
 * parses as JSON. `responseHeaders` is dropped from every error, and `lastError` from an error whose
 * `errors` already holds it.
 *
 * Only an error is compacted: a caller's own `responseHeaders` on a plain object is kept.
 */
export const isCompactedErrorKey = (holder: unknown, key: string): boolean => {
  if (key !== 'responseHeaders' && key !== 'lastError') return false
  if (!isErrorShaped(holder)) return false
  if (key === 'responseHeaders') return true
  return Array.isArray(holder.errors) && holder.errors.length > 0
}
