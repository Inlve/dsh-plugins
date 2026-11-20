/**
 * Toolchain environment for DSH.
 *
 * DSH runs every model shell as a fresh `pwsh -NoLogo -NoProfile -NonInteractive`
 * (and `bash -c` on POSIX), so nothing a shell profile does reaches it. That is
 * deliberate for determinism, but it also hides every toolchain a version
 * manager installs by *activating a profile* instead of editing PATH: fnm's
 * per-version directory, Volta's bin, mise's shims, and so on.
 *
 * The subprocess service builds each child environment from `process.env` at
 * spawn time (it strips credential-shaped names and `DSH_*`, and keeps PATH), so
 * the one lever available to a host plugin is the host process's own PATH. This
 * plugin composes that value: baseline PATH minus what it added last time, plus
 * the directories this machine's managers own, appended (never prepended) so no
 * existing resolution is shadowed.
 *
 * It owns no persistent state. Killing DSH restores the environment; the only
 * artifact is the audit trail.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { createAudit } from './lib/audit.js'
import { describeDir, knownManagerIds } from './lib/discover.js'
import { parseToolchainEntries, planToolchain, resolvePosition } from './lib/entries.js'
import { parseVersionOutput, scanManagers, summarizeScan } from './lib/scan.js'
import {
  composePath,
  expandEntry,
  inspectPathValue,
  joinPathList,
  keyOf,
  pathextList,
  pathKeys,
  readPathValue,
  splitPathList,
  whichList,
  writePathValue,
} from './lib/pathset.js'
import { compareNodeVersion, versionFromPath } from './lib/versions.js'

export const inject = ['tools', 'commands']

const STATE_KEY = Symbol.for('@inlve/dsh-toolchain-env')
const TOOL_NAME = 'toolchain_env'
const COMMAND_NAME = 'toolchain'
const AUDIT_FILE = 'pathenv.jsonl'
const PROBE_TIMEOUT_MS = 20000
const PROBE_DELAY_MS = 1500
const VERSION_TIMEOUT_MS = 3000
const SCAN_TTL_MS = 5000
const IS_WINDOWS = process.platform === 'win32'

const DEFAULTS = {
  enabled: true,
  position: 'append',
  pathEntries: [],
  discover: true,
  managers: [],
  refreshTtlMs: 30000,
  selfTestOnActivate: true,
  warnOnVersionFile: true,
  verifyCommands: [],
  reportDir: '',
  audit: true,
  powershell: '',
  toolchainEntries: '',
  toolchainAutoScan: true,
  toolchainPosition: '',
}

const VOLATILE = schema => (typeof schema?.volatile === 'function' ? schema.volatile() : schema)

export const Config = Schema.object({
  enabled: Schema.boolean()
    .default(DEFAULTS.enabled)
    .description('Compose the host PATH so every DSH child process resolves manager-owned toolchains.'),
  position: Schema.string()
    .default(DEFAULTS.position)
    .description('Where the added directories go: "append" (default, never shadows an existing resolution) or "prepend".'),
  pathEntries: Schema.array(Schema.string())
    .default(DEFAULTS.pathEntries)
    .description('Extra directories to add, in order. Supports %VAR% and a leading ~; relative paths are refused.'),
  discover: Schema.boolean()
    .default(DEFAULTS.discover)
    .description('Use the built-in manager table (fnm, pnpm, pnpm/bin, volta, mise, pyenv-win, scoop, winget, rustup, bun, deno, go, dotnet tools, uv, nvm-windows).'),
  managers: Schema.array(Schema.string())
    .default(DEFAULTS.managers)
    .description('Restrict discovery to these manager ids; empty means every known manager.'),
  refreshTtlMs: Schema.number()
    .default(DEFAULTS.refreshTtlMs)
    .description('Re-check the candidate directories at most this often while tools run, so a newly installed tool appears without a restart. 0 disables the refresh.'),
  selfTestOnActivate: Schema.boolean()
    .default(DEFAULTS.selfTestOnActivate)
    .description('Run one real pwsh probe after activation and record a warning when its resolution disagrees with the composed PATH.'),
  warnOnVersionFile: Schema.boolean()
    .default(DEFAULTS.warnOnVersionFile)
    .description('Record (never block on) a workspace whose .node-version/.nvmrc/engines asks for a different Node major than the manager default.'),
  verifyCommands: Schema.array(Schema.string())
    .default(DEFAULTS.verifyCommands)
    .description('Commands the verify action probes; empty derives them from the added directories.'),
  reportDir: Schema.string()
    .default(DEFAULTS.reportDir)
    .description('Directory for the PATH audit trail; empty means ~/.dsh/toolchain-env.'),
  audit: Schema.boolean()
    .default(DEFAULTS.audit)
    .description('Write the PATH audit trail (pathenv.jsonl).'),
  powershell: Schema.string()
    .default(DEFAULTS.powershell)
    .description('PowerShell executable used by the verify probe; empty tries absolute well-known locations first, then PATH.'),
  toolchainEntries: VOLATILE(Schema.string().default(DEFAULTS.toolchainEntries))
    .description('Toolchain list edited from the settings panel: one "id | path | note" per line, %VAR% and ~ expanded, a leading "!" disables a line, "#" starts a comment. Applies on the next command, without a restart.'),
  toolchainAutoScan: VOLATILE(Schema.boolean().default(DEFAULTS.toolchainAutoScan))
    .description('Also add the directories the auto-scan finds (the panel\'s discovery section). On by default; it overlaps `discover`, so set both to false to keep the PATH static.'),
  toolchainPosition: VOLATILE(Schema.string().default(DEFAULTS.toolchainPosition))
    .description('Where the panel-selected directories go: "append" or "prepend". Empty follows the `position` field, so an existing config keeps its meaning.'),
})

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Partial<typeof DEFAULTS>} [rawConfig]
 */
export function apply(ctx, rawConfig = {}) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) }
  // The panel edits volatile fields, which parse to a stable reference instead
  // of a value; keep the raw config around so every plan can read the live one.
  const liveConfig = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {}
  const token = Symbol('toolchain-env instance')
  const versionChecks = new Map()
  const scanCache = { at: 0, entries: [] }

  const reportDir = String(config.reportDir ?? '').trim() === ''
    ? path.join(os.homedir(), '.dsh', 'toolchain-env')
    : path.resolve(String(config.reportDir))
  const audit = createAudit(reportDir, AUDIT_FILE)

  const log = (message) => {
    try {
      ctx.logger?.info?.(`[toolchain-env] ${message}`)
    } catch {
      // Logging must never change behaviour.
    }
  }

  function record(entry) {
    if (config.audit === false) return
    void audit.append({ ts: new Date().toISOString(), ...entry })
  }

  // ------------------------------------------------------------------ live config

  /** A volatile config field parses to a stable reference read with `.get()`. */
  function readVolatile(value) {
    if (value && typeof value.get === 'function') {
      try {
        return value.get()
      } catch {
        return undefined
      }
    }
    return value
  }

  /** The panel list, read live so a save needs no restart. */
  function toolchainText() {
    const live = readVolatile(liveConfig.toolchainEntries)
    if (typeof live === 'string') return live
    const fallback = readVolatile(config.toolchainEntries)
    return typeof fallback === 'string' ? fallback : ''
  }

  function autoScanEnabled() {
    const live = readVolatile(liveConfig.toolchainAutoScan)
    if (typeof live === 'boolean') return live
    const fallback = readVolatile(config.toolchainAutoScan)
    return typeof fallback === 'boolean' ? fallback : DEFAULTS.toolchainAutoScan
  }

  function positionInfo() {
    const live = readVolatile(liveConfig.toolchainPosition)
    return resolvePosition({
      panel: typeof live === 'string' ? live : undefined,
      configured: readVolatile(config.position),
    })
  }

  /**
   * The scan's existing candidate directories, cached briefly: composing the
   * PATH only needs the expanded path and one existsSync per candidate, not the
   * readdir pass the panel's scan performs.
   */
  function scanCandidates() {
    const now = Date.now()
    if (now - scanCache.at < SCAN_TTL_MS) return scanCache.entries
    const entries = scanManagers({
      env: process.env,
      exists: fs.existsSync,
      managers: Array.isArray(config.managers) ? config.managers : [],
      describe: false,
    })
    scanCache.at = now
    scanCache.entries = entries
    return entries
  }

  /** Cheap change detector for volatile edits made from the panel. */
  function liveConfigSignature() {
    return JSON.stringify([
      Boolean(config.enabled),
      Boolean(config.discover),
      config.managers,
      config.pathEntries,
      toolchainText(),
      autoScanEnabled(),
      positionInfo().value,
    ])
  }

  function state() {
    if (globalThis[STATE_KEY] === undefined) {
      globalThis[STATE_KEY] = {
        owner: undefined,
        baseline: undefined,
        added: [],
        value: '',
        lastSync: null,
      }
    }
    return globalThis[STATE_KEY]
  }

  function plan() {
    return planToolchain({
      pathEntries: Array.isArray(config.pathEntries) ? config.pathEntries : [],
      managers: Array.isArray(config.managers) ? config.managers : [],
      discover: Boolean(config.discover),
      toolchainEntries: toolchainText(),
      scanEntries: autoScanEnabled() ? scanCandidates() : [],
      autoScan: autoScanEnabled(),
      env: process.env,
      exists: fs.existsSync,
    })
  }

  function signature(items) {
    return (items ?? []).map(item => keyOf(item.path)).sort().join('|')
  }

  /**
   * Recompute and apply. Rebuilds from the captured baseline instead of editing
   * the live value, which is what makes repeated activation idempotent.
   */
  function sync(reason) {
    try {
      const st = state()
      st.owner = token
      if (st.baseline === undefined) st.baseline = readPathValue(process.env)

      if (!config.enabled) {
        restore(reason)
        return { ok: true, enabled: false, added: [], changed: false }
      }

      const { wanted, missing, unresolved } = plan()
      const pos = positionInfo()
      const previous = Array.isArray(st.added) ? st.added : []
      const { value, added } = composePath({
        baseline: st.baseline,
        previousAdded: previous,
        wanted,
        position: pos.value,
      })

      const current = readPathValue(process.env)
      const changed = signature(added) !== signature(previous) || current !== value
      if (value !== current) writePathValue(process.env, value)

      st.added = added
      st.value = value
      st.lastSync = { reason, at: new Date().toISOString() }

      if (changed || reason === 'activate') {
        const previousKeys = new Set(previous.map(item => keyOf(item.path)))
        const nextKeys = new Set(added.map(item => keyOf(item.path)))
        record({
          event: 'apply',
          reason,
          position: pos.value,
          positionSource: pos.source,
          pathKey: pathKeys(process.env),
          added: added.map(item => ({ path: item.path, source: item.source })),
          removed: previous.filter(item => !nextKeys.has(keyOf(item.path))).map(item => item.path),
          missing: missing.map(item => item.entry),
          unresolved: unresolved.map(item => `${item.entry}: ${item.reason}`),
          unchanged: previousKeys.size === nextKeys.size,
        })
        log(`${reason}: ${added.length} director${added.length === 1 ? 'y' : 'ies'} composed (${pos.value})`)
      }

      return { ok: true, enabled: true, added, missing, unresolved, changed }
    } catch (error) {
      record({ event: 'error', reason, error: String(error?.message ?? error) })
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  /**
   * Restore the captured baseline. When something else changed PATH in the
   * meantime, only this plugin's entries are removed, so a foreign edit is
   * never rolled back by us.
   */
  function restore(reason = 'dispose') {
    const st = globalThis[STATE_KEY]
    if (!st || st.baseline === undefined) return { restored: false }
    if (st.owner !== token) return { restored: false, reason: 'superseded' }

    try {
      const current = readPathValue(process.env)
      const applied = new Set((st.added ?? []).map(item => keyOf(item.path)))
      const value = current === st.value
        ? st.baseline
        : joinPathList(splitPathList(current).filter(entry => !applied.has(keyOf(entry))))
      if (value !== current) writePathValue(process.env, value)
      record({ event: 'restore', reason, removed: (st.added ?? []).map(item => item.path) })
      return { restored: true, removed: (st.added ?? []).length }
    } catch (error) {
      record({ event: 'error', reason: `restore:${reason}`, error: String(error?.message ?? error) })
      return { restored: false, error: String(error?.message ?? error) }
    } finally {
      delete globalThis[STATE_KEY]
    }
  }

  function agentCwd(agent) {
    try {
      const live = ctx.get('agents')?.get?.(agent?.id)
      const session = live?.session
      if (!session) return undefined
      const resolved = ctx.get('workingDirectory')?.get?.(session)
      if (typeof resolved === 'string' && resolved.length > 0) return resolved
      const header = session?.header?.cwd
      return typeof header === 'string' && header.length > 0 ? header : undefined
    } catch {
      return undefined
    }
  }

  function defaultNodeVersion() {
    const alias = expandEntry('%APPDATA%\\fnm\\aliases\\default', process.env)
    if (alias.error) return undefined
    try {
      const real = fs.realpathSync.native ? fs.realpathSync.native(alias.path) : fs.realpathSync(alias.path)
      // The alias resolves to `…\node-versions\v<version>\installation`, so the
      // version is a path segment, not the basename.
      return versionFromPath(real) ?? undefined
    } catch {
      return undefined
    }
  }

  function findVersionRequest(startDir) {
    let dir = path.resolve(startDir)
    for (let depth = 0; depth < 20; depth += 1) {
      for (const name of ['.node-version', '.nvmrc']) {
        const file = path.join(dir, name)
        try {
          if (fs.existsSync(file)) {
            const value = fs.readFileSync(file, 'utf8').trim()
            if (value !== '') return { source: name, requested: value }
          }
        } catch {
          // Unreadable version file: treat as absent.
        }
      }
      const manifest = path.join(dir, 'package.json')
      try {
        if (fs.existsSync(manifest)) {
          const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'))
          const engines = parsed?.engines?.node
          if (typeof engines === 'string' && engines.trim() !== '') {
            return { source: 'package.json#engines.node', requested: engines }
          }
        }
      } catch {
        // Malformed manifest: treat as absent.
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return undefined
  }

  function checkVersionDir(dir) {
    if (!config.warnOnVersionFile || typeof dir !== 'string' || dir.trim() === '') return null
    const current = defaultNodeVersion()
    const cacheKey = `${dir}\u0000${current ?? ''}`
    if (versionChecks.has(cacheKey)) return versionChecks.get(cacheKey)

    let finding = null
    const request = findVersionRequest(dir)
    if (current && request) {
      const comparison = compareNodeVersion({ requested: request.requested, current })
      if (comparison.mismatch) {
        finding = { dir: path.resolve(dir), current, source: request.source, requested: request.requested, reason: comparison.reason }
      }
    }
    versionChecks.set(cacheKey, finding)
    if (finding) {
      record({ event: 'version-mismatch', ...finding })
      log(`version mismatch in ${finding.dir}: ${finding.reason}`)
    }
    return finding
  }

  // ------------------------------------------------------------------ surfaces

  // One effect owns the composed value: activation applies it, disposal puts the
  // baseline back.
  ctx.effect(() => {
    sync('activate')
    return () => { restore('dispose') }
  })

  // Candidate directories can appear after DSH started (a manager installed, a
  // toolchain upgraded). Re-check on a TTL instead of asking for a restart; the
  // check is a handful of stat calls, and a rebuild happens only when the set
  // actually changed.
  let lastRefresh = 0
  let lastConfigSignature = liveConfigSignature()
  ctx.on('tools/pre-execute', (exec, next) => {
    try {
      const now = Date.now()
      // A panel save edits a volatile field only; comparing the cheap signature
      // makes that edit take effect on the very next tool call, not after the
      // filesystem TTL.
      const configSignature = liveConfigSignature()
      if (configSignature !== lastConfigSignature) {
        lastConfigSignature = configSignature
        sync('config-change')
      }
      const ttl = Number(config.refreshTtlMs)
      if (Number.isFinite(ttl) && ttl > 0 && now - lastRefresh >= ttl) {
        lastRefresh = now
        const st = globalThis[STATE_KEY]
        const { wanted } = plan()
        const probe = composePath({
          baseline: st?.baseline ?? readPathValue(process.env),
          previousAdded: st?.added ?? [],
          wanted,
          position: positionInfo().value,
        })
        if (signature(probe.added) !== signature(st?.added)) sync('refresh')
      }
      checkVersionDir(agentCwd(exec?.agent))
    } catch {
      // Never let a refresh failure block a tool call.
    }
    return next()
  })

  if (config.selfTestOnActivate) {
    const timer = setTimeout(() => {
      try {
        const added = globalThis[STATE_KEY]?.added ?? []
        if (added.length === 0) return
        verifyPayload(undefined)
          .then((result) => {
            if (!result?.ok) return
            const disagreed = (result.probes ?? []).filter(item => item.agrees === false)
            if (disagreed.length > 0) {
              log(`self-test disagrees with the managed shell for ${disagreed.map(item => item.name).join(', ')}`)
            }
          })
          .catch(() => { /* recorded per probe */ })
      } catch {
        // The self-test is advisory only.
      }
    }, PROBE_DELAY_MS)
    timer.unref?.()
    ctx.effect(() => () => clearTimeout(timer))
  }

  function statusPayload(exec, explicitPath) {
    const st = globalThis[STATE_KEY]
    const current = readPathValue(process.env)
    const baseline = st?.baseline ?? current
    const baseInfo = inspectPathValue(baseline)
    const currentInfo = inspectPathValue(current)
    const baseKeys = new Set(baseInfo.segments.map(keyOf))
    const keys = pathKeys(process.env)
    const pos = positionInfo()

    const added = (st?.added ?? []).map((item) => {
      const info = describeDir(item.path)
      return {
        path: item.path,
        source: item.source,
        manager: item.source.startsWith('manager:') ? item.source.slice('manager:'.length) : undefined,
        onPathBefore: baseKeys.has(keyOf(item.path)),
        entries: info.entries,
        empty: info.empty,
      }
    })

    const { missing, unresolved } = plan()
    const missingConfigured = missing
      .filter(item => item.source === 'config' || item.source === 'entry' || item.source.startsWith('entry:'))
      .map(item => ({ path: item.entry, source: item.source }))
    const absentManagers = missing
      .filter(item => item.source.startsWith('manager:'))
      .map(item => item.source.slice('manager:'.length))

    const target = typeof explicitPath === 'string' && explicitPath.trim() !== ''
      ? path.resolve(explicitPath)
      : agentCwd(exec?.agent)

    const rows = parseToolchainEntries(toolchainText())
    const scanned = summarizeScan(scanCandidates())

    return {
      ok: true,
      enabled: Boolean(config.enabled),
      position: pos.value,
      positionSource: pos.source,
      autoScan: autoScanEnabled(),
      pathKeys: keys,
      duplicatePathKeys: keys.length > 1,
      segments: {
        baseline: baseInfo.segments.length,
        current: currentInfo.segments.length,
        emptyInBaseline: baseInfo.emptySegments,
      },
      added,
      missingConfigured,
      unresolved: unresolved.map(item => ({ entry: item.entry, source: item.source, reason: item.reason })),
      absentManagers: [...new Set(absentManagers)],
      knownManagers: knownManagerIds(),
      toolchain: {
        entries: rows.map((row) => {
          const expanded = expandEntry(row.path, process.env)
          return {
            id: row.id,
            path: row.path,
            note: row.note,
            enabled: row.enabled,
            resolved: expanded.error ? null : expanded.path,
            error: expanded.error ?? null,
            exists: expanded.error ? false : fs.existsSync(expanded.path),
          }
        }),
        scanned: {
          installed: scanned.installed,
          total: scanned.total,
          candidates: scanCandidates().filter(item => item.exists === true).map(item => item.path),
        },
      },
      versionFile: target ? checkVersionDir(target) : null,
      versionCheckTarget: target ?? null,
      lastSync: st?.lastSync ?? null,
      auditFile: audit.file,
    }
  }

  /**
   * Report the on-disk casing of a resolved command. `whichList` builds a
   * candidate from PATHEXT (for example `node.EXE`), and a Windows filesystem
   * accepts that spelling, but the diagnostics should show the name the user
   * will see in `Get-Command`.
   */
  function canonicalCase(candidate) {
    try {
      const dir = path.dirname(candidate)
      const base = path.basename(candidate)
      const entries = fs.readdirSync(dir)
      const hit = entries.find(entry => (IS_WINDOWS ? entry.toLowerCase() === base.toLowerCase() : entry === base))
      return hit ? path.join(dir, hit) : candidate
    } catch {
      return candidate
    }
  }

  function whichPayload(command) {
    const raw = String(command ?? '').trim()
    if (raw === '') return { ok: false, error: { code: 'missing-command', message: 'command is required' } }
    const value = readPathValue(process.env)
    const extensions = pathextList(process.env)
    const matches = whichList(raw, value, { pathext: extensions, exists: fs.existsSync })
      .map(match => ({ path: canonicalCase(match.path), dir: match.dir }))
    const ours = new Set((globalThis[STATE_KEY]?.added ?? []).map(item => keyOf(item.path)))
    const resolved = matches[0] ?? null
    return {
      ok: true,
      command: raw,
      resolved: resolved ? resolved.path : null,
      resolvedFromAddedDir: resolved ? ours.has(keyOf(resolved.dir)) : false,
      matches: matches.map(match => ({ path: match.path, fromAddedDir: ours.has(keyOf(match.dir)) })),
      pathext: extensions,
      pathKey: pathKeys(process.env),
    }
  }

  function probesFor(explicitCommand) {
    if (typeof explicitCommand === 'string' && explicitCommand.trim() !== '') return [explicitCommand.trim()]
    const configured = Array.isArray(config.verifyCommands)
      ? config.verifyCommands.map(String).map(value => value.trim()).filter(Boolean)
      : []
    if (configured.length > 0) return configured.slice(0, 12)

    const names = []
    for (const item of globalThis[STATE_KEY]?.added ?? []) {
      let entries = []
      try {
        entries = fs.readdirSync(item.path)
      } catch {
        continue
      }
      for (const entry of entries) {
        // Node's distribution also ships .bat helpers (nodevars, install_tools);
        // they are not tools to probe.
        if (!/\.(exe|cmd)$/i.test(entry)) continue
        const base = path.basename(entry, path.extname(entry))
        if (names.includes(base)) continue
        names.push(base)
        if (names.length >= 6) break
      }
      if (names.length >= 6) break
    }
    return names
  }

  function powershellPath() {
    const configured = String(config.powershell ?? '').trim()
    if (configured !== '') return configured
    const candidates = [
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
      path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'PowerShell', '7', 'pwsh.exe'),
      path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ]
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return candidate
      } catch {
        // Keep probing.
      }
    }
    return 'powershell.exe'
  }

  function runPowerShellProbe(names) {
    const shell = powershellPath()
    const quoted = names.map(name => `'${String(name).replace(/'/g, "''")}'`).join(',')
    const script = [
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      `$names = @(${quoted})`,
      '$out = foreach ($n in $names) { $c = Get-Command $n -ErrorAction SilentlyContinue; if ($c) { "$n=$($c.Source)" } else { "$n=" } }',
      '$out -join "`n"',
    ].join('; ')

    return new Promise((resolve) => {
      let settled = false
      let timer = null
      const finish = (payload) => {
        if (settled) return
        settled = true
        if (timer !== null) clearTimeout(timer)
        resolve(payload)
      }

      let child
      try {
        child = spawn(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        finish({ ok: false, shell, stdout: '', stderr: String(error?.message ?? error), values: {} })
        return
      }

      let stdout = ''
      let stderr = ''
      timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // Already gone.
        }
        finish({ ok: false, shell, stdout, stderr: `${stderr}\nprobe timed out after ${PROBE_TIMEOUT_MS}ms`, values: {} })
      }, PROBE_TIMEOUT_MS)
      timer.unref?.()

      child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8') })
      child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8') })
      child.on('error', (error) => {
        finish({ ok: false, shell, stdout, stderr: `${stderr}\n${error?.message ?? error}`, values: {} })
      })
      child.on('close', (code) => {
        const values = {}
        for (const line of stdout.split(/\r?\n/)) {
          const index = line.indexOf('=')
          if (index <= 0) continue
          values[line.slice(0, index)] = line.slice(index + 1).trim()
        }
        finish({ ok: code === 0, shell, stdout: stdout.trim(), stderr: stderr.trim(), values })
      })
    })
  }

  async function verifyPayload(explicitCommand) {
    const probes = probesFor(explicitCommand)
    if (probes.length === 0) {
      return { ok: false, error: { code: 'no-probes', message: 'no command to probe; pass one or set verifyCommands' } }
    }
    const local = probes.map(name => ({ name, resolved: whichPayload(name).resolved }))
    const remote = await runPowerShellProbe(probes)
    // A Windows filesystem is case-insensitive, so two spellings of one path agree.
    const samePath = (left, right) => {
      const a = String(left ?? '')
      const b = String(right ?? '')
      return IS_WINDOWS ? a.toLowerCase() === b.toLowerCase() : a === b
    }
    const comparisons = local.map((item) => {
      const observed = remote.ok ? (remote.values?.[item.name] ?? '') : null
      return {
        name: item.name,
        composed: item.resolved,
        observed: observed === '' ? null : observed,
        agrees: remote.ok ? samePath(observed, item.resolved) : null,
      }
    })
    const mismatched = comparisons.filter(item => item.agrees === false)
    if (mismatched.length > 0) record({ event: 'verify-mismatch', mismatched })
    return {
      ok: true,
      shell: remote.shell,
      probes: comparisons,
      stdout: remote.stdout,
      stderr: remote.stderr,
      consistent: remote.ok ? mismatched.length === 0 : null,
    }
  }

  /**
   * Ask one resolved command for its version.
   *
   * Advisory only: a manager that hangs, prints nothing, or ships only a `.cmd`
   * shim yields null rather than failing the scan. `.cmd`/`.bat` are skipped
   * deliberately — Node refuses to spawn one without a shell, and putting a
   * filesystem-derived path through a shell is not worth an advisory string.
   */
  function probeVersion(dir, command) {
    return new Promise((resolve) => {
      let resolved = ''
      try {
        resolved = whichList(command, dir, { pathext: pathextList(process.env), exists: fs.existsSync })[0]?.path ?? ''
      } catch {
        resolved = ''
      }
      if (resolved === '' || (IS_WINDOWS && !/\.exe$/i.test(resolved))) {
        resolve(null)
        return
      }

      let child
      try {
        child = spawn(resolved, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch {
        resolve(null)
        return
      }

      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* already gone */ }
        finish(parseVersionOutput(stdout, stderr))
      }, VERSION_TIMEOUT_MS)
      timer.unref?.()

      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk) => { stdout += chunk })
      child.stderr?.on('data', (chunk) => { stderr += chunk })
      child.on('error', () => finish(null))
      child.on('close', () => finish(parseVersionOutput(stdout, stderr)))
    })
  }

  /**
   * Try the directory's commands in order until one answers. The first name is
   * often a package-manager shim (`.cmd`, or an extensionless POSIX script) that
   * cannot be spawned directly, and its `--version` is the only thing that
   * matters here, so the next candidate is worth a cheap attempt.
   */
  async function probeEntryVersion(dir, commands) {
    for (const command of (commands ?? []).slice(0, 6)) {
      const value = await probeVersion(dir, command)
      if (value !== null) return value
    }
    return null
  }

  /** Structured discovery list for the settings panel and `scan --json`. */
  async function scanPayload(args) {
    const withVersions = args?.versions === true
    const entries = scanManagers({
      env: process.env,
      exists: fs.existsSync,
      managers: Array.isArray(config.managers) ? config.managers : [],
    })

    const listed = new Set()
    for (const row of parseToolchainEntries(toolchainText())) {
      const expanded = expandEntry(row.path, process.env)
      if (!expanded.error) listed.add(keyOf(expanded.path))
    }

    if (withVersions) {
      await Promise.all(entries
        .filter(item => item.exists && item.commands.length > 0)
        .map(async (item) => {
          item.version = await probeEntryVersion(item.path, item.commands)
        }))
    }

    for (const item of entries) {
      if (item.version === undefined) item.version = null
      item.listed = item.exists && listed.has(keyOf(item.path))
    }

    const pos = positionInfo()
    return {
      ok: true,
      action: 'scan',
      at: new Date().toISOString(),
      position: pos.value,
      positionSource: pos.source,
      autoScan: autoScanEnabled(),
      configured: parseToolchainEntries(toolchainText()).length,
      summary: summarizeScan(entries),
      entries,
    }
  }

  /** The effective list: what is configured and what it resolves to. */
  function listPayload() {
    const { wanted, missing, unresolved, rows } = plan()
    const pos = positionInfo()
    return {
      ok: true,
      action: 'list',
      position: pos.value,
      positionSource: pos.source,
      autoScan: autoScanEnabled(),
      configured: rows.map(row => ({
        id: row.id,
        path: row.path,
        note: row.note,
        enabled: row.enabled,
        source: row.id === '' ? 'entry' : `entry:${row.id}`,
      })),
      wanted: wanted.map((item) => {
        const info = describeDir(item.path)
        return { path: item.path, source: item.source, exists: info.exists, entries: info.entries, empty: info.empty }
      }),
      missing,
      unresolved,
      summary: {
        configured: rows.length,
        enabled: rows.filter(row => row.enabled).length,
        wanted: wanted.length,
      },
    }
  }

  const POSITION_LABEL = { append: 'append（不抢已有解析）', prepend: 'prepend（优先）' }

  function formatList(payload) {
    const lines = []
    lines.push(`工具链清单：${payload.summary.configured} 项（启用 ${payload.summary.enabled}）｜位置 ${POSITION_LABEL[payload.position] ?? payload.position}｜自动发现 ${payload.autoScan ? '开' : '关'}`)
    lines.push('配置清单：')
    if (payload.configured.length === 0) {
      lines.push('  （空）')
    } else {
      for (const item of payload.configured) {
        const head = `  ${item.enabled ? '[x]' : '[ ]'} ${item.id === '' ? '(无 id)' : item.id} → ${item.path}`
        lines.push(item.note === '' ? head : `${head}（${item.note}）`)
      }
    }
    lines.push(`生效目录（${payload.wanted.length}）：`)
    if (payload.wanted.length === 0) {
      lines.push('  （无）')
    } else {
      for (const item of payload.wanted) {
        const flags = [item.empty ? '空目录' : `${item.entries} 项`].join('，')
        lines.push(`  ${item.path}  ← ${item.source}（${flags}）`)
      }
    }
    if (payload.missing.length > 0) {
      lines.push('配置了但不存在的目录：')
      for (const item of payload.missing) lines.push(`  ${item.entry}  ← ${item.source}`)
    }
    if (payload.unresolved.length > 0) {
      lines.push('无法展开的条目：')
      for (const item of payload.unresolved) lines.push(`  ${item.entry}（${item.source}）：${item.reason}`)
    }
    return lines.join('\n')
  }

  function formatScan(payload) {
    const lines = [
      `扫描：${payload.summary.total} 个候选目录，已安装 ${payload.summary.installed} 个（位置 ${payload.position}，自动发现 ${payload.autoScan ? '开' : '关'}）`,
    ]
    const installed = payload.entries.filter(item => item.exists)
    const absent = payload.entries.filter(item => !item.exists)
    for (const item of installed) {
      const commands = item.commands.length > 0 ? `（${item.commands.join(', ')}）` : '（无命令）'
      const flags = [item.version ? `v${item.version}` : null, item.listed ? '已在清单' : null].filter(Boolean).join('，')
      lines.push(`  ✓ ${item.label.padEnd(16)} ${item.path}${commands}${flags ? `  ${flags}` : ''}`)
    }
    if (absent.length > 0) lines.push(`未安装：${absent.map(item => item.id).join(', ')}`)
    return lines.join('\n')
  }

  function formatStatus(payload) {
    const lines = []
    lines.push(payload.enabled
      ? `工具链 PATH 层：已启用（${payload.position}，来自${payload.positionSource === 'panel' ? '面板' : '配置'}）`
      : '工具链 PATH 层：已禁用（PATH 保持原样）')
    lines.push(`PATH 段数：基线 ${payload.segments.baseline} → 当前 ${payload.segments.current}`)
    if (payload.duplicatePathKeys) lines.push(`⚠ 进程里存在多个 PATH 键：${payload.pathKeys.join(', ')}`)
    lines.push('新增目录：')
    if (payload.added.length === 0) {
      lines.push('  （无）')
    } else {
      for (const item of payload.added) {
        const flags = [
          item.onPathBefore ? '原本已在 PATH' : null,
          item.empty ? '空目录' : `${item.entries} 项`,
        ].filter(Boolean).join('，')
        lines.push(`  ${item.path}  ← ${item.source}（${flags}）`)
      }
    }
    const entries = payload.toolchain?.entries ?? []
    if (entries.length > 0 || payload.autoScan) {
      const enabled = entries.filter(item => item.enabled).length
      lines.push(`面板清单：${entries.length} 项（启用 ${enabled}）｜自动发现 ${payload.autoScan ? '开' : '关'}（已安装 ${payload.toolchain?.scanned?.installed ?? 0}/${payload.toolchain?.scanned?.total ?? 0}）`)
      for (const item of entries) {
        const state = !item.enabled ? '已停用' : item.error ? `无法展开 ${item.error}` : item.exists ? '存在' : '不存在'
        lines.push(`  ${item.enabled ? '[x]' : '[ ]'} ${item.id === '' ? '(无 id)' : item.id} → ${item.path}（${state}）`)
      }
    }
    if (payload.missingConfigured.length > 0) {
      lines.push('配置了但不存在的目录：')
      for (const item of payload.missingConfigured) lines.push(`  ${item.path}${item.source ? `  ← ${item.source}` : ''}`)
    }
    if (payload.unresolved.length > 0) {
      lines.push('无法展开的条目：')
      for (const item of payload.unresolved) lines.push(`  ${item.entry}：${item.reason}`)
    }
    if (payload.absentManagers.length > 0) {
      lines.push(`未安装的受管工具链：${payload.absentManagers.join(', ')}`)
    }
    if (payload.versionFile) {
      lines.push(`⚠ 版本不一致：${payload.versionFile.reason}（${payload.versionFile.source}）`)
    } else if (payload.versionCheckTarget) {
      lines.push(`版本检查：${payload.versionCheckTarget} 无版本文件，或与默认一致`)
    }
    if (payload.lastSync) lines.push(`最近一次重算：${payload.lastSync.reason} @ ${payload.lastSync.at}`)
    lines.push(`审计：${payload.auditFile}`)
    return lines.join('\n')
  }

  ctx.effect(() => ctx.tools.register({
    name: TOOL_NAME,
    description: [
      'Inspect and refresh the toolchain PATH layer that the managed shell inherits.',
      'DSH runs every model shell without a profile, so a version manager that activates itself from a shell profile',
      '(fnm, Volta, mise, ...) never reaches the shell; this plugin composes the host PATH instead by appending the',
      'directories those managers own. Every command, the Web terminal, MCP servers and subagents inherit that value;',
      'nothing is written to the registry or persisted after DSH exits.',
      'Action "status" reports what was added, from which source, which configured managers are absent, and the',
      'panel-managed toolchain list with the effective position and the auto-scan counts;',
      '"which" resolves a command exactly as the managed shell will (PATH order, then PATHEXT) and shows what lies behind it;',
      '"verify" runs one real pwsh probe and compares its resolution with the composed PATH;',
      '"scan" lists every candidate directory of the built-in manager table with whether it exists, how many entries it holds,',
      'the commands it provides and an optional --version;',
      '"list" returns the effective list — the panel-managed entries, the legacy discovery table and the auto-scan directories —',
      'in the order they are added, with the missing and unresolvable ones;',
      '"refresh" recomposes now; "audit" returns recent PATH changes.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'which', 'verify', 'refresh', 'audit', 'scan', 'list', 'save_entries'],
          description: 'status = what is applied and why; which = resolve one command; verify = real pwsh probe; scan = browse discoverable toolchains; list = the effective list; refresh = recompose now; audit = recent PATH changes; save_entries = persist the panel list through the settings service (diagnostic/CLI path).',
        },
        value: {
          type: 'string',
          description: 'save_entries only: the multi-line "id | path | note" list to persist. Omit to only report which config entries the settings service currently serves.',
        },
        command: {
          type: 'string',
          description: 'which/verify only: the command to resolve or probe. verify without it probes commands derived from the added directories.',
        },
        path: {
          type: 'string',
          description: 'status only: directory whose Node version requirement should be compared; defaults to the session working directory.',
        },
        limit: {
          type: 'number',
          description: 'audit only: how many recent entries to return, 1-200.',
        },
        versions: {
          type: 'boolean',
          description: 'scan only: also run "--version" for the commands of each installed directory, in order, until one answers (3 s timeout each). Off by default because it starts a process per directory.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      try {
        const action = String(args?.action ?? 'status')
        if (action === 'save_entries') {
          const settings = ctx.get?.('settings')
          if (!settings) return { ok: false, action, error: { code: 'no-settings', message: 'the settings service is not mounted' } }
          let namespaces = []
          try {
            namespaces = settings.describe().map(row => ({ ns: row.ns, autoGenerate: row.autoGenerate, revision: row.revision, hasUser: row.user !== undefined, hasBase: row.base !== undefined }))
          } catch (error) {
            return { ok: false, action, error: { code: 'describe-failed', message: String(error?.message ?? error) } }
          }
          const value = typeof args?.value === 'string' ? args.value : ''
          if (value === '') return { ok: true, action, saved: false, namespaces }
          try {
            await settings.mutate('toolchain-env', [{ op: 'set', path: ['toolchainEntries'], value }])
            return { ok: true, action, saved: true, namespaces }
          } catch (error) {
            return { ok: false, action, saved: false, namespaces, error: { code: error?.code ?? 'save-failed', message: String(error?.message ?? error) } }
          }
        }
        if (action === 'status') return statusPayload(exec, args?.path)
        if (action === 'which') return whichPayload(args?.command)
        if (action === 'verify') return await verifyPayload(args?.command)
        if (action === 'scan') return await scanPayload(args)
        if (action === 'list') return listPayload()
        if (action === 'refresh') {
          const result = sync('refresh')
          return {
            ok: result.ok !== false,
            action,
            changed: result.changed ?? false,
            added: (result.added ?? []).map(item => item.path),
            missing: (result.missing ?? []).length,
          }
        }
        if (action === 'audit') {
          const raw = Number(args?.limit)
          const limit = Number.isFinite(raw) ? Math.min(200, Math.max(1, Math.floor(raw))) : 20
          return { ok: true, action, auditFile: audit.file, entries: await audit.tail(limit) }
        }
        return { ok: false, error: { code: 'unknown-action', message: 'action must be status, which, verify, scan, list, refresh, or audit' } }
      } catch (error) {
        return { ok: false, error: { code: 'failed', message: String(error?.message ?? error) } }
      }
    },
  }))

  ctx.effect(() => ctx.commands.register({
    name: COMMAND_NAME,
    description: '查看/刷新受管 shell 的工具链 PATH 层',
    input: { hint: '[status|list|scan|refresh|verify|audit|which <命令>] [--json] [--versions]' },
    recordInput: false,
    async handler(invocation) {
      const parts = String(invocation?.rawInput ?? '').trim().split(/\s+/).filter(Boolean)
      // `--json` lets the settings panel reuse these commands as a structured
      // source: the panel parses the returned string, so nothing else changes.
      const flags = new Set(parts.filter(part => part.startsWith('--')).map(part => part.toLowerCase()))
      const words = parts.filter(part => !part.startsWith('--'))
      const verb = (words[0] ?? 'status').toLowerCase()
      const asJson = flags.has('--json')
      try {
        if (verb === 'scan') {
          const payload = await scanPayload({ versions: flags.has('--versions') })
          return { kind: 'success', text: asJson ? JSON.stringify(payload) : formatScan(payload) }
        }
        if (verb === 'list') {
          const payload = listPayload()
          return { kind: 'success', text: asJson ? JSON.stringify(payload) : formatList(payload) }
        }
        if (verb === 'refresh') {
          const result = sync('refresh')
          return {
            kind: 'success',
            text: `PATH 已重算：${(result.added ?? []).length} 个目录，${result.changed ? '有变更' : '无变更'}`,
          }
        }
        if (verb === 'which') {
          const payload = whichPayload(words.slice(1).join(' '))
          if (!payload.ok) return { kind: 'error', text: payload.error.message }
          const lines = [payload.resolved ? `${payload.command} → ${payload.resolved}` : `${payload.command} → 未找到`]
          for (const match of payload.matches.slice(1)) lines.push(`  其次：${match.path}`)
          if (payload.resolved && payload.resolvedFromAddedDir) lines.push('  （由 toolchain-env 添加的目录提供）')
          return { kind: 'success', text: lines.join('\n') }
        }
        if (verb === 'verify') {
          const payload = await verifyPayload(words[1])
          if (!payload.ok) return { kind: 'error', text: payload.error.message }
          const lines = [`探针：${payload.shell}`]
          for (const item of payload.probes) {
            const mark = item.agrees === true ? '✓' : item.agrees === false ? '✗' : '?'
            lines.push(`  ${mark} ${item.name} → ${item.observed ?? '未找到'}`)
            if (item.agrees === false) lines.push(`     组合得到：${item.composed ?? '未找到'}`)
          }
          return { kind: payload.consistent === false ? 'error' : 'success', text: lines.join('\n') }
        }
        if (verb === 'audit') {
          const raw = Number.parseInt(words[1] ?? '10', 10)
          const limit = Number.isFinite(raw) ? Math.min(100, Math.max(1, raw)) : 10
          const entries = await audit.tail(limit)
          if (entries.length === 0) return { kind: 'success', text: `暂无 PATH 记录（${audit.file}）` }
          return { kind: 'success', text: entries.map(entry => JSON.stringify(entry)).join('\n') }
        }
        return { kind: 'success', text: formatStatus(statusPayload({ agent: invocation?.agent })) }
      } catch (error) {
        return { kind: 'error', text: `失败：${error?.message ?? error}` }
      }
    },
  }))
}
