import { cloneDeepWith, forOwn, get, isNil, isObject, set } from 'es-toolkit/compat'
import { type ErrorSerializer, serializeError } from './serialize-error'

// A `DOMException` — the reason an `AbortSignal` carries, so what a cancelled operation rejects
// with — cannot survive a deep clone. es-toolkit clones an `Error` with `structuredClone` and then
// re-assigns `message` and `name`, but `structuredClone` rebuilds a `DOMException` as a
// `DOMException`, whose `message` and `name` are getter-only prototype accessors, so the assignment
// throws a `TypeError`. Thrown from inside a format, that `TypeError` comes out of the
// `logger.error(...)` call itself: the caller loses the log line and everything it meant to do
// after it. Substitute the plain object the serializer builds, which holds the same facts and
// clones without complaint.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cloneForRedaction = (obj: any, serializer: ErrorSerializer) => {
  // Each `DOMException` maps to the object standing in for it, so a serializer that puts the error
  // back into its own output resolves to that substitute rather than recursing forever.
  const substituted = new Map<DOMException, Record<string | symbol, unknown>>()

  const substitute = (value: unknown): unknown => {
    if (!(value instanceof DOMException)) return undefined
    const existing = substituted.get(value)
    if (existing) return existing

    const plain: Record<string | symbol, unknown> = {}
    substituted.set(value, plain)
    // Deep-cloned rather than spread. Redaction writes into what it is given, and a serializer may
    // return a frozen record, a cached one shared between calls, or one holding a reference to the
    // error's own properties — sharing any of those would corrupt the original.
    Object.assign(plain, cloneDeepWith(serializer(value), substitute))
    // A serializer walks string keys only. Carry own symbols across so a `DOMException` given to
    // the logger as the whole record keeps winston's `LEVEL` and `SPLAT` routing symbols.
    for (const symbol of Object.getOwnPropertySymbols(value)) {
      plain[symbol] = cloneDeepWith((value as unknown as Record<symbol, unknown>)[symbol], substitute)
    }
    return plain
  }

  return cloneDeepWith(obj, substitute)
}

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
 * @param errorSerializer Used to substitute a `DOMException`, which no deep clone can rebuild.
 * Defaults to the library's {@link serializeError}. `createLogger` passes whatever `errorSerializer`
 * it was given, so a `DOMException` reaches the transports in the same shape as every other error.
 * @returns A new object with the specified keys redacted
 */
export const redactValuesWith =
  (redactedValue: string, errorSerializer: ErrorSerializer = serializeError) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (obj: any, ...keys: string[]) => {
    // A clone of a cyclic record is cyclic too, and the walk below would never return — a
    // RangeError out of the log call, which is the one thing redaction must not cause. Visiting a
    // node once is enough whether it was reached through a cycle or shared by two branches:
    // redaction writes the same value either way.
    const seen = new WeakSet<object>()
    return (function redact(current) {
      if (isObject(current)) {
        if (seen.has(current)) return current
        seen.add(current)
      }
      for (const k of keys) {
        applyPath(current, k, redactedValue)
      }
      // isObject returns true for arrays too, so this recurses into both arrays and plain objects
      forOwn(current, (value) => {
        if (isObject(value)) redact(value)
      })
      return current
    })(cloneForRedaction(obj, errorSerializer))
  }

export const redactValues = redactValuesWith('<redacted>')
