import { type TransformableInfo } from 'logform'
import { LEVEL, SPLAT } from 'triple-beam'

/**
 * Plain shape of a winston `TransformableInfo` after the `triple-beam` symbols (`LEVEL`, `SPLAT`)
 * have been stripped and `level` / `message` split out from the remaining metadata. Returned by
 * {@link extractTransformableInfo}.
 */
export type TransformedInfo = { level: string; message: string; meta: Record<string, unknown> }

export function extractTransformableInfo(info: TransformableInfo): TransformedInfo {
  const { [LEVEL]: _, [SPLAT]: __, level, message, ...meta } = info
  return { level, message: message as string, meta }
}
