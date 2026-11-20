/**
 * The panel-managed toolchain list, and the merged plan it produces.
 *
 * The panel edits one string field (`toolchainEntries`), so the on-disk form
 * has to be readable by a human as well as parseable. One entry per line:
 *
 *     id | path | note
 *
 * `path` accepts `%VAR%` and a leading `~` (the same expansion as
 * `pathEntries`). A leading `!` disables the line without deleting it, which is
 * what the panel's per-row checkbox writes. `#` starts a comment.
 *
 * The single-field and two-field forms are accepted so a hand-written list does
 * not have to invent an id:
 *
 *     C:\Tools                       # path only
 *     C:\Tools | local tools         # path | note
 *     fnm | %APPDATA%\fnm\aliases\default | Node via fnm
 *     !pnpm | %LOCALAPPDATA%\pnpm\bin | disabled for now
 *
 * Everything here is a function of its arguments plus an injectable `exists`,
 * so the merge rules can be tested without touching the real environment.
 */

import fs from 'node:fs'
import { planWanted } from './discover.js'
import { expandEntry, keyOf } from './pathset.js'

/** A leading `!` marks a disabled line. No valid Windows or POSIX path starts with it. */
const DISABLED_PREFIX = '!'

/**
 * Does this text look like a directory rather than an id or a note?
 *
 * It decides the two-field form (`path | note` versus `id | path`), so it errs
 * towards "path" only when there is a separator, a Windows drive, a UNC prefix,
 * an env reference or a home shorthand.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function looksLikePath(value) {
  const text = String(value ?? '').trim()
  if (text === '') return false
  if (text === '~' || text.startsWith('~/') || text.startsWith('~\\')) return true
  if (/%[^%]+%/.test(text)) return true
  if (/^[a-zA-Z]:[\\/]/.test(text)) return true
  if (text.startsWith('\\\\') || text.startsWith('//')) return true
  if (text.startsWith('/')) return true
  return /[\\/]/.test(text)
}

/**
 * Parse one `toolchainEntries` field value.
 *
 * @param {unknown} text
 * @returns {{ id: string, path: string, note: string, enabled: boolean, raw: string }[]}
 */
export function parseToolchainEntries(text) {
  /** @type {{ id: string, path: string, note: string, enabled: boolean, raw: string }[]} */
  const rows = []
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const raw = rawLine.trim()
    if (raw === '' || raw.startsWith('#')) continue

    let line = raw
    let enabled = true
    if (line.startsWith(DISABLED_PREFIX)) {
      enabled = false
      line = line.slice(DISABLED_PREFIX.length).trim()
    }
    if (line === '') continue

    const parts = line.split('|').map(part => part.trim())
    let id = ''
    let pathText = ''
    let note = ''

    if (parts.length === 1) {
      pathText = parts[0]
    } else if (parts.length === 2) {
      // `path | note` when the first field is a directory and the second is not;
      // otherwise `id | path`.
      if (looksLikePath(parts[0]) && !looksLikePath(parts[1])) {
        pathText = parts[0]
        note = parts[1]
      } else {
        id = parts[0]
        pathText = parts[1]
      }
    } else {
      // An `id | path | note` line has a path in the second field; a
      // `path | note` line whose note itself contains a pipe keeps the path first.
      if (looksLikePath(parts[0]) && !looksLikePath(parts[1])) {
        pathText = parts[0]
        note = parts.slice(1).join(' | ')
      } else {
        id = parts[0]
        pathText = parts[1]
        note = parts.slice(2).join(' | ')
      }
    }

    if (pathText === '') continue
    rows.push({ id, path: pathText, note, enabled, raw })
  }
  return rows
}

/**
 * Render rows back into the field value. The inverse of
 * `parseToolchainEntries` for every form it produces.
 *
 * @param {{ id?: string, path?: string, note?: string, enabled?: boolean }[]} rows
 * @returns {string}
 */
export function serializeToolchainEntries(rows) {
  const lines = []
  for (const row of rows ?? []) {
    const pathText = String(row?.path ?? '').trim()
    if (pathText === '') continue
    const id = String(row?.id ?? '').trim()
    const note = String(row?.note ?? '').trim()
    const disabled = row?.enabled === false
    const head = disabled
      ? (id === '' ? `${DISABLED_PREFIX}${pathText}` : `${DISABLED_PREFIX}${id} | ${pathText}`)
      : (id === '' ? pathText : `${id} | ${pathText}`)
    lines.push(note === '' ? head : `${head} | ${note}`)
  }
  return lines.join('\n')
}

/**
 * The effective `position`: the panel value wins when it names one, otherwise
 * the configured `position` stays authoritative, so an existing
 * `cordis.patch.yml` that sets `position: prepend` keeps working until someone
 * picks a value in the panel.
 *
 * @param {{ panel?: unknown, configured?: unknown }} input
 * @returns {{ value: 'append' | 'prepend', source: 'panel' | 'config' }}
 */
export function resolvePosition({ panel, configured } = {}) {
  const picked = String(panel ?? '').trim().toLowerCase()
  if (picked === 'append' || picked === 'prepend') {
    return { value: picked, source: 'panel' }
  }
  return { value: String(configured ?? '').trim().toLowerCase() === 'prepend' ? 'prepend' : 'append', source: 'config' }
}

/**
 * Normalize the input of the merge: the config field is a string, but tests and
 * a future array-shaped config can pass rows.
 *
 * @param {unknown} input
 * @returns {{ id: string, path: string, note: string, enabled: boolean }[]}
 */
function normalizeRows(input) {
  if (Array.isArray(input)) {
    return input
      .map(item => ({
        id: String(item?.id ?? '').trim(),
        path: String(item?.path ?? '').trim(),
        note: String(item?.note ?? '').trim(),
        enabled: item?.enabled !== false,
      }))
      .filter(row => row.path !== '')
  }
  return parseToolchainEntries(input)
}

/**
 * Build the effective list of directories to add.
 *
 * Order is the source order — legacy `pathEntries`, the discovery table, the
 * panel list, then the auto-scan directories — because `prepend` puts the whole
 * set in front of the baseline, and the first occurrence of a directory wins
 * the dedupe.
 *
 * A directory claimed twice is added once: the later source never resurrects an
 * entry the earlier source already contributed, so the panel list can contain a
 * manager directory without duplicating it on PATH.
 *
 * @param {{
 *   pathEntries?: readonly string[],
 *   managers?: readonly string[],
 *   discover?: boolean,
 *   toolchainEntries?: string | readonly { id?: string, path?: string, note?: string, enabled?: boolean }[],
 *   scanEntries?: readonly { path?: string, manager?: string, id?: string, exists?: boolean }[],
 *   autoScan?: boolean,
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   exists?: (candidate: string) => boolean,
 * }} [options]
 * @returns {{
 *   wanted: { path: string, source: string }[],
 *   missing: { entry: string, source: string }[],
 *   unresolved: { entry: string, source: string, reason: string }[],
 *   rows: { id: string, path: string, note: string, enabled: boolean }[],
 * }}
 */
export function planToolchain({
  pathEntries = [],
  managers = [],
  discover = true,
  toolchainEntries = '',
  scanEntries = [],
  autoScan = true,
  env = process.env,
  exists = fs.existsSync,
} = {}) {
  const base = planWanted({ pathEntries, managers, discover, env, exists })
  const wanted = [...base.wanted]
  const missing = [...base.missing]
  const unresolved = [...base.unresolved]
  const rows = normalizeRows(toolchainEntries)
  const seen = new Set(wanted.map(item => keyOf(item.path)))

  const claim = (dirPath, source) => {
    const key = keyOf(dirPath)
    if (seen.has(key)) return
    seen.add(key)
    wanted.push({ path: dirPath, source })
  }

  for (const row of rows) {
    if (!row.enabled) continue
    const source = row.id === '' ? 'entry' : `entry:${row.id}`
    const expanded = expandEntry(row.path, env)
    if (expanded.error) {
      unresolved.push({ entry: row.path, source, reason: expanded.error })
      continue
    }
    if (!exists(expanded.path)) {
      missing.push({ entry: expanded.path, source })
      continue
    }
    claim(expanded.path, source)
  }

  if (autoScan) {
    for (const item of scanEntries ?? []) {
      if (!item || item.exists !== true) continue
      const expanded = expandEntry(String(item.path ?? ''), env)
      if (expanded.error) continue
      // `scan:` rather than `manager:` so the audit trail distinguishes a
      // directory the panel's auto-discovery contributed from one the static
      // discovery table contributed.
      claim(expanded.path, `scan:${item.manager ?? item.id ?? 'unknown'}`)
    }
  }

  return { wanted, missing, unresolved, rows }
}
