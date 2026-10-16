import { format } from 'winston'
import { applyAuditLevelMapping } from './audit-level'
import { serializeError } from './serialize-error'
import { serializesItself } from './serializes-itself'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Replacer = (this: any, key: string, value: any) => any

const TRUNCATED = '[Truncated]'

export interface OtelAttributesFormatOptions {
  /**
   * `JSON.stringify` replacer applied to every value this format stringifies, `errorDetail`
   * included. It is called with the object holding the value as `this`, so it can decide on a
   * property by its siblings. Return `undefined` to leave the property out.
   */
  replacer?: Replacer

  /**
   * Exports an `audit` record at `info` severity and copies every record's level onto `logLevel`.
   * Defaults to `true`. See `mapAuditLevelForOtel` for why. Turn it off for a level map with no
   * `audit`, or when the transport maps severity itself (`severityMapping`, from transport 0.34).
   */
  mapAuditLevel?: boolean

  /**
   * The longest string this format writes. A longer one is cut short and ends in `[Truncated]`, so
   * a backend's own limit never cuts it silently. By default every string is written whole. Values
   * that were already strings are never cut.
   *
   * @example App Insights keeps 8,192 characters of a custom dimension
   * ```ts
   * otelAttributesFormat({ maxAttributeLength: 8192 })
   * ```
   */
  maxAttributeLength?: number
}

interface Settings {
  replacer: Replacer | undefined
  maxAttributeLength: number
  mapAuditLevel: boolean
}

const resolveSettings = (opts: OtelAttributesFormatOptions): Settings => ({
  replacer: opts.replacer,
  maxAttributeLength: opts.maxAttributeLength ?? Infinity,
  mapAuditLevel: opts.mapAuditLevel ?? true,
})

/** A format instance keeps one options object for its lifetime, so its settings are resolved once. */
const settingsCache = new WeakMap<object, Settings>()
const defaultSettings = resolveSettings({})

const settingsFor = (opts: OtelAttributesFormatOptions | undefined): Settings => {
  if (!opts) return defaultSettings
  let settings = settingsCache.get(opts)
  if (!settings) {
    settings = resolveSettings(opts)
    settingsCache.set(opts, settings)
  }
  return settings
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

/** Cuts a string to `max`, ending in `[Truncated]`, without splitting a surrogate pair. */
const cap = (text: string, max: number): string => {
  if (text.length <= max) return text
  let end = Math.max(0, max - TRUNCATED.length)
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return text.slice(0, end) + TRUNCATED
}

/** Plain JSON for any value: errors serialized, BigInts written as `<n>n`, the result capped, and never a throw out of the log call. */
const stringify = (value: unknown, settings: Settings): string => {
  const { replacer } = settings
  const plain = function (this: unknown, key: string, entry: unknown): unknown {
    const converted = entry instanceof Error ? serializeError(entry) : typeof entry === 'bigint' ? `${entry}n` : entry
    return replacer ? (replacer.call(this, key, converted) as unknown) : converted
  }
  let json: string
  try {
    json = JSON.stringify(value, plain) ?? String(value)
  } catch {
    json = '[Unserializable]'
  }
  return cap(json, settings.maxAttributeLength)
}

/** A value that writes itself as a primitive (a `Date`'s ISO string) is kept unquoted, so a query reads it as it is. */
const flatValue = (value: object, settings: Settings): unknown => {
  if (!settings.replacer && serializesItself(value)) {
    try {
      const json: unknown = (value as { toJSON: () => unknown }).toJSON()
      if (typeof json === 'string') return cap(json, settings.maxAttributeLength)
      if (json === null || typeof json === 'number' || typeof json === 'boolean') return json
    } catch {
      // fall through to the JSON of the value itself
    }
  }
  return stringify(value, settings)
}

/**
 * Leaves the exception what the logs SDK reads — `name`, `message`, `stack`, and a cause it can
 * describe — and moves the rest of the error to `<key>Detail` as JSON. The SDK takes a truthy `code`
 * over `name` for `exception.type`, so `code` moves too, unless there is no `name` to take its place.
 *
 * A `<key>Detail` that is already a string is kept: the error was split by an earlier pass, and
 * splitting what that pass left would replace the detail with the cause alone.
 */
const splitException = (record: Record<string, unknown>, key: string, error: Record<string, unknown>, settings: Settings) => {
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
  const detailKey = `${key}Detail`
  if (typeof record[detailKey] === 'string') return
  if (Object.keys(detail).length > 0) record[detailKey] = stringify(detail, settings)
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
 * OpenTelemetry has no severity for winston's `audit` level, so by default the format exports an
 * `audit` record at `info` severity, with every record's level on `logLevel`. See
 * {@link OtelAttributesFormatOptions} to turn that off, cap the strings it writes, or pass a replacer.
 *
 * Put it on the OpenTelemetry transport to keep other transports' output nested, or use
 * `createLogger({ otel: true })` when the transport is added for you, as `WinstonInstrumentation`
 * does. On the transport the audit mapping runs after the transport's level filter, so it can never
 * drop a record.
 *
 * Mutates `info` in place, so winston's Symbol-keyed routing properties are preserved. Nested
 * values are never changed.
 */
export const otelAttributesFormat = format((info, opts) => {
  const settings = settingsFor(opts as OtelAttributesFormatOptions | undefined)
  if (settings.mapAuditLevel) applyAuditLevelMapping(info)
  const record = info as unknown as Record<string, unknown>
  const lifted = EXCEPTION_KEYS.find((key) => isExceptionCandidate(record[key]))
  for (const key of Object.keys(record)) {
    const value = record[key]
    if (!isObject(value)) continue
    if (key === lifted) splitException(record, key, value instanceof Error ? serializeError(value) : value, settings)
    else record[key] = flatValue(value, settings)
  }
  return info
})
