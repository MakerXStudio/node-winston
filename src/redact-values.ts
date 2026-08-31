import { cloneDeepWith, forOwn, get, isNil, isObject, set } from 'es-toolkit/compat'
import { serializeError } from './serialize-error'

// A `DOMException` — what `AbortSignal.timeout()` rejects with — cannot survive a deep clone.
// es-toolkit clones an `Error` with `structuredClone` and then re-assigns `message` and `name`, but
// `structuredClone` rebuilds a `DOMException` as a `DOMException`, whose `message` and `name` are
// getter-only prototype accessors, so the assignment throws a `TypeError`. Thrown from inside a
// format, that `TypeError` comes out of the `logger.error(...)` call itself: the caller loses the
// log line and everything it meant to do after it. Substitute the plain, already-cycle-safe object
// `serializeError` builds, which holds the same facts and clones without complaint.
const plainDomException = (error: DOMException): Record<string | symbol, unknown> => {
  const plain = serializeError(error) as Record<string | symbol, unknown>
  // `serializeError` walks string keys only. Carry own symbols across so a `DOMException` given to
  // the logger as the whole record keeps winston's `LEVEL` and `SPLAT` routing symbols.
  for (const symbol of Object.getOwnPropertySymbols(error)) {
    plain[symbol] = (error as unknown as Record<symbol, unknown>)[symbol]
  }
  return plain
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cloneForRedaction = (obj: any) =>
  cloneDeepWith(obj, (value) => (value instanceof DOMException ? plainDomException(value) : undefined))

// Expands a single path against the current node, supporting `[*]` to iterate every element of an
// array segment. Without `[*]` it falls back to lodash-style get/set on a dot path.
const applyPath = (current: unknown, path: string, redactedValue: string) => {
  const wildcardIdx = path.indexOf('[*]')
  if (wildcardIdx === -1) {
    if (!isNil(get(current, path))) set(current as object, path, redactedValue)
    return
  }
  const prefix = path.slice(0, wildcardIdx)
  const afterWildcard = path.slice(wildcardIdx + 3)
  const suffix = afterWildcard.startsWith('.') ? afterWildcard.slice(1) : afterWildcard
  const arr = prefix ? get(current, prefix) : current
  if (!Array.isArray(arr)) return
  arr.forEach((item, i) => {
    if (!suffix) {
      if (!isNil(item)) arr[i] = redactedValue
    } else if (isObject(item)) {
      applyPath(item, suffix, redactedValue)
    }
  })
}

/**
 * Recursively replaces values in an object with '<redacted>' for the specified keys. Enumerates arrays and applies the same redaction to elements.
 * @param obj The object to redact
 * @param keys The keys to redact. Each key may be:
 * - a plain key (`email`) — matched at every level via recursion
 * - a dot-separated path (`user.email`) — uses es-toolkit/compat's get/set
 * - a path with `[*]` wildcards (`files[*].name`, `users[*].addresses[*].zip`, `tags[*]`) — iterates each element of the array at that segment
 * Key checks are applied at every level of the object via recursion.
 * @returns A new object with the specified keys redacted
 */
export const redactValuesWith =
  (redactedValue: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (obj: any, ...keys: string[]) => {
    return (function redact(current) {
      for (const k of keys) {
        applyPath(current, k, redactedValue)
      }
      // isObject returns true for arrays too, so this recurses into both arrays and plain objects
      forOwn(current, (value) => {
        if (isObject(value)) redact(value)
      })
      return current
    })(cloneForRedaction(obj))
  }

export const redactValues = redactValuesWith('<redacted>')
