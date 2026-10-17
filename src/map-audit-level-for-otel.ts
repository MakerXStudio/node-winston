import { format } from 'winston'
import { applyAuditLevelMapping } from './audit-level'

/**
 * OTEL's log spec defines a fixed severity enumeration (trace/debug/info/warn/error/fatal).
 * `@opentelemetry/winston-transport` derives `severityText` / `severityNumber` from Winston's
 * triple-beam `LEVEL` symbol and strips the string `level` property before building attributes,
 * so the custom `audit` level arrives at an OTEL backend with no severity and no queryable
 * record of the original level. Azure Monitor / Log Analytics ignores records without a mapped
 * severity, and a transport `logSeverity` filter drops them.
 *
 * This format:
 * - rewrites `info[LEVEL]` from `audit` to `info` so OTEL maps to a known severity tier
 * - copies the original level onto `logLevel` on every record so it survives as an OTEL
 *   attribute (e.g. queryable as `customDimensions.logLevel == "audit"` in Azure Log Analytics).
 *   A record that already has a string `logLevel` keeps it.
 *
 * The level is read from `info[LEVEL]`, so a format that rewrites the string `info.level`, such as
 * `format.colorize()`, can run first. The string `info.level` is left as it is, so other
 * transports still show `audit`.
 *
 * `otelAttributesFormat` already does this, so most loggers need only that. Use this format on
 * its own in a chain you build yourself, for example beside `jsonStringifyValuesFormat`.
 *
 * Caveat: the `LEVEL` symbol also drives transport-level filtering. On a transport's own format
 * the mapping runs after that transport's filter, so it is always safe there. At the logger
 * level it runs before every transport's filter, so a logger or transport set to `level: 'audit'`
 * would drop these records (`info` is more verbose than `audit`). Use `'info'` there instead.
 */
export const mapAuditLevelForOtel = format((info) => applyAuditLevelMapping(info))
