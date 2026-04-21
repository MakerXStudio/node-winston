import { TransformableInfo } from 'logform'
import { format } from 'winston'
import { redactValuesWith } from './redact-values'

export const redactFormat = format((info, opts) => {
  const { paths, redactedValue = '<redacted>' } = opts as { paths: string[]; redactedValue?: string }
  return redactValuesWith(redactedValue)(info, ...paths) as TransformableInfo
})
