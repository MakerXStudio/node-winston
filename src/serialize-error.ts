import { JsonOptions } from 'logform'
import { serializesItself } from './serializes-itself'

/**
 * Signature for a function that converts an `Error` instance into a plain, JSON-serializable
 * representation. Supply your own via `createLogger`'s `errorSerializer` option (or
 * `serializeErrorFormat({ serializer })`) to customise how errors are rendered across all transports.
 */
export type ErrorSerializer = (error: Error) => Record<string, unknown>

export interface ErrorSerializerOptions {
  /**
   * Leaves a property out of an error. Called with each property name of every error the
   * serializer reaches — the error itself, its `cause`, each entry of its `errors`, and any error
   * held in a property — and the error that holds it. Return `true` to leave the property out.
   * Plain objects are never passed to it. A predicate that throws keeps the property.
   *
   * @example Leave response headers out of every error, at any depth
   * ```ts
   * createErrorSerializer({ omit: (key) => key === 'responseHeaders' })
   * ```
   */
  omit?: (key: string, error: Error) => boolean

  /**
   * Writes an object that has already been written once in the same error as `'[Duplicate]'`, so
   * an object two properties share appears once. The first property in key order keeps the object.
   * Values written through their `toJSON`, such as a `Date`, are always written in full.
   * Defaults to `false`.
   */
  dedupe?: boolean
}

interface WalkOptions {
  omit: ErrorSerializerOptions['omit']
  /** Every object already written, when `dedupe` is on. */
  written: WeakSet<object> | undefined
}

// Stops runaway recursion on pathological structures. 16 is well past anything that occurs in
// realistic error trees; consumers who need deeper walks can supply a custom `errorSerializer`.
const MAX_DEPTH = 16

// Captured even when non-enumerable, which is the default for all of these on `Error` instances.
// `code` is enumerable in practice (Node attaches it as a regular own property) but listing it
// here is harmless and future-proofs against engines marking it non-enumerable.
const WELL_KNOWN_ERROR_PROPS = ['name', 'message', 'stack', 'code', 'cause', 'errors'] as const

const isErrorLike = (value: unknown): value is Error =>
  value instanceof Error ||
  (typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { message?: unknown }).message === 'string' &&
    typeof (value as { stack?: unknown }).stack === 'string')

const safeRead = (source: object, key: string | symbol): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: (source as Record<string | symbol, unknown>)[key as string] }
  } catch {
    return { ok: false }
  }
}

/** `toJSON`'s result, or nothing when it throws or hands back the value itself. */
const safeToJSON = (source: object): { ok: true; value: unknown } | { ok: false } => {
  try {
    const value: unknown = (source as { toJSON: () => unknown }).toJSON()
    return value === source ? { ok: false } : { ok: true, value }
  } catch {
    return { ok: false }
  }
}

/** The caller's `omit`, which must never throw out of the log call. */
const isOmitted = (options: WalkOptions, key: string, error: Error): boolean => {
  if (!options.omit) return false
  try {
    return options.omit(key, error) === true
  } catch {
    return false
  }
}

const walk = (value: unknown, seen: WeakSet<object>, depth: number, options: WalkOptions): unknown => {
  if (value === null || value === undefined) return value
  const type = typeof value
  if (type === 'bigint') return `${value as bigint}n`
  if (type === 'function') return undefined
  if (type !== 'object') return value

  const obj = value as object
  if (typeof (obj as { pipe?: unknown }).pipe === 'function') return '[object Stream]'
  if (obj instanceof Uint8Array) return `[object ${obj.constructor.name}]`
  if (seen.has(obj)) return '[Circular]'
  if (depth >= MAX_DEPTH) return '[Truncated]'

  const errorLike = isErrorLike(obj)
  // What `JSON.stringify` would have written: a `Date` becomes its ISO string (`null` when
  // invalid) rather than `{}`. An error is never asked, so one that defines `toJSON` — an
  // `AxiosError`, say — is still captured whole below.
  const json = !Array.isArray(obj) && !errorLike && serializesItself(obj) ? safeToJSON(obj) : undefined

  // A value written through its `toJSON` is what it returns, not a shared object, so it is never
  // a duplicate.
  if (!json?.ok && options.written) {
    if (options.written.has(obj)) return '[Duplicate]'
    options.written.add(obj)
  }

  seen.add(obj)
  try {
    if (Array.isArray(obj)) return obj.map((entry) => walk(entry, seen, depth + 1, options))
    if (json?.ok) return walk(json.value, seen, depth + 1, options)

    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      if (errorLike && isOmitted(options, key, obj)) continue
      const read = safeRead(obj, key)
      if (read.ok) out[key] = walk(read.value, seen, depth + 1, options)
    }
    if (errorLike) {
      for (const key of WELL_KNOWN_ERROR_PROPS) {
        if (key in out || isOmitted(options, key, obj)) continue
        const read = safeRead(obj, key)
        if (!read.ok || read.value === undefined || read.value === null) continue
        out[key] = walk(read.value, seen, depth + 1, options)
      }
    }
    return out
  } finally {
    seen.delete(obj)
  }
}

/**
 * Builds an {@link ErrorSerializer} that works like {@link serializeError}, and can leave
 * properties out of each error or write a shared object once. Pass the result as `createLogger`'s
 * `errorSerializer`.
 *
 * @example Leave out response headers, and an error's `lastError` when its `errors` holds it
 * ```ts
 * createLogger({
 *   errorSerializer: createErrorSerializer({
 *     omit: (key, error) => key === 'responseHeaders' || (key === 'lastError' && 'errors' in error),
 *   }),
 * })
 * ```
 */
export const createErrorSerializer =
  (options: ErrorSerializerOptions = {}): ErrorSerializer =>
  (error) => {
    if (error === null || error === undefined || typeof error !== 'object') {
      return { name: 'NonError', message: typeof error === 'function' ? '<Function>' : String(error) }
    }
    const walkOptions: WalkOptions = { omit: options.omit, written: options.dedupe ? new WeakSet() : undefined }
    return walk(error, new WeakSet(), 0, walkOptions) as Record<string, unknown>
  }

/**
 * Serialize an `Error` (or any thrown value) into a plain, JSON-serializable object.
 *
 * Captures `name`, `message`, `stack`, `code`, `cause`, and `errors` (AggregateError) even when
 * they are non-enumerable, walks own enumerable properties, recurses into nested errors and
 * objects, and is safe against circular references (cycles render as `'[Circular]'`). A value
 * that defines `toJSON` (a `Date`, a `URL`) is replaced by what it returns. BigInts
 * are stringified, functions are dropped, Buffers and streams render as sentinel strings,
 * and recursion is capped at a fixed depth (`'[Truncated]'`). Non-Error throws (strings,
 * numbers, etc.) are wrapped as `{ name: 'NonError', message: String(value) }`.
 *
 * Use {@link createErrorSerializer} to leave properties out or write shared objects once.
 */
export const serializeError: ErrorSerializer = createErrorSerializer()

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
