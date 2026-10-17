/**
 * The README's setup end to end: `WinstonInstrumentation` adds the OpenTelemetry transport to the
 * logger, and `createLogger({ otel: true })` gives that transport the format. The fixture runs in its
 * own process, because the instrumentation must be registered before winston loads.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

interface Exported {
  transports: string[]
  records: { body: string; severityNumber: number; severityText: string; attributes: Record<string, unknown> }[]
  sibling: Record<string, unknown>[]
}

const fixture = fileURLToPath(new URL('./tests/winston-instrumentation.fixture.ts', import.meta.url))

let exported: Exported

beforeAll(() => {
  const stdout = execFileSync(process.execPath, ['--import', 'tsx', fixture], { encoding: 'utf8' })
  exported = JSON.parse(stdout) as Exported
}, 60_000)

describe('createLogger({ otel: true }) with WinstonInstrumentation', () => {
  it('finds the transport the instrumentation adds', () => {
    expect(exported.transports).toContain('OpenTelemetryTransportV3')
  })

  it('exports an audit record at INFO severity, with logLevel audit', () => {
    const audit = exported.records.find((record) => record.body === 'audit line')
    expect(audit).toMatchObject({ severityNumber: 9, attributes: { actor: 'user-1', logLevel: 'audit' } })
  })

  it('records the error as the exception, with the rest of it under errorDetail', () => {
    const error = exported.records.find((record) => record.body === 'error line')
    expect(error?.attributes).toMatchObject({
      'exception.type': 'ProviderError',
      'exception.message': 'Request too large',
      errorDetail: '{"statusCode":413}',
      request: '{"route":"/chat"}',
    })
  })

  it('leaves other transports nested, at their own level', () => {
    expect(exported.sibling).toEqual([
      { level: 'audit', actor: 'user-1' },
      expect.objectContaining({ level: 'error', error: expect.objectContaining({ statusCode: 413 }), request: { route: '/chat' } }),
    ])
  })
})
