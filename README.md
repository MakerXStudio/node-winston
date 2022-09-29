# Node Winston

A set of [winston](https://github.com/winstonjs/winston) [formats](https://github.com/winstonjs/winston#formats), plus console transport and logger creation functions, to simplify using winston logging using a standard config shape and with pretty coloured YAML log output for local development.

## Creating a Logger

The `createLogger` function combines `omitFormat`, `omitNilFormat` and optionally `prettyConsoleFormat` together to configure the `Console` transport on the returned logger.

| Option           | Description                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `consoleFormat`  | Either `pretty` (useful for local development) or `json` (default)                                                                                                                                                             |
| `consoleOptions` | The `ConsoleTransportOptions` passed into the `Console` transport, useful for setting `silent`, e.g. to switch off output during test runs, per-transport `level` etc.                                                         |
| `loggerOptions`  | The `LoggerOptions` passed into the `Logger`, useful for the `level`, `defaultMeta` and other customisations.                                                                                                                  |
| `loggerOptions`  | The `LoggerOptions` passed into the `Logger`, useful for the `level`, `defaultMeta` and other customisations.                                                                                                                  |
| `omitPaths`      | Paths of fields you wish to omit form logging. For example, during local development you may wish to hide values from `defaultMeta`, e.g. user context which would be omitted in every log entry and irrelevent for local dev. |
| `transports`     | Extra `Transport`s you wish to add to the logger.                                                                                                                                                                              |

At MakerX we generally use config files to support different logging output between local development and deployed environments:

logger.ts

```ts
import { isLocalDev } from '@makerxstudio/node-common'
import { createLogger } from '@makerxstudio/node-winston'
import config from 'config'

const logger = createLogger({
  consoleFormat: isLocalDev ? 'pretty' : 'json',
  consoleOptions: config.get('logging.consoleOptions'),
  loggerOptions: config.get('logging.loggerOptions'),
  omitPaths: config.get('logging.omitPaths'),
})

export default logger
```

This would translate a few runtime scenarios.

```ts
// local development logger would be created something like...
const logger = createLogger({
  consoleFormat: 'pretty',
  loggerOptions: {
    defaultMeta: {
      service: 'my-application-name',
    },
    level: 'verbose',
  },
  omitPaths: ['service'], // defaultMeta.service is set in the default (all environments) config, localdev config strips this from output
})

// deployed environment logger would be created something like...
const logger = createLogger({
  consoleFormat: 'json',
  loggerOptions: {
    defaultMeta: {
      service: 'my-application-name',
    },
    level: 'info',
  },
})

// integration tests could silence noisy console output by setting process.env.SILENT_CONSOLE to 'true'
const logger = createLogger({
  consoleOptions: {
    silent: true,
  },
})
```

All the above scenarios are usually config driven.

## Transports

The `createLogger` method only creates a `Console` transport using the provided options plus applying some defaults.

If you wish to add [other transports](https://github.com/winstonjs/winston/blob/master/docs/transports.md), pass them in via the `transports` option, e.g.

```ts
const logger = createLogger({
  transports: [
    new DailyRotateFile({
      level: 'info',
      filename: 'application-%DATE%.log',
      datePattern: 'YYYY-MM-DD-HH',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
    }),
  ],
})
```

## Formats

`createLogger` applies some default behaviour, chaining `omitNilFormat` and `omitFormat` in front of the final json or coloured YAML format.

- `omitNilFormat` removes null or undefined values from output
- `omitFormat` removes values by path using [lodash omit](https://lodash.com/docs/4.17.15#omit)
- `prettyConsoleFormat` applies the `colorize` and `timestamp` formats before formatting logs as coloured YAML

If you wish to add additional formats, pass them in via the `consoleFormats` option.
