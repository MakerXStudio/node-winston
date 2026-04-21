/**
 * Serialises all top level object values to JSON, optionally using the supplied replacer
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsonStringifyValues(obj?: any, replacer?: (this: any, key: string, value: any) => any) {
  if (!obj) return obj
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      value !== null && value !== undefined && typeof value === 'object' ? JSON.stringify(value as object, replacer) : value,
    ]),
  )
}
