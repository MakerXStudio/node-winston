import { TransformableInfo } from 'logform'
import { format } from 'winston'

// Hand-rolled rather than using es-toolkit/compat's omitBy: that treats any
// object with a numeric `length` property (e.g. a pg error spread via splat)
// as array-like, returns {}, and drops winston's LEVEL/MESSAGE symbols —
// breaking downstream formats like colorize. See toss/es-toolkit#1706.
export const omitNilFormat = format((info) => {
  const out: Record<string | symbol, unknown> = {}
  for (const key of Object.keys(info)) {
    if (info[key] != null) out[key] = info[key]
  }
  for (const sym of Object.getOwnPropertySymbols(info)) {
    if (info[sym] != null) out[sym] = info[sym]
  }
  return out as TransformableInfo
})
