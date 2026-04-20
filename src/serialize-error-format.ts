import { TransformableInfo } from 'logform'
import { format } from 'winston'
import { serializeError } from './serialize-error'

const walk = (value: unknown): unknown => {
  if (value instanceof Error) return serializeError(value)
  if (Array.isArray(value)) return value.map(walk)
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source)) out[key] = walk(source[key])
    return out
  }
  return value
}

/**
 * Walks the log info object, replacing any `Error` instances (including nested ones)
 * with the plain-object result of {@link serializeError} so downstream formats and
 * transports see JSON-serializable errors with `message` and `stack` intact.
 *
 * Only the top-level `info` object is mutated (to preserve winston's Symbol-keyed
 * routing props); nested objects and arrays are rebuilt, so caller-supplied metadata
 * references are never mutated.
 */
export const serializeErrorFormat = format((info) => {
  const record = info as unknown as Record<string, unknown>
  for (const key of Object.keys(record)) record[key] = walk(record[key])
  return info as TransformableInfo
})
