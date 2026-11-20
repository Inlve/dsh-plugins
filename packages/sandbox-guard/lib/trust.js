/**
 * Trusted-root classification for the sandbox write grant.
 *
 * A trusted root receives the same capability ACE and Low integrity label the
 * workspace root carries, which makes confined commands able to write it. That
 * is a real widening of the sandbox boundary: the label lowers the directory's
 * integrity level, so ANY low-integrity process of this user may write it, not
 * only DSH. The classifier therefore hard-refuses paths where that turns into an
 * escalation path, and flags the rest so the caller can demand an explicit
 * acknowledgement before granting.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const IS_WINDOWS = process.platform === 'win32'
const EXECUTABLE_NAME = /\.(exe|com|bat|cmd|ps1|vbs|cpl|msi)$/i

/** Resolved, case-folded-on-Windows comparison key. */
function keyOf(value) {
  const resolved = path.resolve(value)
  return IS_WINDOWS ? resolved.toLowerCase() : resolved
}

function samePath(a, b) {
  return keyOf(a) === keyOf(b)
}

/** True when `child` lives strictly inside `parent`. */
function isInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function isDriveRoot(value) {
  return IS_WINDOWS && /^[a-zA-Z]:[\\/]?$/.test(path.resolve(value))
}

function lookupEnv(env, name) {
  const upper = String(name).toUpperCase()
  for (const key of Object.keys(env ?? {})) {
    if (key.toUpperCase() === upper) {
      const value = env[key]
      return typeof value === 'string' ? value : undefined
    }
  }
  return undefined
}

/**
 * Expand `%VAR%` and a leading `~` so a configuration entry can read like
 * `%LOCALAPPDATA%\npm-cache` instead of a machine-specific absolute path.
 *
 * @param {string} raw
 * @param {Record<string, string | undefined>} env
 * @returns {string | null} the expanded value, or null when a variable is unset
 */
function expandPath(raw, env) {
  let value = raw.trim()
  if (value === '~') value = os.homedir()
  else if (value.startsWith('~/') || value.startsWith('~\\')) value = path.join(os.homedir(), value.slice(2))

  let missing = null
  value = value.replace(/%([^%]+)%/g, (match, name) => {
    const found = lookupEnv(env, name)
    if (found === undefined || found === '') {
      missing = name
      return match
    }
    return found
  })
  return missing === null ? value : null
}

/**
 * Normalize a configured `trust.roots` list: expand `%VAR%`/`~`, keep absolute
 * paths only, deduplicate, and drop unknown fields.
 *
 * @param {unknown} value
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ path: string, note: string, acknowledgeRisk: boolean }[]}
 */
export function normalizeRoots(value, env = process.env) {
  if (!Array.isArray(value)) return []
  const out = []
  const seen = new Set()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = typeof item.path === 'string' ? item.path.trim() : ''
    if (raw === '') continue
    const expanded = expandPath(raw, env)
    if (expanded === null || expanded === '' || !path.isAbsolute(expanded)) continue
    const resolved = path.resolve(expanded)
    const key = keyOf(resolved)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      path: resolved,
      note: typeof item.note === 'string' ? item.note : '',
      acknowledgeRisk: item.acknowledgeRisk === true,
    })
  }
  return out
}

/**
 * Classify one candidate root.
 *
 * `blocked` lists reasons that must never be granted. `risky` lists reasons that
 * require `acknowledgeRisk: true` on the configuration entry.
 *
 * @param {string} target
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   workspace?: string,
 *   read?: (dir: string) => string[],
 * }} [options]
 * @returns {{ path: string, ok: boolean, blocked: string[], risky: string[] }}
 */
export function classifyRoot(target, options = {}) {
  const env = options.env ?? process.env
  const read = options.read ?? (dir => fs.readdirSync(dir))
  const root = path.resolve(target)
  const blocked = []
  const risky = []

  if (isDriveRoot(root)) blocked.push('drive-root')

  const home = env.USERPROFILE || env.HOME || ''
  if (home && (samePath(root, home) || isInside(home, root))) blocked.push('user-profile')

  const pathEntries = String(env.Path ?? env.PATH ?? '')
    .split(path.delimiter)
    .filter(entry => entry !== '')
    .map(entry => path.resolve(entry))
  for (const entry of pathEntries) {
    if (samePath(root, entry)) blocked.push('path-entry')
  }

  if (IS_WINDOWS) {
    const systemDirs = [
      env.SystemRoot ? path.resolve(env.SystemRoot) : 'C:\\Windows',
      env.ProgramFiles ? path.resolve(env.ProgramFiles) : 'C:\\Program Files',
      env['ProgramFiles(x86)'] ? path.resolve(env['ProgramFiles(x86)']) : 'C:\\Program Files (x86)',
    ]
    for (const dir of systemDirs) {
      if (samePath(root, dir) || isInside(root, dir)) blocked.push('system-directory')
    }
  }

  const workspace = typeof options.workspace === 'string' && options.workspace !== ''
    ? path.resolve(options.workspace)
    : ''
  if (workspace && (samePath(root, workspace) || isInside(workspace, root))) {
    risky.push('contains-the-workspace')
  }

  for (const [label, value] of [['local-app-data-root', env.LOCALAPPDATA], ['app-data-root', env.APPDATA]]) {
    if (typeof value === 'string' && value !== '' && samePath(root, value)) risky.push(label)
  }

  try {
    const entries = read(root)
    const executables = entries.filter(name => EXECUTABLE_NAME.test(name))
    if (executables.length > 0) risky.push(`top-level-executables:${executables.slice(0, 5).join(',')}`)
  } catch {
    // An unreadable directory is not classified by content; other checks still apply.
  }

  return {
    path: root,
    ok: blocked.length === 0,
    blocked: [...new Set(blocked)],
    risky: [...new Set(risky)],
  }
}
