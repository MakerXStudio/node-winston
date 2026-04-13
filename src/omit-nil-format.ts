import { isNil, omitBy } from 'lodash'
import { TransformableInfo } from 'logform'
import { format } from 'winston'

export const omitNilFormat = format((info) => omitBy(info, isNil) as TransformableInfo)
