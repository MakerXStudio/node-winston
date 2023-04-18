import { levels } from 'logform'
import { LEVEL, configs } from 'triple-beam'
import { prettyConsoleFormat, yamlify } from './pretty-console-format'

describe('prettyConsoleFormat', () => {
  it('can be invoked', () => {
    const format = prettyConsoleFormat()
    expect(format).toBeDefined()
  })
  it('allows transform to be invoked', () => {
    // Setup log levels for cli
    levels(configs.cli)
    const format = prettyConsoleFormat()
    format.transform({
      [LEVEL]: 'info',
      level: 'info',
      message: 'Testing testing 123',
    })
  })
})

class MyCustomError extends Error {
  responseJson?: Record<string, unknown>
}

describe('yamlify', () => {
  it('serialises errors', () => {
    const error = new MyCustomError('Some error')
    error.responseJson = {
      details: {
        firstName: 'First name is required',
      },
    }

    const yamlified = yamlify({
      message: 'Something happened',
      error,
    })

    expect(yamlified).toContain('Something happened')
    expect(yamlified).toContain('First name is required')
  })
})
