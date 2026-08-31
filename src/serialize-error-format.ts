import { TransformableInfo } from 'logform'
import { SPLAT } from 'triple-beam'
import { format } from 'winston'
import { ErrorSerializer, serializeError } from './serialize-error'

export interface SerializeErrorFormatOptions {
  /**
   * Custom serializer used to turn each `Error` instance into a plain object.
   * Defaults to the library's {@link serializeError}.
   */
  serializer?: ErrorSerializer
}

const isPlainObject = (value: object) => {
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

/**
 * Substitutes serialized errors inside the raw splat arguments, and changes nothing else.
 *
 * The main walk rebuilds every object it visits as a plain record, which is what metadata bound for
 * a transport needs. `SPLAT` is not metadata: `format.splat()` interpolates it into the message, so
 * a `Date` or a `Map` has to arrive as itself — rebuilt as a plain record it holds no own
 * enumerable keys, and `%j` would render `{}` in place of its value. So this recurses through
 * arrays and plain objects only, and rebuilds one only when it really holds an error. Anything
 * untouched comes back as the same reference.
 */
const replaceErrors = (value: unknown, serializer: ErrorSerializer, seen: WeakSet<object>): unknown => {
  if (value instanceof Error) return serializer(value)
  if (!value || typeof value !== 'object') return value
  // A cycle is left as it is: the record is winston's, and this walk replaces rather than copies.
  if (seen.has(value)) return value
  if (!Array.isArray(value) && !isPlainObject(value)) return value

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const out = value.map((entry) => replaceErrors(entry, serializer, seen))
      return out.some((entry, index) => entry !== value[index]) ? out : value
    }
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    let replaced = false
    for (const key of Object.keys(source)) {
      out[key] = replaceErrors(source[key], serializer, seen)
      if (out[key] !== source[key]) replaced = true
    }
    return replaced ? out : value
  } finally {
    seen.delete(value)
  }
}

/**
 * Walks the log info object, replacing any `Error` instances (including nested ones)
 * with the plain-object result of the configured serializer so downstream formats and
 * transports see JSON-serializable errors with `message` and `stack` intact.
 *
 * Only the top-level `info` object is mutated (to preserve winston's Symbol-keyed
 * routing props); nested objects and arrays are rebuilt, so caller-supplied metadata
 * references are never mutated.
 *
 * Errors under the `SPLAT` symbol are replaced too. Winston keeps the raw metadata argument there
 * in addition to merging its properties onto `info`, so an `Error` logged as
 * `logger.error(msg, { error })` is reachable twice, and serializing only the string keys leaves
 * the live `Error` under `SPLAT` for every later format to trip over. `SPLAT` is treated more
 * gently than the rest of the record: see {@link replaceErrors}.
 */
export const serializeErrorFormat = format((info, opts) => {
  const serializer = (opts as SerializeErrorFormatOptions | undefined)?.serializer ?? serializeError
  const walk = (value: unknown, seen: WeakSet<object>): unknown => {
    if (value instanceof Error) return serializer(value)
    if (!value || typeof value !== 'object') return value
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    try {
      if (Array.isArray(value)) return value.map((v) => walk(v, seen))
      const source = value as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(source)) out[key] = walk(source[key], seen)
      return out
    } finally {
      seen.delete(value)
    }
  }
  const record = info as unknown as Record<string | symbol, unknown>
  const seen = new WeakSet<object>([record])
  for (const key of Object.keys(record)) record[key] = walk(record[key], seen)
  const splat = record[SPLAT]
  if (Array.isArray(splat)) record[SPLAT] = replaceErrors(splat, serializer, new WeakSet<object>())
  return info as TransformableInfo
})
