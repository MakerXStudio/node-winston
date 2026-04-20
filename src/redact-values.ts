import { cloneDeep, forOwn, get, isNil, isObject, set } from 'es-toolkit/compat'

/**
 * Recursively replaces values in an object with '<redacted>' for the specified keys. Enumerates arrays and applies the same redaction to elements.
 * @param obj The object to redact
 * @param keys The keys to redact, can be a dot-separated path (uses lodash's get/set).
 * Use dot notation to specify more specific keys.
 * Key checks are applied at every level of the object via recursion.
 * @returns A new object with the specified keys redacted
 */
export const redactValuesWith =
  (redactedValue: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (obj: any, ...keys: string[]) => {
    return (function redact(current) {
      for (const k of keys) {
        if (!isNil(get(current, k))) set(current, k, redactedValue)
      }
      forOwn(current, function (value) {
        if (isObject(value)) redact(value)
        else if (Array.isArray(value)) {
          for (const item of value) {
            if (isObject(item)) redact(item)
          }
        }
      })
      return current
    })(cloneDeep(obj))
  }

export const redactValues = redactValuesWith('<redacted>')
