// Internal: deliberately not re-exported from index.ts.
import { type TransformableInfo } from 'logform'
import { LEVEL } from 'triple-beam'

/**
 * Copies the record's level onto `logLevel`, and exports an `audit` record at `info` severity.
 *
 * The string `level` is never changed, so a second pass writes the same `logLevel` again.
 * See `mapAuditLevelForOtel` for why the mapping exists.
 */
export const applyAuditLevelMapping = (info: TransformableInfo): TransformableInfo => {
  info.logLevel = info.level
  if (info.level === 'audit') info[LEVEL] = 'info'
  return info
}
