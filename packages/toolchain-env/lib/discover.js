/**
 * The built-in manager table and the plan it produces.
 *
 * A "manager" here is any version manager or package manager that owns a bin
 * directory which is normally put on PATH by a shell profile (`fnm env`,
 * `mise activate`, ...) rather than by the user PATH. DSH runs non-interactive
 * PowerShell with `-NoProfile`, so those directories are invisible to it even
 * though the user's own terminal resolves them fine.
 *
 * The table is deliberately a fixed list of well-known layouts: no directory
 * scanning, no heuristics, no `where` scraping. A manager that is not listed
 * belongs in `pathEntries`.
 */

import fs from 'node:fs'
import { expandEntry, keyOf } from './pathset.js'

/**
 * @typedef {{ id: string, label: string, dirs: readonly string[], note?: string }} Manager
 */

/** @type {readonly Manager[]} */
export const MANAGERS = [
  { id: 'fnm', label: 'fnm (Node)', dirs: ['%APPDATA%\\fnm\\aliases\\default'], note: 'junction that follows the default Node version' },
  { id: 'pnpm', label: 'pnpm', dirs: ['%LOCALAPPDATA%\\pnpm', '%LOCALAPPDATA%\\pnpm\\bin'] },
  { id: 'volta', label: 'Volta', dirs: ['%LOCALAPPDATA%\\Volta\\bin'] },
  { id: 'mise', label: 'mise', dirs: ['%LOCALAPPDATA%\\mise\\shims'] },
  { id: 'pyenv-win', label: 'pyenv-win', dirs: ['%USERPROFILE%\\.pyenv\\pyenv-win\\shims'] },
  { id: 'scoop', label: 'Scoop', dirs: ['%USERPROFILE%\\scoop\\shims'] },
  { id: 'winget', label: 'winget links', dirs: ['%LOCALAPPDATA%\\Microsoft\\WinGet\\Links'] },
  { id: 'rustup', label: 'Rustup / Cargo', dirs: ['%USERPROFILE%\\.cargo\\bin'] },
  { id: 'bun', label: 'Bun', dirs: ['%USERPROFILE%\\.bun\\bin'] },
  { id: 'deno', label: 'Deno', dirs: ['%USERPROFILE%\\.deno\\bin'] },
  { id: 'go', label: 'Go', dirs: ['%USERPROFILE%\\go\\bin'] },
  { id: 'dotnet-tools', label: '.NET global tools', dirs: ['%USERPROFILE%\\.dotnet\\tools'] },
  { id: 'uv', label: 'uv', dirs: ['%USERPROFILE%\\.local\\bin'] },
  { id: 'nvm-windows', label: 'nvm-windows', dirs: ['%NVM_SYMLINK%'] },
]

/** @returns {string[]} */
export function knownManagerIds() {
  return MANAGERS.map(manager => manager.id)
}

/**
 * Build the list of directories the plugin would add.
 *
 * `missing` holds configured or discovered directories that do not exist — a
 * manager that is not installed, or a typo in `pathEntries`. `unresolved` holds
 * explicit entries this machine cannot expand (an unset `%VAR%` or a relative
 * path); a manager template with an unset variable is simply "not installed"
 * and is skipped silently.
 *
 * @param {{
 *   pathEntries?: readonly string[],
 *   managers?: readonly string[],
 *   discover?: boolean,
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   exists?: (candidate: string) => boolean,
 * }} [options]
 * @returns {{
 *   wanted: { path: string, source: string }[],
 *   missing: { entry: string, source: string }[],
 *   unresolved: { entry: string, source: string, reason: string }[],
 * }}
 */
export function planWanted({
  pathEntries = [],
  managers = [],
  discover = true,
  env = process.env,
  exists = fs.existsSync,
} = {}) {
  const wanted = []
  const missing = []
  const unresolved = []
  const seen = new Set()

  /** @param {string} dirPath @param {string} source */
  const push = (dirPath, source) => {
    const key = keyOf(dirPath)
    if (seen.has(key)) return
    seen.add(key)
    wanted.push({ path: dirPath, source })
  }

  for (const entry of pathEntries ?? []) {
    const expanded = expandEntry(entry, env)
    if (expanded.error) {
      unresolved.push({ entry: String(entry), source: 'config', reason: expanded.error })
      continue
    }
    if (!exists(expanded.path)) {
      missing.push({ entry: expanded.path, source: 'config' })
      continue
    }
    push(expanded.path, 'config')
  }

  if (discover) {
    const allowed = new Set((managers ?? []).map(String))
    for (const manager of MANAGERS) {
      if (allowed.size > 0 && !allowed.has(manager.id)) continue
      for (const template of manager.dirs) {
        const expanded = expandEntry(template, env)
        // An unset variable means the manager is not installed here.
        if (expanded.error) continue
        if (!exists(expanded.path)) {
          missing.push({ entry: expanded.path, source: `manager:${manager.id}` })
          continue
        }
        push(expanded.path, `manager:${manager.id}`)
      }
    }
  }

  return { wanted, missing, unresolved }
}

/**
 * Report how populated an added directory is, so an empty-but-existing manager
 * directory (for example a `pnpm` home with no global packages yet) is visible
 * instead of silently useless.
 *
 * @param {string} dirPath
 * @param {{ exists?: (candidate: string) => boolean, read?: (dir: string) => string[] }} [options]
 * @returns {{ exists: boolean, entries: number, empty: boolean }}
 */
export function describeDir(dirPath, options = {}) {
  const exists = options.exists ?? fs.existsSync
  const read = options.read ?? (dir => fs.readdirSync(dir))
  try {
    if (!exists(dirPath)) return { exists: false, entries: 0, empty: true }
    const entries = read(dirPath)
    return { exists: true, entries: entries.length, empty: entries.length === 0 }
  } catch {
    return { exists: false, entries: 0, empty: true }
  }
}
