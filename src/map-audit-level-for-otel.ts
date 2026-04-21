import { LEVEL } from 'triple-beam'
import { format } from 'winston'

/**
 * OTEL's log spec defines a fixed severity enumeration (trace/debug/info/warn/error/fatal).
 * `@opentelemetry/winston-transport` (auto-installed by `@opentelemetry/instrumentation-winston`)
 * derives `severityText` / `severityNumber` from Winston's triple-beam `LEVEL` symbol and strips
 * the string `level` property before building attributes — so Winston's custom `audit` level
 * arrives at any OTEL backend with `severityNumber: undefined` and no queryable record of the
 * original level. This is most visible on Azure Monitor / Log Analytics (which ignores records
 * without a mapped severity), but applies to any OTEL backend that relies on the spec-defined
 * severity.
 *
 * This format:
 * - rewrites `info[LEVEL]` from `audit` to `info` so OTEL maps to a known severity tier
 * - copies the original level onto `logLevel` on every record so it survives as an OTEL
 *   attribute (e.g. queryable as `customDimensions.logLevel == "audit"` in Azure Log Analytics)
 *
 * The string `info.level` is left as-is — it's only consumed by other winston transports (e.g.
 * our Console transport's JSON output), so leaving it alone keeps local output readable.
 *
 * Caveat: because the `LEVEL` symbol also drives transport-level filtering, a logger/transport
 * explicitly set to `level: 'audit'` would drop these records after rewrite (info is more
 * verbose than audit). `createLogger` guards against that by throwing when the option is
 * enabled alongside an `audit`-level logger/console/transport; when using the format
 * standalone, apply the same discipline. Only enable this when shipping logs via OTEL.
 */
export const mapAuditLevelForOtel = format((info) => {
  info.logLevel = info.level
  if (info.level === 'audit') info[LEVEL] = 'info'
  return info
})
