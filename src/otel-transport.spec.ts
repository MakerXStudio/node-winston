/**
 * What a record looks like once it is an OpenTelemetry log record, through the real
 * `@opentelemetry/winston-transport` and the logs SDK — the row a backend stores.
 *
 * Three transport lines, installed side by side under npm aliases:
 * - 0.27: no exception handling; every attribute is passed through as it is.
 * - 0.31: lifts `err`/`error` off the record as the exception (from 0.29).
 * - 0.34: also normalises object attributes into nested maps, errors included (from 0.32).
 *
 * Each transport binds its logger when it is constructed, so the provider is registered first.
 */
import { logs } from '@opentelemetry/api-logs'
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { OpenTelemetryTransportV3 as Transport034 } from '@opentelemetry/winston-transport'
import { OpenTelemetryTransportV3 as Transport027 } from 'otel-winston-transport-0.27'
import { OpenTelemetryTransportV3 as Transport031 } from 'otel-winston-transport-0.31'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type TransportStream from 'winston-transport'
import { CallbackTransport, createLogger, type CreateLoggerOptions } from './index'
import { otelAttributesFormat } from './otel-attributes-format'

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

let sequence = 0

/** Logs one error line through a fresh logger on `Transport` and returns its exported attributes. */
async function exported(Transport: TransportClass, options: Partial<CreateLoggerOptions> = {}, transport?: TransportStream) {
  const message = `line ${++sequence}`
  const logger = createLogger({ consoleOptions: { silent: true }, transports: [transport ?? new Transport()], ...options })
  logger.error(message, { error: failure(), at, request: { route: '/chat', attempt: 2 } })
  await new Promise((resolve) => setImmediate(resolve))
  const records = exporter.getFinishedLogRecords().filter((record) => record.body === message)
  expect(records).toHaveLength(1)
  return records[0].attributes as Record<string, unknown>
}

const isScalar = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value)

describe('flatten: true', () => {
  it('0.27 writes the error as one JSON attribute holding its message and status', async () => {
    const attributes = await exported(Transport027, { flatten: true })
    expect(JSON.parse(attributes.error as string)).toMatchObject({ message: 'Request too large', statusCode: 413 })
    expect(attributes).not.toHaveProperty('exception.message')
  })

  it.each([
    ['0.31', Transport031],
    ['0.34', Transport034],
  ])(
    '%s records the whole error JSON as exception.message, which is why flatten: true is for transports before 0.29',
    async (_, Transport) => {
      const attributes = await exported(Transport, { flatten: true })
      expect(String(attributes['exception.message']).startsWith('{')).toBe(true)
      expect(attributes).not.toHaveProperty('exception.type')
    },
  )
})

describe('no flatten', () => {
  it('0.34 records the exception but drops the rest of the error', async () => {
    const attributes = await exported(Transport034)
    expect(attributes['exception.message']).toBe('Request too large')
    expect(JSON.stringify(attributes)).not.toContain('413')
  })
})

describe.each([
  ['0.31', Transport031],
  ['0.34', Transport034],
])("flatten: 'otel' on %s", (_, Transport) => {
  it('records the error as exception.type, exception.message and exception.stacktrace', async () => {
    const attributes = await exported(Transport, { flatten: 'otel' })
    expect(attributes).toMatchObject({ 'exception.type': 'ProviderError', 'exception.message': 'Request too large' })
    expect(String(attributes['exception.stacktrace'])).toContain('Request too large')
  })

  it("records the error's cause as error.cause.message", async () => {
    expect((await exported(Transport, { flatten: 'otel' }))['error.cause.message']).toBe('body exceeds limit')
  })

  it("keeps the error's status, provider data and cause chain under errorDetail", async () => {
    const attributes = await exported(Transport, { flatten: 'otel' })
    expect(JSON.parse(attributes.errorDetail as string)).toMatchObject({
      statusCode: 413,
      data: { error: { code: 'request_too_large' } },
      cause: { message: 'body exceeds limit' },
    })
  })

  it('writes every attribute as a scalar, none of them [object Object]', async () => {
    const attributes = await exported(Transport, { flatten: 'otel' })
    expect(Object.values(attributes).every(isScalar)).toBe(true)
    expect(Object.values(attributes)).not.toContain('[object Object]')
  })

  it('writes other objects as JSON strings and a Date as its ISO string', async () => {
    const attributes = await exported(Transport, { flatten: 'otel' })
    expect(attributes.request).toBe('{"route":"/chat","attempt":2}')
    expect(attributes.at).toBe('2026-01-02T03:04:05.000Z')
  })
})

describe('otelAttributesFormat on the transport', () => {
  it('flattens what the OpenTelemetry transport receives and leaves other transports nested', async () => {
    const seen: Record<string, unknown>[] = []
    const sibling = new CallbackTransport(
      async ({ meta }) => void seen.push(meta),
      () => undefined,
    )
    const message = `line ${++sequence}`
    const logger = createLogger({
      consoleOptions: { silent: true },
      transports: [new Transport034({ format: otelAttributesFormat() }), sibling],
    })
    logger.error(message, { error: failure(), request: { route: '/chat' } })
    await new Promise((resolve) => setImmediate(resolve))

    const [record] = exporter.getFinishedLogRecords().filter((r) => r.body === message)
    expect(record.attributes).toMatchObject({ 'exception.type': 'ProviderError', request: '{"route":"/chat"}' })
    expect(seen[0].request).toEqual({ route: '/chat' })
    expect(seen[0].error).toMatchObject({ statusCode: 413 })
  })
})
