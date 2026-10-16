// Internal: deliberately not re-exported from index.ts.

/**
 * Whether a value serialises itself through `toJSON`, as a `Date`, a `URL` or a date-library
 * instance does. `JSON.stringify` calls it, so these values are left for the JSON step rather than
 * rebuilt from their own enumerable keys — a `Date` has none, and would otherwise render as `{}`.
 */
export const serializesItself = (value: object): boolean => typeof (value as { toJSON?: unknown }).toJSON === 'function'
