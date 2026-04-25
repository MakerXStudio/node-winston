import { type TransformableInfo } from 'logform'
import { LEVEL, SPLAT } from 'triple-beam'

export function extractTransformableInfo(info: TransformableInfo): { level: string; message: string; meta: Record<string, unknown> } {
  const { [LEVEL]: _, [SPLAT]: __, level, message, ...meta } = info
  return { level, message: message as string, meta }
}
