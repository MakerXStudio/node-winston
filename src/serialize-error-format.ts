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
 * Puts a serialized error under `error`, and its message in winston's `message` slot.
 *
 * An error's own field names — `name`, `message`, `stack`, `code`, `cause`, `errors` — overlap the
 * record's, where `level`, `defaultMeta` and the caller's metadata live. Spreading the error onto
 * the record makes the two namespaces collide, and either precedence loses something real: the
 * caller winning drops error fields, the error winning drops metadata. A logger carrying
 * `defaultMeta: { name: 'my-service' }` demonstrates it — one of the two names has to go.
 *
 * Nesting removes the overlap rather than arbitrating it, and it makes `logger.error(err)` produce
 * the same record as `logger.error('failed', { error: err })`, which is how most callers already log
 * an error and what {@link serializeErrorFormat} has always done to a nested one. Error detail has a
 * single path in every case: `error.stack`.
 *
 * `message` is still set, because it is winston's own slot rather than error data: `format.printf`
 * and `prettyConsoleFormat` interpolate it, and an object or `undefined` there renders as
 * `[object Object]` or `undefined`. It is taken from the serializer so a custom one that rewrites or
 * redacts the message is respected, and falls back to `''` for one that drops it entirely.
 *
 * A record that carries both a wrapped error and its own `error` key is a shape winston never
 * produces; if a caller builds one, the wrapped error wins, since it is what the log line is about.
 *
 * Both callers hand over a copy of the serializer's output rather than the object itself: a
 * serializer is free to return a frozen record, or a cached one shared between calls.
 */
const nestError = (record: Record<string | symbol, unknown>, serialized: Record<string, unknown>): Record<string | symbol, unknown> => {
  const message = serialized.message
  record.message = typeof message === 'string' ? message : ''
  record.error = serialized
  return record
}

/**
 * Unpicks the record when it is itself an `Error`.
 *
 * `logger.error(err)` takes a winston branch of its own: it assigns `level`, the routing symbols and
 * any `defaultMeta` onto the error and writes the error as the record. `message`, `stack` and `name`
 * are not own enumerable properties of an `Error`, so every transport that spreads or enumerates the
 * record loses them — `{ ...info }` yields neither a message nor a stack.
 *
 * That leaves one object holding both the record and the error. An `Error`'s intrinsic fields are
 * non-enumerable, so its own enumerable keys are the record side of the merge — `level`, the
 * symbols, `defaultMeta`, and anything the thrower attached — and they are carried across to stay
 * where a consumer expects them. The error itself is then nested: see {@link nestError}.
 */
const serializeRecord = (error: Error, serializer: ErrorSerializer): Record<string | symbol, unknown> => {
  // A fresh object rather than the error: the record has to stop being an `Error` instance, or every
  // transport that spreads or enumerates it is back where it started.
  const record: Record<string | symbol, unknown> = {}
  for (const key of Object.keys(error)) record[key] = (error as unknown as Record<string, unknown>)[key]
  for (const symbol of Object.getOwnPropertySymbols(error)) {
    record[symbol] = (error as unknown as Record<symbol, unknown>)[symbol]
  }
  const serialized = { ...serializer(error) }
  // Winston stamped `level` onto the error before any format ran, so the serializer saw it as an own
  // property. It is routing, not error data, and the loop above already put it at record level.
  delete serialized.level
  return nestError(record, serialized)
}

/**
 * Unpicks the record when it holds an `Error` under `message`.
 *
 * This is the other side of the branch {@link serializeRecord} covers.
 * `winston/lib/winston/create-logger.js:78` reads `msg && msg.message && msg || { message: msg }`,
 * so a truthy message makes the error the record and an empty one nests it: `new Error('')`, or an
 * `AggregateError` whose detail is all in `errors`, arrives as `{ message: theError }`. Left alone,
 * the walk below would serialize that nested error correctly but leave it under `message`, where
 * `prettyConsoleFormat` prints `[object Object]` and a transport querying a string message finds an
 * object.
 *
 * The record is already the record here — only the error moves, to the same place
 * {@link serializeRecord} puts it, so one call cannot produce two shapes. Every other key the
 * caller set stays untouched: `{ message: err, requestId }` keeps its `requestId`.
 *
 * The shape can also be passed deliberately rather than built by winston, and there is no way to
 * tell the two apart — both are treated as an error under `message`, since a caller who puts one
 * there wants it logged as an error either way.
 */
const hoistWrappedError = (record: Record<string | symbol, unknown>, serializer: ErrorSerializer): Record<string | symbol, unknown> => {
  const wrapped = record.message
  if (!(wrapped instanceof Error)) return record
  return nestError(record, { ...serializer(wrapped) })
}

/**
 * Walks the log info object, replacing any `Error` instances (including nested ones)
 * with the plain-object result of the configured serializer so downstream formats and
 * transports see JSON-serializable errors with `message` and `stack` intact.
 *
 * `logger.error(err)` reaches this format as one of two shapes, decided by
 * `winston/lib/winston/create-logger.js:78` purely on whether the error's `message` is truthy: the
 * record either *is* the error, or nests it as `{ message: err }`. Both are normalised before the
 * walk runs to the shape a nested error already has — `{ message: <string>, error: { … } }` — so
 * neither depends on which branch winston took: see {@link serializeRecord},
 * {@link hoistWrappedError} and {@link nestError}. Otherwise only the top-level `info` object is
 * mutated (to preserve winston's Symbol-keyed routing props); nested objects and arrays are
 * rebuilt, so caller-supplied metadata references are never mutated.
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
