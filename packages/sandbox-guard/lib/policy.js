/**
 * Escalation policy matching.
 *
 * DSH already has one escalation protocol for every sandbox-enforcing family:
 * `sandbox_permissions` + `justification` on a single call, resolved through
 * `ctx.approval.request()`. This module decides whether a configured rule lets
 * that request be answered `allowed-once` without asking the user.
 *
 * The rules are pure data and this module is pure: it never spawns, never
 * writes, and never sees the approval channel.
 */

import path from 'node:path'

/** Tools whose escalated argument is a shell command string. */
export const SHELL_TOOLS = new Set(['pwsh', 'bash', 'shell'])

/** Tools whose escalated argument is a single filesystem path. */
export const FILE_TOOLS = new Set(['write', 'edit'])

/** Mode ranking; an escalation may only reach a mode at or below the rule's ceiling. */
const MODE_RANK = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }

const SHELL_OPERATORS = /[\r\n;|&<>`]|\$\(/

/** The narrowest mode a rule may grant when its `maxMode` is missing or unknown. */
const NARROWEST_MODE = 'workspace-write'

function modeRank(mode) {
  return MODE_RANK[mode] ?? -1
}

function isWithin(child, parent) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function asString(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * Normalize the raw `escalation` config section into compiled rules plus the
 * problems that made a rule unusable. An invalid rule is dropped rather than
 * guessed at: a policy that silently broadens is worse than one that does
 * nothing.
 */
export function compileRules(rawRules) {
  const rules = []
  const errors = []
  const list = Array.isArray(rawRules) ? rawRules : []

  for (const [index, raw] of list.entries()) {
    if (!raw || typeof raw !== 'object') {
      errors.push({ index, message: 'rule is not an object' })
      continue
    }
    const id = asString(raw.id).trim()
    if (id === '') {
      errors.push({ index, message: 'rule has no id' })
      continue
    }
    const tools = Array.isArray(raw.tools) && raw.tools.length > 0
      ? raw.tools.filter((tool) => typeof tool === 'string' && tool !== '')
      : [...SHELL_TOOLS]
    const commandPrefix = asString(raw.commandPrefix).trim()
    const commandPattern = asString(raw.commandPattern).trim()
    const pathPrefix = asString(raw.pathPrefix).trim()
    const workdirPrefix = asString(raw.workdirPrefix).trim()
    const maxMode = asString(raw.maxMode).trim()

    const touchesShell = tools.some((tool) => SHELL_TOOLS.has(tool))
    const touchesFiles = tools.some((tool) => FILE_TOOLS.has(tool))
    if (touchesShell && commandPrefix === '' && commandPattern === '') {
      errors.push({ index, id, message: 'rule targets a shell tool but has neither commandPrefix nor commandPattern' })
      continue
    }
    if (touchesFiles && pathPrefix === '') {
      errors.push({ index, id, message: 'rule targets a file tool but has no pathPrefix' })
      continue
    }
    if (commandPattern !== '') {
      try {
        // Compile once so a malformed pattern fails at load, not mid-turn.
        void new RegExp(commandPattern)
      } catch (error) {
        errors.push({ index, id, message: `commandPattern is not a valid regular expression: ${error?.message ?? error}` })
        continue
      }
    }

    rules.push({
      id,
      title: asString(raw.title).trim(),
      tools,
      commandPrefix,
      commandPattern,
      pathPrefix,
      workdirPrefix,
      maxMode: modeRank(maxMode) >= 0 ? maxMode : NARROWEST_MODE,
      allowShellOperators: raw.allowShellOperators === true,
    })
  }

  return { rules, errors }
}

/**
 * Describe one pending escalated call in the vocabulary the rules match on.
 * `args` is the parsed tool-call argument object; `sessionCwd` is the Session's
 * working directory, used to resolve a relative `workdir` exactly as the tool
 * does.
 */
export function describeEscalation(tool, args, sessionCwd) {
  const input = args && typeof args === 'object' ? args : {}
  const rawWorkdir = asString(input.workdir)
  const workdir = rawWorkdir === ''
    ? sessionCwd
    : path.resolve(sessionCwd ?? process.cwd(), rawWorkdir)
  return {
    tool,
    mode: asString(input.sandbox_permissions),
    justification: asString(input.justification).trim(),
    command: asString(input.command),
    filePath: asString(input.file_path),
    workdir,
    sessionCwd,
  }
}

/**
 * Decide one escalation against the compiled rules.
 *
 * Returns the first matching rule with `decision: 'grant'`, or
 * `decision: 'ask'` when nothing matches. Every rejection reason is kept so
 * the audit trail and the `test` action can explain a near miss.
 */
export function evaluateRules(rules, request) {
  const notes = []
  if (!request || typeof request !== 'object') return { rule: null, decision: 'ask', notes: ['no request'] }
  if (request.justification === '') {
    // Defence in depth: the tool layer already requires a non-empty one.
    return { rule: null, decision: 'ask', notes: ['no justification'] }
  }

  for (const rule of rules) {
    if (!rule.tools.includes(request.tool)) {
      notes.push(`${rule.id}: tool ${request.tool} not covered`)
      continue
    }
    if (modeRank(request.mode) > modeRank(rule.maxMode)) {
      notes.push(`${rule.id}: ${request.mode} exceeds maxMode ${rule.maxMode}`)
      continue
    }

    if (SHELL_TOOLS.has(request.tool)) {
      const command = request.command.trim()
      if (command === '') {
        notes.push(`${rule.id}: no command`)
        continue
      }
      if (!rule.allowShellOperators && SHELL_OPERATORS.test(command)) {
        notes.push(`${rule.id}: command contains shell operators`)
        continue
      }
      if (rule.commandPattern !== '' && !new RegExp(rule.commandPattern).test(command)) {
        notes.push(`${rule.id}: command does not match commandPattern`)
        continue
      }
      if (rule.commandPrefix !== '' && !command.startsWith(rule.commandPrefix)) {
        notes.push(`${rule.id}: command does not start with commandPrefix`)
        continue
      }
      if (rule.workdirPrefix !== '') {
        const prefix = path.resolve(rule.workdirPrefix)
        if (!request.workdir || !isWithin(request.workdir, prefix)) {
          notes.push(`${rule.id}: workdir is outside workdirPrefix`)
          continue
        }
      } else if (!request.workdir || !request.sessionCwd || !isWithin(request.workdir, request.sessionCwd)) {
        notes.push(`${rule.id}: workdir is outside the session working directory`)
        continue
      }
      return { rule, decision: 'grant', notes }
    }

    if (FILE_TOOLS.has(request.tool)) {
      if (request.filePath === '') {
        notes.push(`${rule.id}: no file_path`)
        continue
      }
      const prefix = path.resolve(rule.pathPrefix)
      if (!isWithin(path.resolve(request.filePath), prefix)) {
        notes.push(`${rule.id}: file_path is outside pathPrefix`)
        continue
      }
      return { rule, decision: 'grant', notes }
    }
  }

  return { rule: null, decision: 'ask', notes }
}
