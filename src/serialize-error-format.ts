import { TransformableInfo } from 'logform'
import { SPLAT } from 'triple-beam'
import { format } from 'winston'
import { ErrorSerializer, serializeError } from './serialize-error'

export interface SerializeErrorFormatOptions {
  /**
   * Custom serializer used to turn each `Error` instance into a plain object.
   * Defaults to the library's {@link serializeError}.
   */
  serializer?: ErrorSerializer
}

const isPlainObject = (value: object) => {
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

/**
 * Substitutes serialized errors inside the raw splat arguments, and changes nothing else.
 *
 * The main walk rebuilds every object it visits as a plain record, which is what metadata bound for
 * a transport needs. `SPLAT` is not metadata: `format.splat()` interpolates it into the message, so
 * a `Date` or a `Map` has to arrive as itself — rebuilt as a plain record it holds no own
 * enumerable keys, and `%j` would render `{}` in place of its value. So this recurses through
 * arrays and plain objects only, and rebuilds one only when it really holds an error. Anything
 * untouched comes back as the same reference, and a container that must be rebuilt keeps its
 * prototype and every own key the rebuild did not replace.
 *
 * `rebuilt` maps each source container to its replacement, so a back-edge resolves to the
 * replacement rather than to the unprocessed source — otherwise a rebuilt branch would link back to
 * the original and leave a live error reachable through the cycle. A container reached twice
 * without a cycle resolves to the same replacement both times, which keeps shared references
 * shared.
 */
/**
 * Whether an error is reachable from a splat argument, so {@link replaceErrors} runs only where it
 * has something to do.
 *
 * A container is marked `false` while it is being examined, which cuts cycles: going back round one
 * reaches nothing the walk is not already looking at. That makes an in-progress entry pessimistic
 * for a sibling asked later, so this is only ever asked about a whole argument — the node holding
 * the error always finishes examining its own keys, and the answer for the argument is right.
 */
const holdsError = (value: unknown, seen: Map<object, boolean>): boolean => {
  if (value instanceof Error) return true
  if (!value || typeof value !== 'object') return false
  const known = seen.get(value)
  if (known !== undefined) return known
  if (!Array.isArray(value) && !isPlainObject(value)) return false

  seen.set(value, false)
  const source = value as Record<string, unknown>
  const found = Array.isArray(value)
    ? value.some((entry) => holdsError(entry, seen))
    : Object.keys(source).some((key) => holdsError(source[key], seen))
  seen.set(value, found)
  return found
}

/**
 * Carries across every own key the rebuild did not visit — symbols, non-enumerable properties, an
 * array's non-index properties — so a container rebuilt to replace an error inside it keeps
 * everything the replacement did not touch. `length` is skipped: an array manages its own.
 */
const carryOverUnvisited = <T extends object>(out: T, source: object, visited: Set<PropertyKey>): T => {
  for (const key of Reflect.ownKeys(source)) {
    if (visited.has(key)) continue
    if (Array.isArray(source) && key === 'length') continue
    Object.defineProperty(out, key, Object.getOwnPropertyDescriptor(source, key) as PropertyDescriptor)
  }
  return out
}

const replaceErrors = (value: unknown, serializer: ErrorSerializer, rebuilt: Map<object, unknown>): unknown => {
  if (value instanceof Error) return serializer(value)
  if (!value || typeof value !== 'object') return value
  if (rebuilt.has(value)) return rebuilt.get(value)
  if (!Array.isArray(value) && !isPlainObject(value)) return value

  const visited = new Set<PropertyKey>()

  if (Array.isArray(value)) {
    const out: unknown[] = []
    rebuilt.set(value, out)
    let replaced = false
    for (let index = 0; index < value.length; index++) {
      out[index] = replaceErrors(value[index], serializer, rebuilt)
      visited.add(String(index))
      if (out[index] !== value[index]) replaced = true
    }
    // `replaced` is true whenever a back-edge was taken, because the replacement it resolved to is
    // not the source. So an unreplaced container never has one pointing at its discarded copy.
    if (!replaced) rebuilt.set(value, value)
    return replaced ? carryOverUnvisited(out, value, visited) : value
  }

  const source = value as Record<string, unknown>
  // Built on the source's own prototype, so a null-prototype argument stays one.
  const out = Object.create(Object.getPrototypeOf(value) as object | null) as Record<string, unknown>
  rebuilt.set(value, out)
  let replaced = false
  for (const key of Object.keys(source)) {
    out[key] = replaceErrors(source[key], serializer, rebuilt)
    visited.add(key)
    if (out[key] !== source[key]) replaced = true
  }
  if (!replaced) rebuilt.set(value, value)
  return replaced ? carryOverUnvisited(out, value, visited) : value
}

/**
 * Replaces the record itself when it is an `Error`.
 *
 * `logger.error(err)` takes a winston branch of its own: it assigns `level` and the routing symbols
 * onto the error and writes the error as the record. `message`, `stack` and `name` are not own
 * enumerable properties of an `Error`, so every transport that spreads or enumerates the record
 * loses them — `{ ...info }` yields neither a message nor a stack. Serializing lifts them onto a
 * plain object.
 *
 * `level` and every own symbol are re-applied afterwards: they are winston's routing, not error
 * data, and a custom serializer has no reason to return them. `message` is left to the serializer,
 * so one that drops it produces a record without one, exactly as it already does for a nested
 * error.
 */
const serializeRecord = (error: Error, serializer: ErrorSerializer): Record<string | symbol, unknown> => {
  // Copied, never mutated in place: a serializer is free to return a frozen record, or a cached one
  // shared between calls, and stamping routing onto either would throw or leak.
  const record = { ...serializer(error) } as Record<string | symbol, unknown>
  // Guarded because `serializeErrorFormat` is also usable outside `createLogger`, on a record
  // winston has not stamped a level onto.
  if ('level' in error) record.level = (error as unknown as { level: unknown }).level
  for (const symbol of Object.getOwnPropertySymbols(error)) {
    record[symbol] = (error as unknown as Record<symbol, unknown>)[symbol]
  }
  return record
}

/**
 * Lifts an `Error` out from under `message`.
 *
 * `logger.error(err)` on an error whose `message` is falsy takes the other side of the branch
 * {@link serializeRecord} covers. `winston/lib/winston/create-logger.js:78` reads
 * `msg && msg.message && msg || { message: msg }`, so a truthy message makes the error the record
 * and an empty one nests it: `new Error('')`, or an `AggregateError` whose detail is all in
 * `errors`, arrives as `{ message: theError }`. Left alone, the walk below would serialize that
 * nested error correctly but leave it under `message`, where `prettyConsoleFormat` prints
 * `[object Object]` and a transport querying a string message finds an object.
 *
 * Serializing it and spreading the result onto the record puts `message`, `name` and `stack` where
 * the root-error case already puts them. Only `message` is taken from the serializer: every other
 * key the caller already set wins, so `{ message: err, requestId }` keeps its `requestId`. The
 * shape can also be passed deliberately rather than built by winston, and there is no way to tell
 * the two apart — both are treated as an error under `message`, since a caller who puts one there
 * wants it logged as an error either way.
 *
 * Not {@link serializeRecord}: that lifts `level` and the routing symbols off the *error*, and here
 * they are on the record already.
 */
const hoistWrappedError = (record: Record<string | symbol, unknown>, serializer: ErrorSerializer): Record<string | symbol, unknown> => {
  const wrapped = record.message
  if (!(wrapped instanceof Error)) return record

  const serialized = serializer(wrapped)
  // Removed first, so a serializer that returns no `message` leaves the record without one rather
  // than keeping the live error — the same outcome it already produces for a nested error.
  delete record.message
  for (const [key, value] of Object.entries(serialized)) {
    if (!(key in record)) record[key] = value
  }
  return record
}

/**
 * Walks the log info object, replacing any `Error` instances (including nested ones)
 * with the plain-object result of the configured serializer so downstream formats and
 * transports see JSON-serializable errors with `message` and `stack` intact.
 *
 * `logger.error(err)` reaches this format as one of two shapes, decided by
 * `winston/lib/winston/create-logger.js:78` purely on whether the error's `message` is truthy: the
 * record either *is* the error, or nests it as `{ message: err }`. Both are flattened onto the
 * record before the walk runs — see {@link serializeRecord} and {@link hoistWrappedError}.
 * Otherwise only the top-level `info` object is mutated (to preserve winston's Symbol-keyed
 * routing props); nested objects and arrays are rebuilt, so caller-supplied metadata
 * references are never mutated.
 *
 * Errors under the `SPLAT` symbol are replaced too. Winston keeps the raw metadata argument there
 * in addition to merging its properties onto `info`, so an `Error` logged as
 * `logger.error(msg, { error })` is reachable twice, and serializing only the string keys leaves
 * the live `Error` under `SPLAT` for every later format to trip over. `SPLAT` is treated more
 * gently than the rest of the record: see {@link replaceErrors}.
 */
export const serializeErrorFormat = format((info, opts) => {
  const serializer = (opts as SerializeErrorFormatOptions | undefined)?.serializer ?? serializeError
  const walk = (value: unknown, seen: WeakSet<object>): unknown => {
    if (value instanceof Error) return serializer(value)
    if (!value || typeof value !== 'object') return value
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    try {
      if (Array.isArray(value)) return value.map((v) => walk(v, seen))
      const source = value as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(source)) out[key] = walk(source[key], seen)
      return out
    } finally {
      seen.delete(value)
    }
  }
  const record = (info instanceof Error
    ? serializeRecord(info, serializer)
    : hoistWrappedError(info as unknown as Record<string | symbol, unknown>, serializer)) as unknown as Record<string | symbol, unknown>
  const seen = new WeakSet<object>([record])
  for (const key of Object.keys(record)) record[key] = walk(record[key], seen)
  const splat = record[SPLAT]
  if (Array.isArray(splat)) {
    // Gated per argument. A cyclic container always takes a back-edge to its replacement, which
    // counts as a change, so without this an argument holding no error at all would be rebuilt —
    // losing its identity and any symbol or non-enumerable property with it.
    const rebuilt = new Map<object, unknown>()
    const next = splat.map((value) => (holdsError(value, new Map<object, boolean>()) ? replaceErrors(value, serializer, rebuilt) : value))
    if (next.some((value, index) => value !== splat[index])) record[SPLAT] = next
  }
  return record as unknown as TransformableInfo
})
