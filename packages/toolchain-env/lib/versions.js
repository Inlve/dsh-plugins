/**
 * Advisory Node-version comparison.
 *
 * The plugin can make the manager's default Node visible, but it cannot
 * reproduce a per-directory version switch (`fnm env --use-on-cd`,
 * `mise activate`): the managed shell takes no per-call environment. So the
 * honest thing is to *say* when a workspace asks for a different major than the
 * one that will actually run, and stay silent whenever the requirement cannot
 * be proven.
 */

/**
 * @param {string} value
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseVersion(value) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(value ?? '').trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
  }
}

/**
 * Extract a provable major version from a `.node-version` value or a
 * `package.json` `engines.node` range.
 *
 * Supported: `18`, `18.17`, `18.17.0`, `v18.17.0`, `18.x`, `^18.17.0`,
 * `~18.17`, `>=18`, and a space-separated range starting with one of those
 * (`>=18 <20`). Anything else — `lts/*`, `*`, `||` unions, hyphen ranges —
 * returns null so the caller reports nothing rather than guessing.
 *
 * @param {string} spec
 * @returns {{ major: number } | null}
 */
export function parseRequirement(spec) {
  const text = String(spec ?? '').trim()
  if (text === '' || text === '*' || text === 'node' || text === 'stable' || text === 'default') return null
  if (/^lts(\/|$)/i.test(text)) return null
  if (text.includes('||') || /\s-\s/.test(text)) return null

  const caret = /^[\^~]=?\s*v?(\d+)/.exec(text)
  if (caret) return { major: Number(caret[1]) }

  const comparator = /^>=?\s*v?(\d+)/.exec(text)
  if (comparator) return { major: Number(comparator[1]) }

  const wildcard = /^v?(\d+)(?:\.(?:\d+|[xX*]))?(?:\.(?:\d+|[xX*]))?$/.exec(text)
  if (wildcard) return { major: Number(wildcard[1]) }

  return null
}

/**
 * Read the version a manager encodes in a resolved installation path, such as
 * `…\fnm\node-versions\v24.22.3\installation` or
 * `/home/u/.nvm/versions/node/v20.11.1/bin`.
 *
 * @param {string} realPath a real (junction-resolved) directory path
 * @returns {string | null} `major.minor.patch`, or null when the path carries none
 */
export function versionFromPath(realPath) {
  const match = /[\\/]v?(\d+\.\d+\.\d+)[\\/]/.exec(String(realPath ?? ''))
  return match ? match[1] : null
}

/**
 * @param {{ requested: string, current: string }} input
 * @returns {{ mismatch: boolean, skipped: boolean, reason?: string }}
 */
export function compareNodeVersion({ requested, current }) {
  const want = parseRequirement(requested)
  const have = parseVersion(current)
  if (!want || !have) return { mismatch: false, skipped: true }
  if (want.major !== have.major) {
    return {
      mismatch: true,
      skipped: false,
      reason: `asks for Node ${String(requested).trim()}, the manager default provides ${current}`,
    }
  }
  return { mismatch: false, skipped: false }
}
