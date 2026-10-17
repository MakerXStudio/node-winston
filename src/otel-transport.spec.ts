/**
 * What a record looks like once it is an OpenTelemetry log record, through the real
 * `@opentelemetry/winston-transport` and the logs SDK — the row a backend stores.
 *
 * The supported transport line, installed side by side:
 * - 0.29, under an npm alias: the oldest release that lifts `err`/`error` off the record as the
 *   exception.
 * - latest, under its own name: also normalises object attributes into nested maps (from 0.32),
 *   and takes `severityMapping` and `logSeverity` options (from 0.34).
 *
 * Each transport binds its logger when it is constructed, so the provider is registered first.
 */
import { logs, SeverityNumber } from '@opentelemetry/api-logs'
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { OpenTelemetryTransportV3 as Transport029 } from 'otel-winston-transport-0.29'
import { OpenTelemetryTransportV3 as TransportLatest } from '@opentelemetry/winston-transport'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { format } from 'winston'
import type TransportStream from 'winston-transport'
import { CallbackTransport, createErrorSerializer, createLogger, type CreateLoggerOptions, type Logger } from './index'
import { jsonStringifyValuesFormat } from './json-stringify-values-format'

type TransportClass = new (options?: TransportStream.TransportStreamOptions) => TransportStream

const exporter = new InMemoryLogRecordExporter()
const provider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] })

beforeAll(() => {
  logs.setGlobalLoggerProvider(provider)
})

afterAll(async () => {
  await provider.shutdown()
  logs.disable()
})

class ProviderError extends Error {
  readonly name = 'ProviderError'
  readonly statusCode = 413
  readonly data = { error: { code: 'request_too_large' } }
}

const failure = () => new ProviderError('Request too large', { cause: new Error('body exceeds limit') })
const at = new Date('2026-01-02T03:04:05.000Z')

/** An AI SDK `APICallError`: the prompt and the response headers are own properties. */
const apiCallError = (attempt: number) =>
  Object.assign(new Error(`attempt ${attempt} failed`), {
    name: 'AI_APICallError',
    statusCode: 429,
    requestBodyValues: { messages: [{ role: 'user', content: 'the whole prompt' }] },
    responseHeaders: { 'x-request-id': `req-${attempt}` },
  })

/** An AI SDK `RetryError`: every attempt under `errors`, and the last once more under `lastError`. */
const retryError = () => {
  const errors = [apiCallError(1), apiCallError(2)]
  return Object.assign(new Error('Failed after 2 attempts'), { name: 'AI_RetryError', errors, lastError: errors[1] })
}

let sequence = 0

/** Logs one line through a fresh logger and returns the log records it exported. */
async function emitted(options: Partial<CreateLoggerOptions>, log: (logger: Logger, message: string) => void) {
  const message = `line ${++sequence}`
  const logger = createLogger({ consoleOptions: { silent: true }, ...options })
  log(logger, message)
  await new Promise((resolve) => setImmediate(resolve))
  return exporter.getFinishedLogRecords().filter((record) => record.body === message)
}

/** Logs one error line through a fresh logger on `Transport` and returns its exported attributes. */
async function exported(Transport: TransportClass, options: Partial<CreateLoggerOptions> = {}, transport?: TransportStream) {
  const records = await emitted({ transports: [transport ?? new Transport()], ...options }, (logger, message) =>
    logger.error(message, { error: failure(), at, request: { route: '/chat', attempt: 2 } }),
  )
  expect(records).toHaveLength(1)
  return records[0].attributes as Record<string, unknown>
}

const isScalar = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value)

const lines: [string, TransportClass][] = [
  ['0.29', Transport029],
  ['latest', TransportLatest],
]

describe.each(lines)('otel: true on %s', (_, Transport) => {
  it('records the error as exception.type, exception.message and exception.stacktrace', async () => {
    const attributes = await exported(Transport, { otel: true })
    expect(attributes).toMatchObject({ 'exception.type': 'ProviderError', 'exception.message': 'Request too large' })
    expect(String(attributes['exception.stacktrace'])).toContain('Request too large')
  })

  it("records the error's cause as error.cause.message", async () => {
    expect((await exported(Transport, { otel: true }))['error.cause.message']).toBe('body exceeds limit')
  })

  it("keeps the error's status, provider data and cause chain under errorDetail", async () => {
    const attributes = await exported(Transport, { otel: true })
    expect(JSON.parse(attributes.errorDetail as string)).toMatchObject({
      statusCode: 413,
      data: { error: { code: 'request_too_large' } },
      cause: { message: 'body exceeds limit' },
    })
  })

  it('writes every attribute as a scalar, none of them [object Object]', async () => {
    const attributes = await exported(Transport, { otel: true })
    expect(Object.values(attributes).every(isScalar)).toBe(true)
    expect(Object.values(attributes)).not.toContain('[object Object]')
  })

  it('writes other objects as JSON strings and a Date as its ISO string', async () => {
    const attributes = await exported(Transport, { otel: true })
    expect(attributes.request).toBe('{"route":"/chat","attempt":2}')
    expect(attributes.at).toBe('2026-01-02T03:04:05.000Z')
  })

  it('exports an audit record at INFO severity, with logLevel audit', async () => {
    const records = await emitted({ otel: true, transports: [new Transport()] }, (logger, message) => logger.audit(message))
    expect(records).toHaveLength(1)
    expect(records[0].severityNumber).toBe(SeverityNumber.INFO)
    expect(records[0].attributes.logLevel).toBe('audit')
  })

  // The README's recipe for AI SDK errors, built from generic options only.
  it('exports an audit record at INFO severity when loggerOptions.format colorizes the level', async () => {
    const records = await emitted(
      { otel: true, loggerOptions: { format: format.colorize() }, transports: [new Transport()] },
      (logger, message) => logger.audit(message),
    )
    expect(records[0].severityNumber).toBe(SeverityNumber.INFO)
    expect(records[0].attributes.logLevel).toBe('audit')
  })

  it('redacts the prompt and trims a failed retry with redactPaths and createErrorSerializer', async () => {
    const options: Partial<CreateLoggerOptions> = {
      otel: { maxAttributeLength: 8192 },
      redactPaths: ['requestBodyValues'],
      errorSerializer: createErrorSerializer({
        omit: (key, error) => key === 'responseHeaders' || (key === 'lastError' && 'errors' in error),
      }),
      transports: [new Transport()],
    }
    const [record] = await emitted(options, (logger, message) => logger.error(message, { error: retryError() }))
    expect(record.attributes['exception.type']).toBe('AI_RetryError')
    const detail = JSON.parse(record.attributes.errorDetail as string) as { errors: Record<string, unknown>[] }
    expect(detail).not.toHaveProperty('lastError')
    expect(detail.errors).toHaveLength(2)
    expect(detail.errors.map((attempt) => attempt.requestBodyValues)).toEqual(['<redacted>', '<redacted>'])
    expect(detail.errors.some((attempt) => 'responseHeaders' in attempt)).toBe(false)
    expect(JSON.stringify(record.attributes)).not.toContain('the whole prompt')
  })

  it('caps errorDetail at maxAttributeLength', async () => {
    const [record] = await emitted({ otel: { maxAttributeLength: 8192 }, transports: [new Transport()] }, (logger, message) =>
      logger.error(message, { error: Object.assign(new Error('big'), { body: 'x'.repeat(20_000) }) }),
    )
    const detail = record.attributes.errorDetail as string
    expect(detail).toHaveLength(8192)
    expect(detail.endsWith('[Truncated]')).toBe(true)
  })

  // Upstream behaviour, pinned so that a change to it fails this test. With no `err` or `error` on
  // the record, the transport takes the first splat argument that has a `name`, `code`, `message`
  // or `stack` as the record's exception.
  it('records a metadata object with a name as the exception when there is no err or error', async () => {
    const [record] = await emitted({ otel: true, transports: [new Transport()] }, (logger, message) =>
      logger.info(message, { name: 'Alice' }),
    )
    expect(record.attributes['exception.type']).toBe('Alice')
    expect(record.attributes.name).toBe('Alice')
  })

  it('leaves other transports nested', async () => {
    const seen: Record<string, unknown>[] = []
    const sibling = new CallbackTransport(
      async ({ meta }) => void seen.push(meta),
      () => undefined,
    )
    const [record] = await emitted({ otel: true, transports: [new Transport(), sibling] }, (logger, message) =>
      logger.error(message, { error: failure(), request: { route: '/chat' } }),
    )
    expect(record.attributes).toMatchObject({ 'exception.type': 'ProviderError', request: '{"route":"/chat"}' })
    expect(seen[0].request).toEqual({ route: '/chat' })
    expect(seen[0].error).toMatchObject({ statusCode: 413 })
  })

  it('exports audit records at INFO severity from a transport set to level audit', async () => {
    const records = await emitted({ otel: true, transports: [new Transport({ level: 'audit' })] }, (logger, message) => {
      logger.audit(message)
      logger.info(message)
    })
    expect(records).toHaveLength(1)
    expect(records[0].severityNumber).toBe(SeverityNumber.INFO)
    expect(records[0].attributes.logLevel).toBe('audit')
  })
})

describe.each(lines)('jsonStringifyValuesFormat on %s', (_, Transport) => {
  it('records the whole error JSON as exception.message, which is why it is not for the OpenTelemetry transport', async () => {
    const attributes = await exported(Transport, {}, new Transport({ format: jsonStringifyValuesFormat() }))
    expect(String(attributes['exception.message']).startsWith('{')).toBe(true)
    expect(attributes).not.toHaveProperty('exception.type')
  })
})

describe('without otel on latest', () => {
  it('records the exception but drops the rest of the error', async () => {
    const attributes = await exported(TransportLatest)
    expect(attributes['exception.message']).toBe('Request too large')
    expect(JSON.stringify(attributes)).not.toContain('413')
  })
})

describe('transport severity options on latest', () => {
  it('severityMapping keeps severityText audit when otel leaves the level alone', async () => {
    const transport = new TransportLatest({ severityMapping: { audit: SeverityNumber.INFO } })
    const [record] = await emitted({ otel: { mapAuditLevel: false }, transports: [transport] }, (logger, message) => logger.audit(message))
    expect(record.severityNumber).toBe(SeverityNumber.INFO)
    expect(record.severityText).toBe('audit')
    expect(record.attributes).not.toHaveProperty('logLevel')
  })

  it('logSeverity drops an audit record nothing maps', async () => {
    const transport = new TransportLatest({ logSeverity: SeverityNumber.INFO })
    expect(
      await emitted({ otel: { mapAuditLevel: false }, transports: [transport] }, (logger, message) => logger.audit(message)),
    ).toHaveLength(0)
  })

  it('logSeverity keeps an audit record otel maps', async () => {
    const transport = new TransportLatest({ logSeverity: SeverityNumber.INFO })
    expect(await emitted({ otel: true, transports: [transport] }, (logger, message) => logger.audit(message))).toHaveLength(1)
  })
})
