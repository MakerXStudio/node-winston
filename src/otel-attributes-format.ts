import { format } from 'winston'
import { serializeError } from './serialize-error'
import { serializesItself } from './serializes-itself'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Replacer = (this: any, key: string, value: any) => any

export interface OtelAttributesFormatOptions {
  /** `JSON.stringify` replacer applied to every value this format stringifies, `errorDetail` included. */
  replacer?: Replacer
}

/** The keys `@opentelemetry/winston-transport` reads an exception from, in the order it tries them. */
const EXCEPTION_KEYS = ['err', 'error'] as const

/** What the logs SDK reads from an exception: `name`, `message` and `stack` become `exception.type/message/stacktrace`. */
const EXCEPTION_FIELDS = new Set(['name', 'message', 'stack'])

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** The transport's own test, so the key chosen here is the one it lifts. */
const isExceptionCandidate = (value: unknown): boolean =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  (isObject(value) && (value.code != null || value.name != null || value.message != null || value.stack != null))

/** A cause the transport turns into `<key>.cause.*` attributes; any other object it writes as `'[object Object]'`. */
const isDescribableCause = (cause: unknown): boolean =>
  typeof cause === 'string' ||
  typeof cause === 'number' ||
  (isObject(cause) &&
    (typeof cause.message === 'string' ||
      typeof cause.name === 'string' ||
      typeof cause.stack === 'string' ||
      typeof cause.code === 'string' ||
      typeof cause.code === 'number'))

/** Plain JSON for any value: errors serialized, BigInts written as `<n>n`, and never a throw out of the log call. */
const stringify = (value: unknown, replacer: Replacer | undefined): string => {
  const plain = function (this: unknown, key: string, entry: unknown): unknown {
    const converted = entry instanceof Error ? serializeError(entry) : typeof entry === 'bigint' ? `${entry}n` : entry
    return replacer ? (replacer.call(this, key, converted) as unknown) : converted
  }
  try {
    return JSON.stringify(value, plain) ?? String(value)
  } catch {
    return '[Unserializable]'
  }
}

/** A value that writes itself as a primitive (a `Date`'s ISO string) is kept unquoted, so a query reads it as it is. */
const flatValue = (value: object, replacer: Replacer | undefined): unknown => {
  if (!replacer && serializesItself(value)) {
    try {
      const json: unknown = (value as { toJSON: () => unknown }).toJSON()
      if (json === null || typeof json === 'string' || typeof json === 'number' || typeof json === 'boolean') return json
    } catch {
      // fall through to the JSON of the value itself
    }
  }
  return stringify(value, replacer)
}

/**
 * Leaves the exception what the logs SDK reads — `name`, `message`, `stack`, and a cause it can
 * describe — and moves the rest of the error to `<key>Detail` as JSON. The SDK takes a truthy `code`
 * over `name` for `exception.type`, so `code` moves too, unless there is no `name` to take its place.
 */
const splitException = (record: Record<string, unknown>, key: string, error: Record<string, unknown>, replacer: Replacer | undefined) => {
  const exception: Record<string, unknown> = {}
  const detail: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(error)) {
    if (EXCEPTION_FIELDS.has(field)) exception[field] = value
    else detail[field] = value
  }
  if (isDescribableCause(error.cause)) exception.cause = error.cause
  if (exception.name == null && error.code != null) {
    exception.code = error.code
    delete detail.code
  }
  record[key] = exception
  if (Object.keys(detail).length > 0) record[`${key}Detail`] = stringify(detail, replacer)
}

/**
 * Shapes a log record into OpenTelemetry log attributes, for `@opentelemetry/winston-transport`
 * 0.29 and later.
 *
 * From 0.29 the transport lifts an `err` or `error` value off the record and gives it to the logs
 * SDK as the record's exception, which becomes `exception.type`, `exception.message`,
 * `exception.stacktrace` and `error.cause.*`. Only those fields survive: anything else on the error
 * is dropped, and an error flattened to a JSON string arrives as one `exception.message` holding
 * the whole JSON. So the error is left an object with just those fields, and the rest of it —
 * `statusCode`, provider data, the whole cause chain — goes to `<key>Detail` as JSON.
 *
 * Every other object value becomes a JSON string, so each attribute is a scalar and the record is
 * flat whatever the transport line: 0.29 to 0.31 pass objects through as they are, and 0.32 and later
 * turn them into nested map attributes, which most backends — Azure Log Analytics included — do not
 * index. Scalars are left alone. A `Date` becomes its ISO string, unquoted.
 *
 * Use it on the transport to keep other transports' output nested, or through
 * `createLogger({ flatten: 'otel' })` when the transport is added for you, as `WinstonInstrumentation`
 * does. For a transport before 0.29, which has no exception handling, use `jsonStringifyValuesFormat`.
 *
 * Mutates `info` in place, so winston's Symbol-keyed routing properties are preserved.
 */
export const otelAttributesFormat = format((info, opts) => {
  const { replacer } = (opts ?? {}) as OtelAttributesFormatOptions
  const record = info as unknown as Record<string, unknown>
  const lifted = EXCEPTION_KEYS.find((key) => isExceptionCandidate(record[key]))
  for (const key of Object.keys(record)) {
    const value = record[key]
    if (!isObject(value)) continue
    if (key === lifted) splitException(record, key, value instanceof Error ? serializeError(value) : value, replacer)
    else record[key] = flatValue(value, replacer)
  }
  return info
})
