/**
 * Toolchain discovery for the settings panel.
 *
 * `lib/discover.js` answers "which directories should go on PATH"; this module
 * answers "what does this machine actually have", which is a wider question:
 * every candidate of every manager with whether it exists, how many entries it
 * holds, and the commands a shell would resolve from it. That is what the panel
 * lists, so a user can browse, tick, and override paths like an IDE's toolchain
 * settings page.
 *
 * The directory walk is synchronous and bounded (one readdir per existing
 * candidate, at most six command names), and nothing here throws: a permission
 * error becomes an empty directory, not a failed scan.
 */

import fs from 'node:fs'
import { MANAGERS } from './discover.js'
import { expandEntry } from './pathset.js'

const IS_WINDOWS = process.platform === 'win32'

/** Extensions Windows resolves as a command. */
const WINDOWS_EXECUTABLE = /\.(exe|cmd|bat|com)$/i

/**
 * Files that are plainly data rather than a command, used on POSIX where a
 * command usually has no extension at all (a pyenv shim, for example).
 */
const POSIX_NOT_EXECUTABLE = /\.(txt|md|markdown|json|json5|toml|ya?ml|ini|cfg|conf|log|dll|so|dylib|pdb|lib|a|o|h|hpp|c|cc|cpp|ts|js|mjs|cjs|map|xml|plist|png|jpe?g|gif|svg|ico|zip|gz|tgz|whl|nupkg|nuspec|ps1xml|py|sh|ps1)$/i

/**
 * Is this directory entry something a shell could run?
 *
 * @param {string} name
 * @param {{ windows?: boolean }} [options]
 * @returns {boolean}
 */
export function isExecutableName(name, options = {}) {
  const windows = options.windows ?? IS_WINDOWS
  const value = String(name ?? '').trim()
  if (value === '' || value.startsWith('.')) return false
  if (windows) return WINDOWS_EXECUTABLE.test(value)
  return !POSIX_NOT_EXECUTABLE.test(value)
}

/**
 * The command a shell would type for this file: the name without its
 * executable extension on Windows, unchanged elsewhere. A dot inside a name is
 * not an extension here (`python3.11` keeps it), matching `whichList`.
 *
 * @param {string} name
 * @param {{ windows?: boolean }} [options]
 * @returns {string}
 */
export function commandNameOf(name, options = {}) {
  const windows = options.windows ?? IS_WINDOWS
  const value = String(name ?? '').trim()
  return windows ? value.replace(WINDOWS_EXECUTABLE, '') : value
}

/**
 * Up to `limit` distinct command names a directory offers, sorted so repeated
 * scans of one directory report the same list.
 *
 * @param {readonly string[]} names
 * @param {{ windows?: boolean, limit?: number }} [options]
 * @returns {string[]}
 */
export function pickCommands(names, options = {}) {
  const windows = options.windows ?? IS_WINDOWS
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : 6
  const out = []
  const seen = new Set()
  for (const name of names ?? []) {
    if (!isExecutableName(name, { windows })) continue
    const command = commandNameOf(name, { windows })
    if (command === '') continue
    const key = windows ? command.toLowerCase() : command
    if (seen.has(key)) continue
    seen.add(key)
    out.push(command)
  }
  out.sort((left, right) => left.localeCompare(right))
  return out.slice(0, limit)
}

/**
 * Extract a version number from `--version` output.
 *
 * Covers `v22.11.0`, `npm 10.2.4`, `cargo 1.75.0 (1d8b05cdd 2023-11-20)` and
 * `go version go1.22.0 windows/amd64`; the first version-shaped token wins, so
 * a warning line without a version does not hide the real one.
 *
 * @param {...(string | undefined | null)} chunks
 * @returns {string | null}
 */
export function parseVersionOutput(...chunks) {
  const text = chunks.filter(chunk => typeof chunk === 'string' && chunk !== '').join('\n')
  for (const line of text.split(/\r?\n/)) {
    const match = /(\d+(?:\.\d+){1,3})/.exec(line)
    if (match) return match[1]
  }
  return null
}

/**
 * Scan every candidate directory of the built-in manager table.
 *
 * `describe: false` skips the readdir pass, which is what the PATH composition
 * uses: it only needs the expanded path and whether it exists.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   exists?: (candidate: string) => boolean,
 *   read?: (dir: string) => string[],
 *   managers?: readonly string[],
 *   describe?: boolean,
 *   platform?: string,
 * }} [options]
 * @returns {{
 *   id: string, manager: string, label: string, note: string, template: string,
 *   path: string, unresolved: string | null, exists: boolean, entries: number,
 *   empty: boolean, commands: string[],
 * }[]}
 */
export function scanManagers({
  env = process.env,
  exists = fs.existsSync,
  read = dir => fs.readdirSync(dir),
  managers = [],
  describe = true,
  platform = process.platform,
} = {}) {
  const windows = platform === 'win32'
  const allowed = new Set((managers ?? []).map(String))
  const entries = []

  for (const manager of MANAGERS) {
    if (allowed.size > 0 && !allowed.has(manager.id)) continue
    manager.dirs.forEach((template, index) => {
      const id = manager.dirs.length > 1 ? `${manager.id}#${index + 1}` : manager.id
      const expanded = expandEntry(template, env)
      if (expanded.error) {
        // An unset variable means "this manager is not installed here": report
        // the template so the panel can show it, but never claim it exists.
        entries.push({
          id,
          manager: manager.id,
          label: manager.label,
          note: manager.note ?? '',
          template,
          path: String(template),
          unresolved: expanded.error,
          exists: false,
          entries: 0,
          empty: false,
          commands: [],
        })
        return
      }

      let present = false
      try {
        present = Boolean(exists(expanded.path))
      } catch {
        present = false
      }

      let names = []
      if (present && describe) {
        try {
          names = read(expanded.path)
        } catch {
          names = []
        }
      }

      entries.push({
        id,
        manager: manager.id,
        label: manager.label,
        note: manager.note ?? '',
        template,
        path: expanded.path,
        unresolved: null,
        exists: present,
        entries: names.length,
        empty: present && describe ? names.length === 0 : false,
        commands: present && describe ? pickCommands(names, { windows }) : [],
      })
    })
  }

  return entries
}

/**
 * Counts for the scan header, so a caller does not have to re-derive them.
 *
 * @param {readonly { exists?: boolean, commands?: readonly string[] }[]} entries
 * @returns {{ total: number, installed: number, withCommands: number }}
 */
export function summarizeScan(entries) {
  const list = entries ?? []
  return {
    total: list.length,
    installed: list.filter(item => item?.exists === true).length,
    withCommands: list.filter(item => (item?.commands ?? []).length > 0).length,
  }
}
