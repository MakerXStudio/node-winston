// Internal: deliberately not re-exported from index.ts.
import { type TransformableInfo } from 'logform'
import { LEVEL } from 'triple-beam'

/**
 * Copies the record's level onto `logLevel`, and exports an `audit` record at `info` severity.
 *
 * The level is read from the triple-beam `LEVEL` symbol, because a format such as
 * `format.colorize()` rewrites the string `level`. A `logLevel` the record already has is kept,
 * so a second pass leaves `logLevel` at `audit` after the first pass has changed `LEVEL`.
 * See `mapAuditLevelForOtel` for why the mapping exists.
 */
export const applyAuditLevelMapping = (info: TransformableInfo): TransformableInfo => {
  const level = info[LEVEL] as string | undefined
  if (typeof info.logLevel !== 'string') info.logLevel = level
  if (level === 'audit') info[LEVEL] = 'info'
  return info
}
