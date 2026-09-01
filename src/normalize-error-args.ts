const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

// Winston reads the arguments after the message as interpolation values rather than metadata when
// the message holds a `util.format` token, and skips merging metadata onto the record altogether:
// `formatRegExp` in `winston/lib/winston/logger.js`, matched by the one in `logform/splat.js`.
// Declared without `g` so `test` stays stateless.
const FORMAT_TOKEN = /%[scdjifoO%]/

/**
 * Rewrites a log call's arguments so an `Error` always arrives as `{ error }` metadata.
 *
 * Winston decides what to do with an `Error` argument in three different places, and the shapes it
 * produces have nothing in common:
 *
 * | Call                              | Record                                                |
 * | --------------------------------- | ----------------------------------------------------- |
 * | `logger.error(err)`               | the record *is* the error                             |
 * | `logger.error(new Error(''))`     | `{ message: err }` — the branch turns on a truthy message |
 * | `logger.error('failed', err)`     | `{ message: 'failed ' + err.message, stack }`, error under `SPLAT` |
 * | `logger.error('failed', { err })` | `{ message: 'failed', error: err }`                   |
 *
 * A format can only see what winston has already built, and by then the first shape has had `level`
 * and `defaultMeta` assigned onto the error itself, and the third has had the error's message
 * concatenated onto the caller's. Normalising the arguments instead means winston only ever sees the
 * last shape, which needs no repair: the error is metadata, and `message` is exactly what the caller
 * passed.
 *
 * `messageIndex` is where the message sits in `args` — 0 for a level method (`logger.error(…)`), 1
 * for `logger.log(level, …)`. Only that position and the metadata position after it are considered;
 * an `Error` further along is a splat interpolation value, which {@link serializeErrorFormat}
 * serializes where it lies.
 *
 * An error taking the message position keeps its own `message` on the record, so the log line still
 * reads as it did. That is the error's own message rather than the configured serializer's view of
 * it: the serializer describes the error under `error`, while `message` is the line the caller is
 * writing.
 *
 * Arguments are never dropped. Metadata already in place is merged with (`{ ...meta, error }`), and
 * anything that is not a plain object — another error, a splat value — has `{ error }` inserted
 * before it rather than over it.
 *
 * A message holding a `util.format` token is left alone: `logger.error('failed: %s', err)` passes
 * the error as an interpolation value, not as metadata, and winston merges nothing onto the record
 * for such a call. Rewriting it would take the error out of the splat position the caller chose, so
 * those keep winston's splat semantics, with the error serialized under `SPLAT` where it lies.
 *
 * An error in the message position gets the same treatment for a different reason: its own message
 * can hold a token by accident, which would have winston read the `{ error }` we just added as an
 * interpolation value and drop it from the record. Those are handed over as `{ message: err }`
 * instead — the shape {@link serializeErrorFormat} already nests, and one winston cannot turn back
 * into a record that is the error.
 */
export const normalizeErrorArgs = (args: unknown[], messageIndex: number): unknown[] => {
  const message = args[messageIndex]
  const metaIndex = messageIndex + 1
  const meta = args[metaIndex]

  if (message instanceof Error) {
    if (FORMAT_TOKEN.test(message.message)) {
      // Only the shapes winston would otherwise resolve to the error itself need rewriting; with a
      // trailing argument it already builds `{ message: err }`, which the format nests.
      if (args.length > metaIndex + 1 || (meta !== undefined && !isPlainObject(meta))) return args
      return [...args.slice(0, messageIndex), { ...meta, message }]
    }
    const next = [...args]
    next[messageIndex] = message.message
    if (meta === undefined || isPlainObject(meta)) next[metaIndex] = { ...meta, error: message }
    else next.splice(metaIndex, 0, { error: message })
    return next
  }

  if (meta instanceof Error) {
    if (typeof message === 'string' && FORMAT_TOKEN.test(message)) return args
    const next = [...args]
    next[metaIndex] = { error: meta }
    return next
  }

  return args
}

/**
 * Installs {@link normalizeErrorArgs} on a winston logger's level methods and `log`.
 *
 * The wrappers are assigned as own properties, shadowing the prototype methods they call, so
 * everything else on the logger — `add`, `remove`, the stream and event APIs — is untouched.
 *
 * `child` needs no wrapping: winston builds a child with `Object.create(logger, { write })`, so the
 * parent instance is the child's prototype and these own properties are on the chain. `this` is
 * forwarded, so a wrapped method called on a child still writes through the child.
 */
export const withNormalizedErrorArgs = <T extends object>(logger: T, levelNames: string[]): T => {
  const target = logger as unknown as Record<string, unknown>

  for (const level of levelNames) {
    const original = target[level]
    if (typeof original !== 'function') continue
    const method = original as (this: unknown, ...args: unknown[]) => unknown
    target[level] = function (this: unknown, ...args: unknown[]) {
      return method.apply(this, normalizeErrorArgs(args, 0))
    }
  }

  const log = target.log
  if (typeof log === 'function') {
    const method = log as (this: unknown, ...args: unknown[]) => unknown
    target.log = function (this: unknown, ...args: unknown[]) {
      // `log(info)` passes the record as one object, where `message` holding an error is a shape
      // `serializeErrorFormat` already covers. Only the positional forms are rewritten.
      return method.apply(this, typeof args[0] === 'string' ? normalizeErrorArgs(args, 1) : args)
    }
  }

  return logger
}
