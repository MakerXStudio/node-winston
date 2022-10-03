# Node Winston

A set of [winston](https://github.com/winstonjs/winston) [formats](https://github.com/winstonjs/winston#formats), console transport and logger creation functions.

Simplifies using winston logging and provides coloured YAML log output for local development.

## Creating a Logger

The `createLogger` function combines `omitFormat`, `omitNilFormat` and optionally `prettyConsoleFormat` together to configure the `Console` transport for the returned logger.

| Option           | Description                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `consoleFormat`  | Either `pretty` (useful for local development) or `json` (default)                                                                                                                                                             |
| `consoleOptions` | The `ConsoleTransportOptions` passed into the `Console` transport, useful for setting `silent`, e.g. to switch off output during test runs, per-transport `level` etc.                                                         |
| `loggerOptions`  | The `LoggerOptions` passed into the `Logger`, useful for the `level`, `defaultMeta` and other customisations.                                                                                                                  |
| `loggerOptions`  | The `LoggerOptions` passed into the `Logger`, useful for the `level`, `defaultMeta` and other customisations.                                                                                                                  |
| `omitPaths`      | Paths of fields you wish to omit form logging. For example, during local development you may wish to hide values from `defaultMeta`, e.g. user context which would be omitted in every log entry and irrelevent for local dev. |
| `transports`     | Extra `Transport`s you wish to add to the logger.                                                                                                                                                                              |

At MakerX we generally use config files to control logging output across local development and deployed environments:

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

This would translate into different runtime configurations:

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

## Transports

The `createLogger` method creates (only) a `Console` transport.

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
- `omitFormat` removes values by path using [lodash omit](https://lodash.com/docs/4.17.15#omit) (see docs for path specification)
- `prettyConsoleFormat` applies the `colorize` and `timestamp` formats before formatting logs as coloured YAML

If you wish to add additional formats, pass them in via the `consoleFormats` option.

### Error serialization

The `Error` class's `message` and `stack` properties [are not enumerable](https://stackoverflow.com/questions/18391212/is-it-not-possible-to-stringify-an-error-using-json-stringify); the output of `JSON.stringify(new Error('message'))` is `'{}'`.

Winston has some special handling, so that when an error is the first or second argument, message and stack props are logged:

```ts
logger.log(new Error('cause')) // {message: 'cause', stack: ...}
logger.log('message', new Error('cause')) // {message: 'message cause', stack: ...}
```

However, when errors are nested in structured log data, message and stack props are lost:

```ts
catch (error) {
  logger.log('message', { info, error }) // {message: 'message', error: {}}
}
```

Winston [logform](https://github.com/winstonjs/logform) uses [safe-stable-stringify](https://www.npmjs.com/package/safe-stable-stringify) which supports a `replacer`, similar to `JSON.stringify`.

In `createLogger` we use `serializableErrorReplacer` via the JSON format options to ensure that the `message` and `stack` properties of errors are serialized to error logs:

```ts
format.json({ replacer: serializableErrorReplacer })
```
