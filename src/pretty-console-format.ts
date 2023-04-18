import { Format, format, TransformableInfo } from 'logform'
import yamlifyObject from 'yamlify-object'
import yamlifyColors from 'yamlify-object-colors'
import colors from '@colors/colors'
import { serializeError } from './serialize-error'

export const yamlify = (meta: Record<string, unknown>) => {
  return yamlifyObject(meta, {
    colors: yamlifyColors,
    errorToString: (error, prefix) =>
      yamlifyObject(serializeError(error), {
        prefix,
        colors: yamlifyColors,
      }),
  })
}

export const prettyConsoleFormat = (): Format =>
  format.combine(
    format.colorize(),
    format.timestamp({ format: 'HH:mm:ss.SSS' }),
    format.printf((info: TransformableInfo) => {
      const { level, timestamp, message, ...meta } = info
      const yaml = yamlify(meta)
      return `[${level}] ${colors.grey(timestamp)} ${message}${yaml}`
    })
  )
