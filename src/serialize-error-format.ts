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

/**
 * Walks the log info object, replacing any `Error` instances (including nested ones)
 * with the plain-object result of the configured serializer so downstream formats and
 * transports see JSON-serializable errors with `message` and `stack` intact.
 *
 * Only the top-level `info` object is mutated (to preserve winston's Symbol-keyed
 * routing props); nested objects and arrays are rebuilt, so caller-supplied metadata
 * references are never mutated.
 *
 * The `SPLAT` symbol is walked as well. Winston keeps the raw metadata argument there in addition
 * to merging its properties onto `info`, so an `Error` logged as `logger.error(msg, { error })` is
 * reachable twice. Serializing only the string keys leaves the live `Error` under `SPLAT` for every
 * later format to trip over.
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
  if (Array.isArray(splat)) record[SPLAT] = splat.map((value) => walk(value, seen))
  return info as TransformableInfo
})
