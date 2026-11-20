/**
 * Workspace ACL guard.
 *
 * The Windows sandbox backend materializes its workspace write grant with one
 * SetNamedSecurityInfoW call that needs the caller to own the directory and to
 * hold WRITE_OWNER on it. An owner only receives READ_CONTROL and WRITE_DAC
 * implicitly, so a workspace whose DACL grants just Modify fails the grant
 * with Win32 5 and every confined command in it fails before it starts.
 *
 * This plugin restores that precondition ahead of time: it inspects every DSH
 * workspace (and each new session's working directory), and when the grant
 * would fail it adds one inheritable FullControl allow ACE for the signed-in
 * user. It never removes an ACE, never changes the owner, and never touches a
 * deny, an SACL, a reparse point or a NULL DACL.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { compileRules, describeEscalation, evaluateRules } from './lib/policy.js'
import { createAudit } from './lib/audit.js'
import { classifyRoot, normalizeRoots } from './lib/trust.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.join(HERE, 'scripts', 'acl.ps1')
const RESULT_MARKER = 'ACL_RESULT '
const IS_WINDOWS = process.platform === 'win32'
const TOOL_NAME = 'workspace_acl'

const DEFAULTS = {
  autoRepair: true,
  checkOnSessionStart: true,
  scanOnActivate: true,
  reportDir: '',
  powershell: '',
  timeoutMs: 180000,
  cacheTtlMs: 60000,
  escalation: { enabled: false, rules: [] },
  trust: { roots: [], autoGrantOnSessionStart: true },
}

const VOLATILE = schema => (typeof schema?.volatile === 'function' ? schema.volatile() : schema)

export const Config = Schema.object({
  autoRepair: Schema.boolean()
    .default(DEFAULTS.autoRepair)
    .description('Repair a workspace whose DACL lacks WRITE_OWNER instead of only reporting it.'),
  checkOnSessionStart: Schema.boolean()
    .default(DEFAULTS.checkOnSessionStart)
    .description('Check each new session working directory and gate its first tool call on that check.'),
  scanOnActivate: Schema.boolean()
    .default(DEFAULTS.scanOnActivate)
    .description('Scan every registered workspace shortly after the plugin loads.'),
  reportDir: Schema.string()
    .default(DEFAULTS.reportDir)
    .description('Directory for DACL backups, the workspace history log, and the escalation audit; empty means ~/.dsh/sandbox-guard.'),
  powershell: Schema.string()
    .default(DEFAULTS.powershell)
    .description('PowerShell executable; empty tries pwsh.exe first, then powershell.exe.'),
  timeoutMs: Schema.number()
    .default(DEFAULTS.timeoutMs)
    .description('Timeout for one inspect or repair run, in milliseconds.'),
  cacheTtlMs: Schema.number()
    .default(DEFAULTS.cacheTtlMs)
    .description('How long one path result stays cached, in milliseconds.'),
  escalation: Schema.object({
    enabled: Schema.boolean()
      .default(false)
      .description('Answer matching sandbox escalations with allowed-once instead of asking. Off by default; no rule applies until enabled.'),
    rules: Schema.array(Schema.object({
      id: Schema.string().required().description('Stable rule id, recorded in every audit entry.'),
      title: Schema.string().default('').description('Human-readable purpose, shown in the audit trail.'),
      tools: Schema.array(Schema.string()).default(['pwsh', 'bash'])
        .description('Tools this rule covers: pwsh/bash read a command, write/edit read file_path.'),
      commandPrefix: Schema.string().default('')
        .description('A shell command must start with this exact text. One of commandPrefix/commandPattern is required for shell tools.'),
      commandPattern: Schema.string().default('')
        .description('A shell command must match this regular expression. One of commandPrefix/commandPattern is required for shell tools.'),
      pathPrefix: Schema.string().default('')
        .description('A file tool path must resolve inside this directory. Required for write/edit.'),
      workdirPrefix: Schema.string().default('')
        .description('Allow a shell rule whose workdir is outside the session directory but inside this one. Empty keeps it to the session directory.'),
      maxMode: Schema.string().default('workspace-write')
        .description('Ceiling this rule may grant: workspace-write or danger-full-access. Defaults to the narrowest.'),
      allowShellOperators: Schema.boolean().default(false)
        .description('Also match commands containing shell operators (; | & < > backtick $( ). Only enable if the prefix itself cannot be chained.'),
    })).default([]),
  }).default({}),
  trust: Schema.object({
    roots: Schema.array(Schema.object({
      path: Schema.string().required()
        .description('Absolute directory that receives the sandbox write grant, for example a package cache.'),
      note: Schema.string().default('')
        .description('Why this directory is trusted.'),
      acknowledgeRisk: Schema.boolean().default(false)
        .description('Confirms the risk of a flagged path (on PATH, an app-data root, executable content, or a workspace ancestor). The grant lowers the directory integrity level.'),
    })).default([])
      .description('Extra directories kept writable for confined commands. Each grant copies the workspace capability ACE and the Low integrity label, so any low-integrity process of this user may write it — not only DSH.'),
    autoGrantOnSessionStart: Schema.boolean().default(true)
      .description('Grant every configured root for the new session workspace when the grant is missing.'),
  }).default({}),
  trustRoots: VOLATILE(Schema.string().default(''))
    .description('Trusted directories edited from the panel: one per line, "path | note", with %VAR% expansion. Append " !ack" to a line the classifier flags as risky. Applies on the next command or session, without a restart.'),
  trustAutoGrant: VOLATILE(Schema.boolean().default(true))
    .description('Auto-grant the panel list for every session workspace. Turn off to keep the list as documentation only.'),
})

const ATTENTION = new Set([
  'missing', 'not-directory', 'reparse-point', 'null-dacl', 'blocked',
  'error', 'unsupported', 'unknown',
])

const state = { powershell: undefined }

export const inject = ['tools', 'commands', 'workspaceRegistry']

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  // The plugin used to be called access-guard; carry its data over once so the
  // DACL backups, history and escalation audit keep their single home.
  let defaultReportDir = path.join(homedir(), '.dsh', 'sandbox-guard')
  const legacyReportDir = path.join(homedir(), '.dsh', 'access-guard')
  try {
    if (!fs.existsSync(defaultReportDir) && fs.existsSync(legacyReportDir)) {
      fs.renameSync(legacyReportDir, defaultReportDir)
    }
  } catch {
    if (!fs.existsSync(defaultReportDir) && fs.existsSync(legacyReportDir)) defaultReportDir = legacyReportDir
  }
  const reportDir = path.resolve(config.reportDir || defaultReportDir)
  const cache = new Map()
  const inflight = new Map()
  let historyDirReady = false
  const audit = createAudit(reportDir)
  const liveConfig = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {}

  const extraRootsFile = path.join(reportDir, 'roots.json')

  /** Parse the panel's "path | note" lines; a trailing " !ack" acknowledges risk. */
  function parseRootsText(text) {
    const objects = []
    for (const rawLine of String(text ?? '').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (line === '' || line.startsWith('#')) continue
      const acknowledged = /\s!ack$/i.test(line)
      const body = acknowledged ? line.replace(/\s!ack$/i, '') : line
      const [rawPath, ...rest] = body.split('|')
      const pathText = rawPath.trim()
      if (pathText === '') continue
      objects.push({ path: pathText, note: rest.join('|').trim(), acknowledgeRisk: acknowledged })
    }
    return normalizeRoots(objects)
  }

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

  /** The panel list, read from the live (volatile) config so a save needs no restart. */
  function liveRoots() {
    const text = readVolatile(liveConfig.trustRoots)
    return parseRootsText(typeof text === 'string' ? text : '')
  }

  function autoGrantEnabled() {
    const live = readVolatile(liveConfig.trustAutoGrant)
    if (typeof live === 'boolean') return live
    const fallback = readVolatile(config.trustAutoGrant)
    return typeof fallback === 'boolean' ? fallback : true
  }

  function readExtraRoots() {
    try {
      const parsed = JSON.parse(fs.readFileSync(extraRootsFile, 'utf8'))
      return normalizeRoots(parsed?.roots)
    } catch {
      return []
    }
  }

  function writeExtraRoots(roots) {
    try {
      fs.mkdirSync(reportDir, { recursive: true })
      fs.writeFileSync(extraRootsFile, JSON.stringify({ at: new Date().toISOString(), roots }, null, 2), 'utf8')
      return true
    } catch {
      return false
    }
  }

  /** Configured roots plus the ones added from the panel, deduplicated by path. */
  function effectiveRoots() {
    const out = []
    const seen = new Set()
    for (const [origin, list] of [['config', config.trust.roots], ['panel', liveRoots()], ['file', readExtraRoots()]]) {
      for (const root of list) {
        const key = IS_WINDOWS ? root.path.toLowerCase() : root.path
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ ...root, origin })
      }
    }
    return out
  }

  const compiled = compileRules(config.escalation.rules)
  /** Pending escalated calls, keyed by tool call id, captured before dispatch. */
  const pendingEscalations = new Map()
  const PENDING_TTL_MS = 10 * 60 * 1000

  function normalizeConfig(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const merged = { ...DEFAULTS }
    if (typeof input.autoRepair === 'boolean') merged.autoRepair = input.autoRepair
    if (typeof input.checkOnSessionStart === 'boolean') merged.checkOnSessionStart = input.checkOnSessionStart
    if (typeof input.scanOnActivate === 'boolean') merged.scanOnActivate = input.scanOnActivate
    if (typeof input.reportDir === 'string' && input.reportDir.trim() !== '') merged.reportDir = input.reportDir.trim()
    if (typeof input.powershell === 'string' && input.powershell.trim() !== '') merged.powershell = input.powershell.trim()
    if (Number.isFinite(input.timeoutMs) && input.timeoutMs >= 5000) merged.timeoutMs = Math.floor(input.timeoutMs)
    if (Number.isFinite(input.cacheTtlMs) && input.cacheTtlMs >= 0) merged.cacheTtlMs = Math.floor(input.cacheTtlMs)
    const escalation = input.escalation && typeof input.escalation === 'object' ? input.escalation : {}
    merged.escalation = {
      enabled: escalation.enabled === true,
      rules: Array.isArray(escalation.rules) ? escalation.rules : [],
    }
    const trust = input.trust && typeof input.trust === 'object' && !Array.isArray(input.trust) ? input.trust : {}
    merged.trust = {
      roots: normalizeRoots(trust.roots),
      autoGrantOnSessionStart: trust.autoGrantOnSessionStart !== false,
    }
    return merged
  }

  async function record(entry) {
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`
    try {
      if (!historyDirReady) {
        await mkdir(reportDir, { recursive: true })
        historyDirReady = true
      }
      await appendFile(path.join(reportDir, 'history.jsonl'), line, 'utf8')
    } catch {
      // History is best effort; the live result is authoritative.
    }
    try {
      ctx.logger?.info?.(`[sandbox-guard] ${line.trim()}`)
    } catch {
      // A missing logger must never fail an operation.
    }
  }

  function tail(text, limit = 2000) {
    const value = String(text ?? '')
    return value.length <= limit ? value : `…${value.slice(-limit)}`
  }

  // --------------------------------------------------------------- PowerShell

  function runProcess(executable, args, timeoutMs) {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) {
        resolve({ spawned: false, error: error?.message ?? String(error) })
        return
      }
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (payload) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(payload)
      }
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* already gone */ }
        finish({ spawned: true, timedOut: true, stdout, stderr })
      }, Math.max(1000, timeoutMs))
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk) => { stdout += chunk })
      child.stderr?.on('data', (chunk) => { stderr += chunk })
      child.on('error', (error) => finish({ spawned: false, error: error?.message ?? String(error), stdout, stderr }))
      child.on('close', (code) => finish({ spawned: true, code, stdout, stderr }))
    })
  }

  async function resolvePowerShell() {
    if (config.powershell) return config.powershell
    if (state.powershell !== undefined) return state.powershell
    for (const candidate of ['pwsh.exe', 'powershell.exe']) {
      const probe = await runProcess(candidate, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], 15000)
      if (probe.spawned && probe.code === 0) {
        state.powershell = candidate
        return candidate
      }
    }
    state.powershell = null
    return null
  }

  function parseResult(stdout) {
    for (const line of String(stdout ?? '').split(/\r?\n/)) {
      const index = line.indexOf(RESULT_MARKER)
      if (index === -1) continue
      try {
        const value = JSON.parse(line.slice(index + RESULT_MARKER.length))
        if (value && typeof value === 'object') return value
      } catch {
        // Another marker line later in the stream may still parse.
      }
    }
    return undefined
  }

  async function runAcl(target, mode, options = {}) {
    if (!IS_WINDOWS) {
      return {
        ok: false,
        mode,
        path: target,
        readiness: 'unsupported',
        error: { code: 'unsupported-platform', message: 'Windows file permissions are only managed on Windows.' },
      }
    }
    const executable = await resolvePowerShell()
    if (!executable) {
      return {
        ok: false,
        mode,
        path: target,
        readiness: 'unsupported',
        error: {
          code: 'powershell-unavailable',
          message: 'Neither pwsh.exe nor powershell.exe could be started; set the plugin config field `powershell` to an absolute executable path.',
        },
      }
    }
    const args = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT_PATH,
      '-Path', target,
      '-Mode', mode,
      '-BackupDir', reportDir,
      ...(options.source ? ['-Source', options.source] : []),
      ...(Number.isFinite(options.maxObjects) ? ['-MaxObjects', String(Math.floor(options.maxObjects))] : []),
    ]
    const timeout = mode.startsWith('trust_')
      ? Math.min(config.timeoutMs, 60000)
      : mode === 'prepare' || mode === 'reach_repair'
        ? config.timeoutMs
        : mode === 'reach'
          ? Math.min(config.timeoutMs, 120000)
          : Math.min(config.timeoutMs, 45000)
    const run = await runProcess(executable, args, timeout)
    if (!run.spawned) {
      return {
        ok: false, mode, path: target, readiness: 'error',
        error: { code: 'powershell-start-failed', message: run.error ?? 'Could not start PowerShell.' },
      }
    }
    const parsed = parseResult(run.stdout)
    if (parsed) return parsed
    return {
      ok: false,
      mode,
      path: target,
      readiness: 'error',
      error: {
        code: run.timedOut ? 'timeout' : 'unparsable-output',
        message: run.timedOut
          ? `The permission ${mode} run exceeded ${timeout} ms.`
          : 'PowerShell produced no parseable result.',
        stderr: tail(run.stderr),
      },
    }
  }

  // ------------------------------------------------------------ orchestration

  function readinessOf(result) {
    const value = result?.readiness
    return typeof value === 'string' && value !== '' ? value : 'unknown'
  }

  function isHealthy(result) {
    return result?.ok === true && readinessOf(result) === 'ready'
  }

  function needsAttention(result) {
    return ATTENTION.has(readinessOf(result))
  }

  async function ensure(target, mode) {
    const key = path.resolve(target)
    const cached = cache.get(key)
    if (cached && Date.now() - cached.at < config.cacheTtlMs) {
      if (mode === 'check') return cached.result
      if (isHealthy(cached.result)) return cached.result
    }
    const pending = inflight.get(key)
    if (pending) {
      const result = await pending.catch(() => undefined)
      if (mode === 'check' || isHealthy(result)) return result
    }
    const job = (async () => {
      const result = await runAcl(key, mode)
      cache.set(key, { at: Date.now(), result })
      return result
    })()
    inflight.set(key, job)
    try {
      return await job
    } finally {
      if (inflight.get(key) === job) inflight.delete(key)
    }
  }

  function describeFailure(result) {
    const readiness = readinessOf(result)
    if (readiness === 'needs-grant') return `missing WRITE_OWNER (repairable): ${result.path}`
    if (readiness === 'blocked') return `not owner and no WRITE_DAC (needs manual repair): ${result.path}`
    return `${readiness}: ${result?.path ?? ''}${result?.error?.message ? ` — ${result.error.message}` : ''}`
  }

  async function prepareAndRecord(target, mode) {
    const result = await ensure(target, mode)
    if (result?.changed === true || needsAttention(result)) {
      await record({
        event: result?.changed === true ? 'repaired' : mode === 'prepare' ? 'prepare-failed' : 'check-failed',
        path: result?.path ?? target,
        readiness: readinessOf(result),
        changed: result?.changed === true,
        verified: result?.verified === true,
        error: result?.error?.code,
      })
    }
    return result
  }

  async function autoFor(target, reason) {
    if (!IS_WINDOWS) return
    if (typeof target !== 'string' || target.trim() === '') return
    const absolute = path.resolve(target)
    const mode = config.autoRepair ? 'prepare' : 'check'
    const result = await prepareAndRecord(absolute, mode)
    if (needsAttention(result)) {
      await record({ event: 'attention', reason, path: absolute, readiness: readinessOf(result), error: result?.error?.code })
    }
  }

  const scanning = { running: false, promise: null }

  function workspacePaths() {
    try {
      return ctx.workspaceRegistry.list()
        .map((workspace) => workspace?.path)
        .filter((value) => typeof value === 'string' && value !== '')
    } catch {
      return []
    }
  }

  function scanAll(reason) {
    if (scanning.running) return scanning.promise
    scanning.running = true
    scanning.promise = (async () => {
      const paths = [...new Set(workspacePaths().map((value) => path.resolve(value)))]
      for (const target of paths) {
        try {
          await autoFor(target, reason)
        } catch (error) {
          await record({ event: 'scan-failed', reason, path: target, error: String(error?.message ?? error) })
        }
      }
      return paths.length
    })()
    return scanning.promise.finally(() => {
      scanning.running = false
    })
  }

  function sessionCwd(session) {
    const value = session?.header?.cwd
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }

  function agentCwd(agent) {
    try {
      const live = ctx.get('agents')?.get?.(agent?.id)
      const session = live?.session
      if (!session) return undefined
      const resolved = ctx.get('workingDirectory')?.get?.(session)
      if (typeof resolved === 'string' && resolved.length > 0) return resolved
      return sessionCwd(session)
    } catch {
      return undefined
    }
  }

  function isInside(child, parent) {
    const relative = path.relative(parent, child)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  function bound(promise, ms) {
    return Promise.race([
      promise,
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve(undefined), ms)
        timer.unref?.()
      }),
    ])
  }

  // One gate per Session and directory: the first dispatched tool call in a
  // workspace waits for that workspace's check, so a repair cannot lose the
  // race against the command it exists to protect.
  const gated = new Map()

  function gatedBefore(sessionId, target) {
    let paths = gated.get(sessionId)
    if (!paths) {
      paths = new Set()
      gated.set(sessionId, paths)
    }
    if (paths.has(target)) return true
    paths.add(target)
    return false
  }

  function advisories(target) {
    if (!target) return []
    const notes = []
    const temp = path.resolve(tmpdir())
    if (isInside(temp, target)) notes.push('The system temp directory is inside this workspace; the sandbox rejects that layout.')
    if (isInside(target, temp)) notes.push('This workspace is inside the system temp directory; the sandbox rejects that layout.')
    return notes
  }

  // -------------------------------------------------------------- public faces

  function publicStatus(result) {
    return {
      schemaVersion: 1,
      path: result?.path ?? '',
      readiness: readinessOf(result),
      ok: result?.ok === true,
      changed: result?.changed === true,
      verified: result?.verified === true,
      owner: result?.owner ?? null,
      currentUser: result?.currentUser ?? null,
      isOwner: result?.isOwner === true,
      writeDac: result?.writeDac === true,
      writeOwner: result?.writeOwner === true,
      protectedAcl: result?.accessRulesProtected === true,
      nullDacl: result?.nullDacl === true,
      denies: result?.denies ?? [],
      ancestors: result?.ancestors ?? [],
      backup: result?.backup ?? null,
      reach: result?.reach ?? null,
      advisories: advisories(result?.path ?? ''),
      error: result?.error ?? null,
    }
  }

  async function toolStatus(target) {
    const result = await prepareAndRecord(target, 'check')
    return { ok: result?.ok === true, action: 'status', workspaces: [publicStatus(result)] }
  }

  async function toolPrepare(target) {
    const result = await prepareAndRecord(target, 'prepare')
    return {
      ok: result?.ok === true,
      action: 'prepare',
      workspaces: [publicStatus(result)],
      repaired: result?.changed === true && result?.verified === true,
      message: readinessOf(result) === 'ready'
        ? (result?.changed === true ? 'Permissions repaired and verified.' : 'Already ready; nothing changed.')
        : describeFailure(result),
    }
  }

  async function toolReach(target, repair, maxObjects) {
    const mode = repair ? 'reach_repair' : 'reach'
    const result = await runAcl(target, mode, { maxObjects })
    const reach = result?.reach ?? null
    await record({
      event: mode,
      path: result?.path ?? target,
      objects: reach?.objects ?? 0,
      missingAce: reach?.missingAce ?? 0,
      repaired: reach?.repaired ?? 0,
      failed: reach?.failed ?? 0,
      changed: reach?.changedCount ?? 0,
    })
    return { ok: result?.ok === true, action: mode, workspaces: [publicStatus(result)] }
  }

  function formatReach(payload) {
    const entry = payload?.workspaces?.[0]
    const reach = entry?.reach
    if (!reach) return '扫描失败：没有返回覆盖结果'
    const lines = [
      `授权覆盖：扫描 ${reach.objects} 个目录；缺能力 ACE ${reach.missingAce} 个，缺 Low 标签 ${reach.missingLabel} 个`,
    ]
    if (reach.truncated) lines.push('（已到扫描上限，结果不完整，可用更大的 limit 重跑）')
    if (payload.action === 'reach_repair') {
      lines.push(`本次修复 ${reach.repaired} 个，失败 ${reach.failed} 个`)
      if (reach.backup?.script) lines.push(`回滚脚本：${reach.backup.script}`)
    }
    for (const path of (reach.samples ?? []).slice(0, 8)) lines.push(`  ${path}`)
    for (const failure of (reach.failures ?? []).slice(0, 5)) lines.push(`  ✗ ${failure.path}: ${failure.error}`)
    if (reach.note) lines.push(reach.note)
    return lines.join('\n')
  }

  async function toolPrepareAll() {
    const paths = [...new Set(workspacePaths().map((value) => path.resolve(value)))]
    const workspaces = []
    for (const target of paths) {
      try {
        const result = await prepareAndRecord(target, config.autoRepair ? 'prepare' : 'check')
        workspaces.push(publicStatus(result))
      } catch (error) {
        workspaces.push({
          path: target,
          readiness: 'error',
          ok: false,
          changed: false,
          verified: false,
          error: { code: 'unexpected', message: String(error?.message ?? error) },
        })
      }
    }
    return {
      ok: workspaces.every((entry) => entry.readiness === 'ready'),
      action: 'prepare_all',
      workspaces,
      repaired: workspaces.filter((entry) => entry.changed && entry.verified).length,
      total: workspaces.length,
    }
  }

  function requirePath(args, agent) {
    const explicit = typeof args?.path === 'string' && args.path.trim() !== '' ? args.path.trim() : undefined
    if (explicit) return { target: path.resolve(explicit) }
    const inferred = agentCwd(agent)
    if (inferred) return { target: path.resolve(inferred) }
    return {
      error: {
        code: 'path-required',
        message: 'Pass an absolute workspace path; the session working directory could not be resolved.',
      },
    }
  }

  const READINESS_LABEL = {
    ready: '已就绪',
    'needs-grant': '缺少 WRITE_OWNER，可修复',
    blocked: '非所有者且无 WRITE_DAC，需手动处理',
    missing: '目录不存在',
    'not-directory': '不是目录',
    'reparse-point': '是符号链接/重解析点',
    'null-dacl': 'DACL 为 NULL，不自动修改',
    unsupported: '当前环境不支持',
    error: '检查出错',
  }

  function formatHuman(payload) {
    const lines = []
    if (payload?.error) {
      lines.push(`失败：${payload.error.message ?? payload.error.code ?? 'unknown error'}`)
      return lines.join('\n')
    }
    if (payload.action === 'prepare_all') {
      lines.push(`工作区授权：共检查 ${payload.total} 个，本次修复 ${payload.repaired} 个`)
    }
    for (const entry of payload.workspaces ?? []) {
      const mark = entry.readiness === 'ready' ? '✓' : entry.readiness === 'needs-grant' ? '!' : '✗'
      lines.push(`${mark} ${entry.path}`)
      lines.push(`    ${READINESS_LABEL[entry.readiness] ?? entry.readiness}${entry.changed ? '（已修改并校验）' : ''}`)
      if (entry.readiness !== 'ready' && entry.error?.message) lines.push(`    ${entry.error.message}`)
      for (const note of entry.advisories ?? []) lines.push(`    提示：${note}`)
      if (entry.backup?.script) lines.push(`    回滚脚本：${entry.backup.script}`)
    }
    if (payload.action === 'prepare' && payload.message) lines.push(payload.message)
    return lines.join('\n')
  }

  // -------------------------------------------------------------- escalation

  function prunePending() {
    const cutoff = Date.now() - PENDING_TTL_MS
    for (const [callId, entry] of pendingEscalations) {
      if (entry.at < cutoff) pendingEscalations.delete(callId)
    }
    while (pendingEscalations.size > 200) {
      const oldest = pendingEscalations.keys().next().value
      if (oldest === undefined) break
      pendingEscalations.delete(oldest)
    }
  }

  function captureEscalation(exec) {
    try {
      const args = exec?.arguments
      if (!args || typeof args !== 'object') return
      if (typeof args.sandbox_permissions !== 'string' || args.sandbox_permissions === '') return
      const callId = String(exec.callId ?? '')
      if (callId === '') return
      const record = describeEscalation(String(exec.name ?? ''), args, agentCwd(exec.agent))
      record.callId = callId
      record.sessionId = String(exec.agent?.id ?? '')
      record.at = Date.now()
      pendingEscalations.set(callId, record)
      prunePending()
    } catch {
      // Capture is best effort: a missed record only means the ask stays manual.
    }
  }

  async function decideEscalation(req, next) {
    try {
      const callId = String(req?.callId ?? '')
      const pending = callId === '' ? undefined : pendingEscalations.get(callId)
      if (!pending) return await next()
      pendingEscalations.delete(callId)
      if (!config.escalation.enabled) return await next()

      const verdict = evaluateRules(compiled.rules, pending)
      const granted = verdict.decision === 'grant'
      await audit.append({
        at: new Date().toISOString(),
        decision: granted ? 'granted' : 'asked',
        rule: verdict.rule?.id ?? null,
        ruleTitle: verdict.rule?.title ?? '',
        tool: pending.tool,
        mode: pending.mode,
        sessionId: pending.sessionId,
        callId,
        command: pending.command || null,
        filePath: pending.filePath || null,
        workdir: pending.workdir ?? null,
        justification: pending.justification,
        notes: granted ? [] : verdict.notes.slice(0, 6),
      })
      return granted ? 'allowed-once' : await next()
    } catch {
      return await next()
    }
  }

  function escalationState() {
    return {
      enabled: config.escalation.enabled,
      rules: compiled.rules,
      errors: compiled.errors,
      auditFile: audit.file,
      pendingCount: pendingEscalations.size,
      pending: [...pendingEscalations.values()].slice(-5).map((entry) => ({
        callId: entry.callId,
        tool: entry.tool,
        mode: entry.mode,
        command: entry.command.slice(0, 120),
        filePath: entry.filePath,
        at: new Date(entry.at).toISOString(),
      })),
    }
  }

  function testEscalation(args, agent) {
    const sessionCwd = agentCwd(agent)
    const tool = typeof args?.tool === 'string' && args.tool !== '' ? args.tool : 'pwsh'
    const mode = typeof args?.mode === 'string' && args.mode !== '' ? args.mode : 'danger-full-access'
    const workdir = typeof args?.workdir === 'string' && args.workdir !== ''
      ? path.resolve(sessionCwd ?? process.cwd(), args.workdir)
      : sessionCwd
    const request = {
      tool,
      mode,
      justification: 'dry run from escalation_policy test',
      command: typeof args?.command === 'string' ? args.command : '',
      filePath: typeof args?.file_path === 'string' ? args.file_path : '',
      workdir,
      sessionCwd,
    }
    const verdict = evaluateRules(compiled.rules, request)
    return { request, decision: verdict.decision, rule: verdict.rule?.id ?? null, notes: verdict.notes }
  }

  function formatEscalation(entries) {
    const lines = []
    for (const entry of entries) {
      const subject = entry.command ?? entry.filePath ?? '(no subject)'
      const rule = entry.rule ? `${entry.rule}${entry.ruleTitle ? ` (${entry.ruleTitle})` : ''}` : '无规则'
      const verdict = entry.decision === 'granted' ? '自动放行' : '转人工'
      lines.push(`${entry.at}  ${verdict}  ${entry.tool}→${entry.mode}  ${rule}`)
      lines.push(`    ${subject}`)
      if (entry.justification) lines.push(`    理由：${entry.justification}`)
    }
    return lines
  }

  // -------------------------------------------------------------------- trust

  function configuredRoot(target) {
    const resolved = path.resolve(target)
    const key = IS_WINDOWS ? resolved.toLowerCase() : resolved
    return effectiveRoots().find((root) => (IS_WINDOWS ? root.path.toLowerCase() : root.path) === key) ?? null
  }

  async function toolTrustCheck(target, source) {
    if (!source) {
      return { ok: false, action: 'trust_check', path: path.resolve(target), error: { code: 'missing-source', message: 'no session workspace is available to supply the sandbox identity' } }
    }
    const result = await runAcl(target, 'trust_check', { source })
    return { ok: result.ok === true, action: 'trust_check', ...result, risk: classifyRoot(target, { workspace: source }) }
  }

  async function toolTrustGrant(target, source) {
    const configured = configuredRoot(target)
    if (!configured) {
      return {
        ok: false,
        action: 'trust_grant',
        path: path.resolve(target),
        error: {
          code: 'not-configured',
          message: 'only a configured trust.roots entry can be granted; add it to the plugin config first',
        },
      }
    }
    if (!source) {
      return { ok: false, action: 'trust_grant', path: configured.path, error: { code: 'missing-source', message: 'no session workspace is available to supply the sandbox identity' } }
    }
    const risk = classifyRoot(configured.path, { workspace: source })
    if (!risk.ok) {
      return { ok: false, action: 'trust_grant', path: configured.path, risk, error: { code: 'blocked-path', message: 'this path must never receive the sandbox write grant', blocked: risk.blocked } }
    }
    if (risk.risky.length > 0 && !configured.acknowledgeRisk) {
      return {
        ok: false,
        action: 'trust_grant',
        path: configured.path,
        risk,
        error: {
          code: 'risk-not-acknowledged',
          message: 'this path is risky; review the reasons, then set acknowledgeRisk: true on the trust root to confirm',
          risky: risk.risky,
        },
      }
    }
    const result = await runAcl(configured.path, 'trust_grant', { source })
    await record({ event: 'trust-grant', reason: 'tool', path: configured.path, source, readiness: result.readiness, ok: result.ok === true, risky: risk.risky })
    return { ok: result.ok === true, action: 'trust_grant', ...result, risk }
  }

  async function toolTrustRevoke(target, source) {
    // Revoking only shrinks authority, so it is allowed for any absolute path:
    // that is also how a stray grant or a removed panel entry is cleaned up.
    if (!source) {
      return { ok: false, action: 'trust_revoke', path: path.resolve(target), error: { code: 'missing-source', message: 'no session workspace is available to supply the sandbox identity' } }
    }
    const resolved = path.resolve(target)
    const result = await runAcl(resolved, 'trust_revoke', { source })
    await record({ event: 'trust-revoke', reason: 'tool', path: resolved, source, readiness: result.readiness, ok: result.ok === true })
    return { ok: result.ok === true, action: 'trust_revoke', ...result }
  }

  async function toolTrustList(exec) {
    const source = agentCwd(exec?.agent) ?? null
    const roots = []
    for (const root of effectiveRoots()) {
      const risk = classifyRoot(root.path, { workspace: source ?? undefined })
      let stateInfo = { checked: false }
      if (source) {
        const result = await runAcl(root.path, 'trust_check', { source })
        stateInfo = {
          checked: true,
          granted: result.trust?.granted === true,
          hasAce: result.trust?.hasAce === true,
          hasLabel: result.trust?.hasLabel === true,
          note: result.trust?.note ?? null,
          error: result.error?.code ?? null,
        }
      }
      roots.push({ path: root.path, note: root.note, acknowledgeRisk: root.acknowledgeRisk, origin: root.origin, risk, state: stateInfo })
    }
    return { ok: true, action: 'trust_list', source, roots }
  }

  /** Add a directory from the panel; only a persisted entry may be granted. */
  async function toolTrustAdd(target, source, options = {}) {
    const resolved = path.resolve(target)
    const key = IS_WINDOWS ? resolved.toLowerCase() : resolved
    const risk = classifyRoot(resolved, { workspace: source ?? undefined })
    if (!risk.ok) {
      return { ok: false, action: 'trust_add', path: resolved, risk, error: { code: 'blocked-path', message: 'this path must never receive the sandbox write grant', blocked: risk.blocked } }
    }
    if (risk.risky.length > 0 && options.acknowledgeRisk !== true) {
      return {
        ok: false,
        action: 'trust_add',
        path: resolved,
        risk,
        error: {
          code: 'risk-not-acknowledged',
          message: 'this path is risky; confirm it explicitly to add it',
          risky: risk.risky,
        },
      }
    }
    const existing = effectiveRoots().some((root) => (IS_WINDOWS ? root.path.toLowerCase() : root.path) === key)
    if (existing) {
      return { ok: false, action: 'trust_add', path: resolved, risk, error: { code: 'already-listed', message: 'this directory is already trusted' } }
    }
    const roots = readExtraRoots()
    roots.push({ path: resolved, note: typeof options.note === 'string' ? options.note : '', acknowledgeRisk: options.acknowledgeRisk === true })
    if (!writeExtraRoots(roots)) {
      return { ok: false, action: 'trust_add', path: resolved, error: { code: 'write-failed', message: 'could not persist the trust list' } }
    }
    await record({ event: 'trust-add', path: resolved, risky: risk.risky })
    const grant = source ? await toolTrustGrant(resolved, source) : null
    return { ok: true, action: 'trust_add', path: resolved, risk, grant }
  }

  /** Remove a panel-added entry and revoke its grant. */
  async function toolTrustRemove(target, source) {
    const resolved = path.resolve(target)
    const key = IS_WINDOWS ? resolved.toLowerCase() : resolved
    const roots = readExtraRoots()
    const next = roots.filter((root) => (IS_WINDOWS ? root.path.toLowerCase() : root.path) !== key)
    if (next.length === roots.length) {
      const fromConfig = config.trust.roots.some((root) => (IS_WINDOWS ? root.path.toLowerCase() : root.path) === key)
      return {
        ok: false,
        action: 'trust_remove',
        path: resolved,
        error: {
          code: fromConfig ? 'configured-static' : 'not-listed',
          message: fromConfig
            ? 'this directory comes from the plugin config, not the panel; remove it there'
            : 'this directory is not in the panel trust list',
        },
      }
    }
    writeExtraRoots(next)
    await record({ event: 'trust-remove', path: resolved })
    const revoke = source ? await toolTrustRevoke(resolved, source) : null
    return { ok: true, action: 'trust_remove', path: resolved, revoke }
  }

  async function toolTrustSelfTest(exec, options = {}) {
    const source = agentCwd(exec?.agent) ?? null
    if (!source) {
      return { ok: false, action: 'trust_self_test', error: { code: 'missing-source', message: 'no session workspace is available to supply the sandbox identity' } }
    }
    const probe = path.join(process.env.LOCALAPPDATA || tmpdir(), 'dsh-sandbox-guard-probe')
    const keep = options.keep === true
    const steps = []
    const push = (step, value) => steps.push({ step, ...value })
    let leaveInPlace = false
    try {
      // A previous "keep" run leaves the probe granted; clear it before reusing.
      if (fs.existsSync(probe)) {
        const revoked = await runAcl(probe, 'trust_revoke', { source })
        push('revoke-existing', { ok: revoked.ok === true, readiness: revoked.readiness })
        fs.rmSync(probe, { recursive: true, force: true })
        if (!keep) {
          return { ok: revoked.ok === true, action: 'trust_self_test', probe, source, steps, cleaned: true }
        }
      }
      fs.mkdirSync(probe, { recursive: true })
      push('create', { ok: true, path: probe })

      const granted = await runAcl(probe, 'trust_grant', { source })
      push('grant', { ok: granted.ok === true, readiness: granted.readiness, trust: granted.trust ?? null, error: granted.error ?? null })
      if (!granted.ok) {
        push('revoke', { skipped: true })
        return { ok: false, action: 'trust_self_test', probe, source, steps, error: granted.error ?? { code: 'grant-failed', message: 'the probe grant failed' } }
      }

      if (keep) {
        leaveInPlace = true
        await record({ event: 'trust-self-test', probe, source, phase: 'grant', kept: true })
        return { ok: true, action: 'trust_self_test', probe, source, steps, kept: true, hint: 'now write into the probe from a confined command, then run trust_self_test again without keep to revoke and remove it' }
      }

      const revoked = await runAcl(probe, 'trust_revoke', { source })
      push('revoke', { ok: revoked.ok === true, readiness: revoked.readiness, error: revoked.error ?? null })
      await record({ event: 'trust-self-test', probe, source, granted: true, revoked: revoked.ok === true })
      return { ok: revoked.ok === true, action: 'trust_self_test', probe, source, steps }
    } catch (error) {
      return { ok: false, action: 'trust_self_test', probe, steps, error: { code: 'self-test-failed', message: String(error?.message ?? error) } }
    } finally {
      if (!leaveInPlace) {
        try { fs.rmSync(probe, { recursive: true, force: true }) } catch { /* left for manual cleanup */ }
      }
    }
  }

  async function grantAllTrusted(source, reason) {
    if (!autoGrantEnabled() || !source) return
    const roots = effectiveRoots()
    if (roots.length === 0) return
    for (const root of roots) {
      const risk = classifyRoot(root.path, { workspace: source })
      if (!risk.ok) {
        await record({ event: 'trust-skip', reason, path: root.path, blocked: risk.blocked })
        continue
      }
      if (risk.risky.length > 0 && !root.acknowledgeRisk) {
        await record({ event: 'trust-skip', reason, path: root.path, risky: risk.risky })
        continue
      }
      const result = await runAcl(root.path, 'trust_grant', { source })
      await record({ event: 'trust-grant', reason, path: root.path, source, readiness: result.readiness, ok: result.ok === true })
    }
  }

  const lastTrustListFile = path.join(reportDir, 'last-trust-roots.json')

  function readLastTrustPaths() {
    try {
      const parsed = JSON.parse(fs.readFileSync(lastTrustListFile, 'utf8'))
      return Array.isArray(parsed?.paths)
        ? parsed.paths.filter(value => typeof value === 'string' && value !== '')
        : []
    } catch {
      return []
    }
  }

  function writeLastTrustPaths(paths) {
    try {
      fs.mkdirSync(reportDir, { recursive: true })
      fs.writeFileSync(lastTrustListFile, JSON.stringify({ at: new Date().toISOString(), paths }, null, 2), 'utf8')
    } catch {
      // Best effort; a failed write only means the next pass re-derives.
    }
  }

  function registeredWorkspaces() {
    try {
      return [...new Set((ctx.workspaceRegistry?.list?.() ?? [])
        .map(workspace => workspace?.path)
        .filter(value => typeof value === 'string' && value !== ''))]
    } catch {
      return []
    }
  }

  function samePathList(left, right) {
    if (left.length !== right.length) return false
    const keys = new Set(left.map(value => value.toLowerCase()))
    return right.every(value => keys.has(value.toLowerCase()))
  }

  /**
   * Reconcile the OS grants with the current trust list, without needing a
   * session: an entry removed from the list loses this workspace's capability
   * ACE on every registered workspace, and the remaining entries keep it.
   */
  async function reconcileTrust(reason) {
    if (!autoGrantEnabled()) return false
    const current = effectiveRoots().map(root => root.path)
    const previous = readLastTrustPaths()
    if (samePathList(previous, current)) return false

    const currentKeys = new Set(current.map(value => value.toLowerCase()))
    const removed = previous.filter(value => !currentKeys.has(value.toLowerCase()))
    const workspaces = registeredWorkspaces()

    for (const target of removed) {
      for (const workspace of workspaces) {
        const result = await runAcl(target, 'trust_revoke', { source: workspace })
        await record({ event: 'trust-revoke', reason: `removed-${reason}`, path: target, source: workspace, readiness: result.readiness, ok: result.ok === true })
      }
    }

    writeLastTrustPaths(current)
    for (const workspace of workspaces) {
      await grantAllTrusted(workspace, reason)
    }
    return true
  }

  function formatTrust(payload) {
    if (payload.action === 'trust_list') {
      const lines = [`信任目录：${payload.roots.length} 个（工作区 ${payload.source ?? '未知'}）`]
      for (const root of payload.roots) {
        const stateInfo = !root.state.checked
          ? '未检查'
          : root.state.granted
            ? '已授权'
            : root.state.error
              ? `检查失败(${root.state.error})`
              : '未授权'
        const flags = [
          root.risk.blocked.length > 0 ? `禁止:${root.risk.blocked.join(',')}` : '',
          root.risk.risky.length > 0 ? `风险:${root.risk.risky.join(',')}` : '',
          root.acknowledgeRisk ? '已确认风险' : '',
        ].filter(Boolean).join(' ')
        lines.push(`  ${root.path}  ${stateInfo}  [${root.origin ?? 'config'}]${flags ? `  ${flags}` : ''}`)
      }
      if (payload.roots.length === 0) lines.push('（未配置；在插件 config 的 trust.roots 里添加）')
      return lines.join('\n')
    }
    if (payload.error) {
      const extra = [
        payload.error.risky ? `风险：${payload.error.risky.join(',')}` : '',
        payload.error.blocked ? `禁止：${payload.error.blocked.join(',')}` : '',
      ].filter(Boolean).join('；')
      return `失败：${payload.error.message}${extra ? `（${extra}）` : ''}`
    }
    if (payload.action === 'trust_self_test') {
      const lines = [`自检：${payload.probe}`]
      for (const step of payload.steps ?? []) {
        const outcome = step.ok === true ? 'ok' : step.skipped ? 'skipped' : 'failed'
        lines.push(`  ${step.step}: ${outcome}`)
      }
      return lines.join('\n')
    }
    if (payload.action === 'trust_add') return `已添加到信任列表：${payload.path}`
    if (payload.action === 'trust_remove') return `已从信任列表移除：${payload.path}`
    return `${payload.action} ${payload.path ?? ''} → ${payload.readiness ?? 'unknown'}`
  }

  // ------------------------------------------------------------------ surfaces

  // Escalation policy: remember every escalated call before dispatch, then
  // answer the approval that follows when a configured rule covers it. Both
  // listeners stay registered even while the policy is disabled, so enabling it
  // does not need a reload.
  ctx.on('tools/pre-execute', (exec, next) => {
    captureEscalation(exec)
    return next()
  })
  // Prepend: the policy must judge the request before any other answerer can
  // resolve it, otherwise a broader auto-approver wins and the rule never runs.
  ctx.on('approval/request', (req, next) => decideEscalation(req, next), true)

  if (IS_WINDOWS && config.scanOnActivate) {
    const timer = setTimeout(() => {
      scanAll('activate').catch(() => { /* recorded per path */ })
    }, 2500)
    timer.unref?.()
    ctx.effect(() => () => clearTimeout(timer))
  }

  if (IS_WINDOWS && config.checkOnSessionStart) {
    ctx.on('session/created', (session) => {
      const cwd = sessionCwd(session)
      if (!cwd) return
      autoFor(cwd, 'session-start').catch(() => { /* recorded per path */ })
    })

    // The Session-start check is asynchronous. Waiting for it here keeps the
    // promise that no confined command starts before its workspace is ready.
    ctx.on('tools/pre-execute', async (exec, next) => {
      try {
        const cwd = agentCwd(exec?.agent)
        const sessionId = exec?.agent?.id
        if (cwd && sessionId) {
          const target = path.resolve(cwd)
          if (!gatedBefore(sessionId, target)) {
            const result = await bound(ensure(target, config.autoRepair ? 'prepare' : 'check'), 20000)
            if (result && needsAttention(result)) {
              await record({
                event: 'attention',
                reason: 'pre-tool',
                path: target,
                readiness: readinessOf(result),
                error: result?.error?.code,
              })
            }
          }
        }
      } catch {
        // The guard must never block a tool call it cannot reason about.
      }
      return next()
    })
  }

  if (IS_WINDOWS && config.trust.autoGrantOnSessionStart && autoGrantEnabled() && effectiveRoots().length > 0) {
    ctx.on('session/created', (session) => {
      const cwd = sessionCwd(session)
      if (cwd) grantAllTrusted(cwd, 'session-start').catch(() => { /* recorded per root */ })
    })
  }

  if (IS_WINDOWS) {
    // Volatile config edits do not restart the plugin, so catch up on the next
    // commands and once after boot for every registered workspace — the panel
    // never needs a session id.
    const timer = setTimeout(() => {
      reconcileTrust('activate').catch(() => { /* recorded per root */ })
    }, 2500)
    timer.unref?.()
    ctx.effect(() => () => clearTimeout(timer))

    let lastTrustSignature = ''
    let lastTrustCheck = 0
    ctx.on('tools/pre-execute', (exec, next) => {
      try {
        const now = Date.now()
        if (now - lastTrustCheck >= 5000) {
          lastTrustCheck = now
          const signature = effectiveRoots().map(root => root.path.toLowerCase()).join('|')
          if (signature !== lastTrustSignature) {
            lastTrustSignature = signature
            void reconcileTrust('config-change')
          }
        }
      } catch {
        // Never block a tool call on trust bookkeeping.
      }
      return next()
    })
  }

  ctx.effect(() => ctx.tools.register({
    name: TOOL_NAME,
    description: [
      'Check and prepare Windows file-permission prerequisites for a DSH workspace before running confined commands in it.',
      'The Windows sandbox needs the workspace directory to be owned by the signed-in user and to grant that user WRITE_OWNER;',
      'otherwise provisioning the write grant fails and every confined command in that workspace fails with an access error.',
      'Action "status" inspects without changing anything; "prepare" adds one FullControl allow ACE for the signed-in user when the',
      'precondition is missing, verifies the result and records a rollback script; "prepare_all" does that for every registered workspace.',
      'Action "reach" scans whether the sandbox grant actually reaches the directories inside the workspace: the grant is one standing ACE',
      'plus one Low integrity label on the root, so directories that already existed when it was applied keep failing writes from the',
      'confined child. "reach_repair" extends the same ACE and label to those directories (explicit, backed up, verified).',
      'Use it right after creating or picking a new workspace, before the first command.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'prepare', 'prepare_all', 'reach', 'reach_repair', 'trust_list', 'trust_check', 'trust_grant', 'trust_revoke', 'trust_self_test', 'trust_add', 'trust_remove'],
          description: 'status = inspect only; prepare = repair the workspace root; prepare_all = repair every registered workspace; reach = scan how far the sandbox grant reaches inside the tree; reach_repair = extend it to directories that miss it; trust_list = configured trusted roots and their grant state; trust_check/grant/revoke = inspect, extend or remove the sandbox write grant of one directory; trust_add/trust_remove = persist or drop a trust entry (the panel uses the same path); trust_self_test = end-to-end probe on a temporary directory.',
        },
        acknowledgeRisk: {
          type: 'boolean',
          description: 'trust_add only: required to add a path the classifier flags as risky (its reasons are returned otherwise).',
        },
        source: {
          type: 'string',
          description: 'trust actions only: the workspace whose sandbox identity is extended. Defaults to the session working directory.',
        },
        keep: {
          type: 'boolean',
          description: 'trust_self_test only: leave the probe directory granted and in place so a confined command can test writing into it; call again without keep to revoke and remove it.',
        },
        path: {
          type: 'string',
          description: 'Absolute workspace directory. Defaults to the current session working directory when it can be resolved.',
        },
        limit: {
          type: 'number',
          description: 'reach/reach_repair only: maximum directories to walk, 1-50000. Defaults to 20000.',
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
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const action = args?.action
      if (action === 'prepare_all') return toolPrepareAll()
      if (action === 'trust_list') return toolTrustList(exec)
      if (action === 'trust_self_test') return toolTrustSelfTest(exec, { keep: args?.keep === true })
      if (action === 'trust_check' || action === 'trust_grant' || action === 'trust_revoke' || action === 'trust_add' || action === 'trust_remove') {
        const raw = typeof args?.path === 'string' ? args.path.trim() : ''
        if (raw === '') return { ok: false, action, error: { code: 'missing-path', message: 'path is required for a trust action' } }
        const target = path.resolve(raw)
        const source = typeof args?.source === 'string' && args.source.trim() !== ''
          ? path.resolve(args.source)
          : agentCwd(exec?.agent)
        if (action === 'trust_check') return toolTrustCheck(target, source)
        if (action === 'trust_grant') return toolTrustGrant(target, source)
        if (action === 'trust_revoke') return toolTrustRevoke(target, source)
        if (action === 'trust_add') {
          return toolTrustAdd(target, source, {
            acknowledgeRisk: args?.acknowledgeRisk === true,
            note: typeof args?.note === 'string' ? args.note : '',
          })
        }
        return toolTrustRemove(target, source)
      }
      const located = requirePath(args, exec?.agent)
      if (located.error) return { ok: false, action: action ?? 'status', error: located.error }
      if (action === 'reach' || action === 'reach_repair') {
        const limit = Number.isFinite(args?.limit) ? Math.min(50000, Math.max(1, Math.floor(args.limit))) : 20000
        return toolReach(located.target, action === 'reach_repair', limit)
      }
      if (action === 'prepare') return toolPrepare(located.target)
      return toolStatus(located.target)
    },
  }))

  ctx.effect(() => ctx.commands.register({
    name: 'acl',
    description: '检查和修复工作区的 Windows 文件权限（沙箱写入授权的前置条件）',
    input: { hint: '[status|prepare|prepare-all] [绝对路径]' },
    recordInput: false,
    async handler(invocation) {
      const parts = String(invocation.rawInput ?? '').trim().split(/\s+/).filter(Boolean)
      const verb = (parts[0] ?? 'status').toLowerCase()
      const explicitPath = parts.slice(1).join(' ').trim()
      try {
        if (verb === 'prepare-all' || verb === 'prepare_all' || verb === 'all') {
          return { kind: 'success', text: formatHuman(await toolPrepareAll()) }
        }
        const located = explicitPath
          ? { target: path.resolve(explicitPath) }
          : requirePath({}, invocation.agent)
        if (located.error) return { kind: 'error', text: `失败：${located.error.message}` }
        if (verb === 'reach' || verb === 'reach-repair' || verb === 'reach_repair') {
          return { kind: 'success', text: formatReach(await toolReach(located.target, verb !== 'reach', undefined)) }
        }
        const payload = verb === 'prepare'
          ? await toolPrepare(located.target)
          : verb === 'status'
            ? await toolStatus(located.target)
            : undefined
        if (!payload) return { kind: 'error', text: '用法：/acl [status|prepare|prepare-all] [绝对路径]' }
        return { kind: 'success', text: formatHuman(payload) }
      } catch (error) {
        return { kind: 'error', text: `失败：${error?.message ?? String(error)}` }
      }
    },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'escalation_policy',
    description: [
      'Read the sandbox escalation policy of this installation: the configured rules, a dry-run evaluation of a proposed escalated call,',
      'and the recent auto-approval audit trail. Every sandbox-enforcing tool (pwsh, bash, write, edit) accepts sandbox_permissions plus a',
      'justification for a one-shot wider mode; that request is normally answered by the user, and a matching rule here answers it instead.',
      'This tool never grants, executes, or changes anything. Use action "test" to check whether a command would be auto-approved before',
      'attempting the escalated call.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'test', 'audit'],
          description: 'list = rules and load errors; test = dry-run one proposed escalation; audit = recent decisions.',
        },
        tool: { type: 'string', description: 'test only: tool name, such as pwsh, bash, write, or edit.' },
        command: { type: 'string', description: 'test only: the shell command to evaluate.' },
        file_path: { type: 'string', description: 'test only: the file path for write/edit.' },
        workdir: { type: 'string', description: 'test only: working directory; defaults to the session working directory.' },
        mode: {
          type: 'string',
          enum: ['workspace-write', 'danger-full-access'],
          description: 'test only: the escalated mode to evaluate; defaults to danger-full-access.',
        },
        limit: { type: 'number', description: 'audit only: how many recent entries to return, 1-200.' },
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
      const action = args?.action
      if (action === 'list') return { ok: true, action, ...escalationState() }
      if (action === 'test') return { ok: true, action, ...testEscalation(args, exec?.agent) }
      if (action === 'audit') {
        const raw = Number(args?.limit)
        const limit = Number.isFinite(raw) ? Math.min(200, Math.max(1, Math.floor(raw))) : 20
        return { ok: true, action, auditFile: audit.file, entries: await audit.tail(limit) }
      }
      return { ok: false, error: { code: 'unknown-action', message: 'action must be list, test, or audit' } }
    },
  }))

  ctx.effect(() => ctx.commands.register({
    name: 'grants',
    description: '查看沙箱提权策略与最近的自动放行记录',
    input: { hint: '[list|audit] [条数]' },
    recordInput: false,
    async handler(invocation) {
      const parts = String(invocation.rawInput ?? '').trim().split(/\s+/).filter(Boolean)
      const verb = (parts[0] ?? 'list').toLowerCase()
      try {
        if (verb === 'audit') {
          const raw = Number.parseInt(parts[1] ?? '10', 10)
          const limit = Number.isFinite(raw) ? Math.min(100, Math.max(1, raw)) : 10
          const entries = await audit.tail(limit)
          if (entries.length === 0) return { kind: 'success', text: `暂无提权记录（${audit.file}）` }
          return { kind: 'success', text: formatEscalation(entries).join('\n') }
        }
        const state = escalationState()
        const lines = [`提权策略：${state.enabled ? '已启用' : '未启用'}（${state.rules.length} 条规则）`]
        for (const rule of state.rules) {
          const matcher = rule.commandPrefix
            ? `命令前缀 ${rule.commandPrefix}`
            : rule.commandPattern
              ? `正则 ${rule.commandPattern}`
              : `路径 ${rule.pathPrefix}`
          lines.push(`  ${rule.id}  → ${rule.maxMode}  [${rule.tools.join(',')}]  ${matcher}`)
        }
        for (const error of state.errors) {
          lines.push(`  ⚠ 规则 #${error.index}${error.id ? ` (${error.id})` : ''}: ${error.message}`)
        }
        if (!state.enabled) lines.push('把 escalation.enabled 设为 true 后生效（Plugins 页或 cordis.patch.yml）。')
        lines.push(`审计文件：${state.auditFile}`)
        return { kind: 'success', text: lines.join('\n') }
      } catch (error) {
        return { kind: 'error', text: `失败：${error?.message ?? String(error)}` }
      }
    },
  }))

  ctx.effect(() => ctx.commands.register({
    name: 'trust',
    description: '查看、添加、授予或撤销沙箱信任目录（缓存等公共可写目录）',
    input: { hint: '[list|add <路径>|remove <路径>|grant <路径>|revoke <路径>|self-test] [--json] [--ack-risk]' },
    recordInput: false,
    async handler(invocation) {
      const parts = String(invocation?.rawInput ?? '').trim().split(/\s+/).filter(Boolean)
      const flags = new Set(parts.filter(part => part.startsWith('--')))
      const args = parts.filter(part => !part.startsWith('--'))
      const verb = (args[0] ?? 'list').toLowerCase()
      const rawTarget = args.slice(1).join(' ').trim().replace(/^["']|["']$/g, '')
      const asJson = flags.has('--json')
      const render = (kind, payload) => ({
        kind: payload.ok ? 'success' : 'error',
        text: asJson ? JSON.stringify(payload) : formatTrust(payload),
      })
      try {
        if (verb === 'self-test' || verb === 'selftest') {
          return render('success', await toolTrustSelfTest({ agent: invocation?.agent }))
        }
        if (verb === 'add' || verb === 'remove') {
          if (rawTarget === '') return { kind: 'error', text: `用法：/trust ${verb} <绝对路径>${verb === 'add' ? ' [--ack-risk]' : ''}` }
          const source = agentCwd(invocation?.agent)
          const target = path.resolve(rawTarget)
          const payload = verb === 'add'
            ? await toolTrustAdd(target, source, { acknowledgeRisk: flags.has('--ack-risk') })
            : await toolTrustRemove(target, source)
          return render(verb, payload)
        }
        if (verb === 'grant' || verb === 'revoke') {
          if (rawTarget === '') return { kind: 'error', text: '用法：/trust grant|revoke <绝对路径>' }
          const source = agentCwd(invocation?.agent)
          const target = path.resolve(rawTarget)
          const payload = verb === 'grant'
            ? await toolTrustGrant(target, source)
            : await toolTrustRevoke(target, source)
          return render(verb, payload)
        }
        return { kind: 'success', text: asJson ? JSON.stringify(await toolTrustList({ agent: invocation?.agent })) : formatTrust(await toolTrustList({ agent: invocation?.agent })) }
      } catch (error) {
        return { kind: 'error', text: `失败：${error?.message ?? String(error)}` }
      }
    },
  }))
}
