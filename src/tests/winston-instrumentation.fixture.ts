/**
 * Run in its own process by ../winston-instrumentation.spec.ts, because the instrumentation patches
 * winston only when it is registered before winston loads. Set up as an app's tracing module is,
 * then logs through `createLogger({ otel: true })` and prints what each side received as JSON.
 */
import { register } from 'node:module'
import { logs } from '@opentelemetry/api-logs'
import { WinstonInstrumentation } from '@opentelemetry/instrumentation-winston'
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs'

const exporter = new InMemoryLogRecordExporter()
logs.setGlobalLoggerProvider(new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] }))
new WinstonInstrumentation()
// This package is ESM, so winston is loaded by `import`, which only this hook can patch. `include`
// limits the hook to winston, so it does not try to wrap this package's TypeScript source.
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url, { data: { include: ['winston'] } })

// Loaded after the instrumentation, so winston loads after it too.
const { CallbackTransport, createLogger } = await import('../index')

class ProviderError extends Error {
  readonly name = 'ProviderError'
  readonly statusCode = 413
}

const sibling: Record<string, unknown>[] = []
const logger = createLogger({
  otel: true,
  consoleOptions: { silent: true },
  transports: [
    new CallbackTransport(
      async ({ level, meta }) => void sibling.push({ level, ...meta }),
      () => undefined,
    ),
  ],
})

logger.audit('audit line', { actor: 'user-1' })
logger.error('error line', { error: new ProviderError('Request too large'), request: { route: '/chat' } })
await new Promise((resolve) => setImmediate(resolve))

process.stdout.write(
  JSON.stringify({
    transports: (logger as unknown as { transports: object[] }).transports.map((transport) => transport.constructor.name),
    records: exporter.getFinishedLogRecords().map(({ body, severityNumber, severityText, attributes }) => ({
      body,
      severityNumber,
      severityText,
      attributes,
    })),
    sibling,
  }),
)
