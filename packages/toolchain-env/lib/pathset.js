/**
 * Pure PATH composition helpers.
 *
 * Everything here is a function of its arguments plus an injectable `exists`,
 * so the composition rules can be tested without touching the real process
 * environment. The plugin owns the one side effect (`writePathValue`) and the
 * decision of when to call these.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const IS_WINDOWS = process.platform === 'win32'

/** Extensions Windows command resolution tries when a bare name has none. */
export const DEFAULT_PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD']

/**
 * Windows environment names are case-insensitive, so every lookup folds case.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {string} name
 * @returns {string | undefined}
 */
export function lookupEnv(env, name) {
  if (!env) return undefined
  const upper = String(name).toUpperCase()
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === upper) {
      const value = env[key]
      return typeof value === 'string' ? value : undefined
    }
  }
  return undefined
}

/**
 * Every key the environment uses for PATH. This machine spells it `Path`; the
 * plugin writes back the keys that already exist instead of inventing `PATH`,
 * because two keys would put two entries in the child environment block.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function pathKeys(env = process.env) {
  return Object.keys(env ?? {}).filter(key => key.toUpperCase() === 'PATH')
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string} the current PATH value, or '' when the process has none
 */
export function readPathValue(env = process.env) {
  const keys = pathKeys(env)
  if (keys.length === 0) return ''
  return String(env[keys[0]] ?? '')
}

/**
 * Write a new PATH value back to every existing PATH-cased key, creating
 * `Path` only when the environment has none.
 * @param {Record<string, string | undefined>} env
 * @param {string} value
 * @returns {string[]} the keys written
 */
export function writePathValue(env, value) {
  const keys = pathKeys(env)
  if (keys.length === 0) {
    env.Path = value
    return ['Path']
  }
  for (const key of keys) env[key] = value
  return keys
}

/**
 * @param {string} value
 * @returns {string}
 */
export function stripTrailingSeparators(value) {
  const resolved = path.resolve(value)
  if (resolved.length <= 1) return resolved
  const stripped = resolved.replace(/[\\/]+$/, '')
  if (stripped === '') return resolved
  // Keep a drive root (`C:\`) intact; `C:` is not the same directory.
  if (IS_WINDOWS && resolved.length <= 3) return resolved
  return stripped
}

/**
 * Expand one configured or discovered directory entry.
 *
 * Supported forms: `%VAR%` (case-insensitive, from the process environment),
 * a leading `~`, and absolute paths. A relative path is refused rather than
 * resolved against whatever the current directory happens to be.
 *
 * @param {string} entry
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {{ path: string } | { error: string }}
 */
export function expandEntry(entry, env = process.env) {
  if (typeof entry !== 'string') return { error: 'entry is not a string' }
  let value = entry.trim()
  if (value === '') return { error: 'entry is empty' }
  if (value === '~') value = os.homedir()
  else if (value.startsWith('~/') || value.startsWith('~\\')) value = path.join(os.homedir(), value.slice(2))

  let missing = null
  value = value.replace(/%([^%]+)%/g, (match, name) => {
    const resolved = lookupEnv(env, name)
    if (resolved === undefined || resolved === '') {
      missing = name
      return match
    }
    return resolved
  })
  if (missing !== null) return { error: `unresolved variable %${missing}%` }
  if (!path.isAbsolute(value)) return { error: `not an absolute path: ${value}` }
  return { path: stripTrailingSeparators(value) }
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeDir(value) {
  return stripTrailingSeparators(String(value))
}

/**
 * Comparison key: resolved, trailing separators removed, case-folded on
 * Windows (where `C:\Foo` and `c:\foo` are one directory).
 * @param {string} value
 * @returns {string}
 */
export function keyOf(value) {
  const normalized = normalizeDir(value)
  return IS_WINDOWS ? normalized.toLowerCase() : normalized
}

/**
 * Split a PATH value into entries, dropping empty segments.
 *
 * An empty entry means "the current directory" to Windows resolution, which is
 * a liability rather than a toolchain, so it is dropped and reported by the
 * plugin instead of being preserved.
 * @param {string} value
 * @returns {string[]}
 */
export function splitPathList(value) {
  return String(value ?? '').split(path.delimiter).filter(entry => entry !== '')
}

/**
 * @param {readonly string[]} list
 * @returns {string}
 */
export function joinPathList(list) {
  return list.join(path.delimiter)
}

/**
 * Executable extensions, in the order Windows tries them.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function pathextList(env = process.env) {
  const raw = lookupEnv(env, 'PATHEXT')
  const parts = String(raw ?? '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
  const list = parts.length > 0 ? parts : DEFAULT_PATHEXT
  const seen = new Set()
  const out = []
  for (const ext of list) {
    const withDot = ext.startsWith('.') ? ext : `.${ext}`
    const folded = withDot.toUpperCase()
    if (seen.has(folded)) continue
    seen.add(folded)
    out.push(withDot)
  }
  return out
}

/**
 * Resolve a command the way the managed shell will.
 *
 * PowerShell searches each PATH directory in order and, inside a directory,
 * tries the bare name and then each PATHEXT extension; the first hit wins. This
 * returns every directory's winner in order, so the first element is what would
 * actually run and the rest explain what lies behind it.
 *
 * @param {string} command bare name or a path
 * @param {string} pathValue PATH value to search
 * @param {{ pathext?: readonly string[], exists?: (candidate: string) => boolean }} [options]
 * @returns {{ path: string, dir: string }[]}
 */
export function whichList(command, pathValue, options = {}) {
  const exists = options.exists ?? fs.existsSync
  const extensions = options.pathext ?? pathextList()
  const raw = String(command ?? '').trim()
  if (raw === '') return []

  // PowerShell only runs a name with an executable extension on Windows, so an
  // extensionless file in a PATH directory (npm packages ship POSIX shell
  // shims too) must not win. A dot inside a name is not an extension unless
  // PATHEXT knows it: `python3.11` still resolves as `python3.11.exe`.
  const namesFor = (name) => {
    if (!IS_WINDOWS) return [name]
    const extension = path.extname(name)
    const known = extension !== '' && extensions.some(ext => ext.toUpperCase() === extension.toUpperCase())
    return known ? [name] : extensions.map(ext => name + ext)
  }

  const looksLikePath = /[\\/]/.test(raw) || /^[a-zA-Z]:/.test(raw)
  if (looksLikePath) {
    const candidate = path.resolve(raw)
    for (const name of namesFor(candidate)) {
      if (exists(name)) return [{ path: name, dir: path.dirname(name) }]
    }
    return []
  }

  const out = []
  const seen = new Set()
  for (const dir of splitPathList(pathValue)) {
    for (const name of namesFor(raw)) {
      const candidate = path.join(dir, name)
      const key = IS_WINDOWS ? candidate.toLowerCase() : candidate
      if (seen.has(key)) continue
      if (!exists(candidate)) continue
      seen.add(key)
      out.push({ path: candidate, dir })
      break
    }
  }
  return out
}

/**
 * Rebuild the PATH value from its baseline.
 *
 * Rebuilding (rather than appending to the live value) is what makes repeated
 * activation idempotent: the entries added last time are removed first, so a
 * reload cannot stack duplicates. `wanted` entries already present in the
 * baseline are skipped, so the plugin never claims an entry it did not add and
 * therefore never removes one either.
 *
 * @param {{
 *   baseline: string,
 *   previousAdded?: readonly { path: string }[],
 *   wanted?: readonly { path: string }[],
 *   position?: 'append' | 'prepend',
 * }} input
 * @returns {{ value: string, added: { path: string }[] }}
 */
export function composePath({ baseline, previousAdded = [], wanted = [], position = 'append' }) {
  const previousKeys = new Set(previousAdded.map(item => keyOf(item.path)))
  const base = splitPathList(baseline).filter(entry => !previousKeys.has(keyOf(entry)))
  const present = new Set(base.map(entry => keyOf(entry)))

  const added = []
  const addedKeys = new Set()
  for (const item of wanted) {
    const key = keyOf(item.path)
    if (present.has(key) || addedKeys.has(key)) continue
    addedKeys.add(key)
    added.push(item)
  }

  const values = position === 'prepend'
    ? [...added.map(item => item.path), ...base]
    : [...base, ...added.map(item => item.path)]
  return { value: joinPathList(values), added }
}

/**
 * Split a PATH value into segments with empty ones counted separately.
 * @param {string} value
 * @returns {{ segments: string[], emptySegments: number }}
 */
export function inspectPathValue(value) {
  const parts = String(value ?? '').split(path.delimiter)
  if (parts.length === 1 && parts[0] === '') return { segments: [], emptySegments: 0 }
  const segments = parts.filter(entry => entry !== '')
  return { segments, emptySegments: parts.length - segments.length }
}
