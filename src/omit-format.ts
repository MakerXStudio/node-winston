import { omit } from 'es-toolkit/compat'
import { TransformableInfo } from 'logform'
import { format } from 'winston'

export const omitFormat = format((info, opts) => omit(info, (opts as { paths: string[] }).paths) as TransformableInfo)
