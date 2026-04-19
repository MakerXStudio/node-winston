import { isNil, omitBy } from 'es-toolkit/compat'
import { TransformableInfo } from 'logform'
import { format } from 'winston'

export const omitNilFormat = format((info) => omitBy(info, isNil) as TransformableInfo)
