import { TransformableInfo } from 'logform'
import { format } from 'winston'

/**
 * Serialises all top-level object values on the log info to JSON strings, producing
 * a flat `{ key: string }` shape suitable for OTEL transports that expect scalar values
 * (e.g. some log aggregators that index on string fields and suitable for OTEL + Azure Log Analytics).
 *
 * Accepts an optional `replacer` forwarded to `JSON.stringify` for each value.
 *
 * Mutates `info` in place so winston's Symbol-keyed routing props (`LEVEL`, `MESSAGE`, `SPLAT`)
 * are preserved — returning a new object via `Object.fromEntries(Object.entries(info))` would drop them.
 */
export const jsonStringifyValuesFormat = format((info, opts) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { replacer } = (opts ?? {}) as { replacer?: (this: any, key: string, value: any) => any }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const record = info as Record<string, any>
  for (const key of Object.keys(record)) {
    const value = record[key]
    if (value !== null && value !== undefined && typeof value === 'object') {
      record[key] = JSON.stringify(value, replacer)
    }
  }
  return info as TransformableInfo
})
