import { TransformableInfo } from 'logform'
import { format } from 'winston'
import { serializeError } from './serialize-error'

const walk = (value: unknown): unknown => {
  if (value instanceof Error) return serializeError(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = walk(value[i])
    return value
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of Object.keys(obj)) obj[key] = walk(obj[key])
    return obj
  }
  return value
}

/**
 * Walks the log info object, replacing any `Error` instances (including nested ones)
 * with the plain-object result of {@link serializeError} so downstream formats and
 * transports see JSON-serializable errors with `message` and `stack` intact.
 */
export const serializeErrorFormat = format((info) => {
  walk(info)
  return info as TransformableInfo
})
