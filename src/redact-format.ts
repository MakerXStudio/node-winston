import { TransformableInfo } from 'logform'
import { format } from 'winston'
import { redactValuesWith } from './redact-values'
import { type ErrorSerializer } from './serialize-error'

export const redactFormat = format((info, opts) => {
  const {
    paths,
    redactedValue = '<redacted>',
    errorSerializer,
  } = opts as {
    paths: string[]
    redactedValue?: string
    errorSerializer?: ErrorSerializer
  }
  return redactValuesWith(redactedValue, errorSerializer)(info, ...paths) as TransformableInfo
})
