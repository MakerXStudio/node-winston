import { JsonOptions } from 'logform'

/**
 * Signature for a function that converts an `Error` instance into a plain, JSON-serializable
 * representation. Supply your own via `createLogger`'s `errorSerializer` option (or
 * `serializeErrorFormat({ serializer })`) to customise how errors are rendered across all transports.
 */
export type ErrorSerializer = (error: Error) => Record<string, unknown>

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

const walk = (value: unknown, seen: WeakSet<object>, depth: number): unknown => {
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

  seen.add(obj)
  try {
    if (Array.isArray(obj)) return obj.map((entry) => walk(entry, seen, depth + 1))

    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      const read = safeRead(obj, key)
      if (read.ok) out[key] = walk(read.value, seen, depth + 1)
    }
    if (isErrorLike(obj)) {
      for (const key of WELL_KNOWN_ERROR_PROPS) {
        if (key in out) continue
        const read = safeRead(obj, key)
        if (!read.ok || read.value === undefined || read.value === null) continue
        out[key] = walk(read.value, seen, depth + 1)
      }
    }
    return out
  } finally {
    seen.delete(obj)
  }
}

/**
 * Serialize an `Error` (or any thrown value) into a plain, JSON-serializable object.
 *
 * Captures `name`, `message`, `stack`, `code`, `cause`, and `errors` (AggregateError) even when
 * they are non-enumerable, walks own enumerable properties, recurses into nested errors and
 * objects, and is safe against circular references (cycles render as `'[Circular]'`). BigInts
 * are stringified, functions are dropped, Buffers and streams render as sentinel strings,
 * and recursion is capped at a fixed depth (`'[Truncated]'`). Non-Error throws (strings,
 * numbers, etc.) are wrapped as `{ name: 'NonError', message: String(value) }`.
 */
export const serializeError: ErrorSerializer = (error) => {
  if (error === null || error === undefined || typeof error !== 'object') {
    return { name: 'NonError', message: typeof error === 'function' ? '<Function>' : String(error) }
  }
  return walk(error, new WeakSet(), 0) as Record<string, unknown>
}

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
