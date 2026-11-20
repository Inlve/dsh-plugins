import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { compileRules, describeEscalation, evaluateRules } from '../lib/policy.js'

const WS = path.resolve('/work/ws')
const OUTSIDE = path.resolve('/work/other')

function request(overrides = {}) {
  return {
    tool: 'pwsh',
    mode: 'danger-full-access',
    justification: 'cargo needs the network to fetch crates',
    command: 'cargo fetch --locked',
    filePath: '',
    workdir: WS,
    sessionCwd: WS,
    ...overrides,
  }
}

test('compileRules drops rules it cannot evaluate safely', () => {
  const { rules, errors } = compileRules([
    { id: 'no-matcher', tools: ['pwsh'] },
    { id: 'file-without-path', tools: ['write'] },
    { tools: ['pwsh'], commandPrefix: 'cargo' },
    { id: 'bad-regex', commandPattern: '(unclosed' },
    { id: 'ok', commandPrefix: 'cargo fetch' },
  ])
  assert.deepEqual(rules.map((rule) => rule.id), ['ok'])
  assert.equal(errors.length, 4)
})

test('a rule defaults to the narrowest ceiling', () => {
  const { rules } = compileRules([{ id: 'ok', commandPrefix: 'cargo fetch' }])
  assert.equal(rules[0].maxMode, 'workspace-write')
  const verdict = evaluateRules(rules, request())
  assert.equal(verdict.decision, 'ask')
  assert.ok(verdict.notes.some((note) => note.includes('exceeds maxMode')))
})

test('a matching prefix grants only when the mode is within the ceiling', () => {
  const { rules } = compileRules([{ id: 'fetch', commandPrefix: 'cargo fetch', maxMode: 'danger-full-access' }])
  assert.equal(evaluateRules(rules, request()).decision, 'grant')
  assert.equal(
    evaluateRules(rules, request({ command: 'cargo build --release' })).decision,
    'ask',
  )
})

test('shell operators are refused unless the rule opts in', () => {
  const strict = compileRules([{ id: 'fetch', commandPrefix: 'cargo fetch', maxMode: 'danger-full-access' }]).rules
  for (const command of ['cargo fetch; Remove-Item -Recurse C:\\', 'cargo fetch && del x', 'cargo fetch | cmd', 'cargo fetch `whoami`', 'cargo fetch $(whoami)', 'cargo fetch\nwhoami']) {
    const verdict = evaluateRules(strict, request({ command }))
    assert.equal(verdict.decision, 'ask', command)
    assert.ok(verdict.notes.some((note) => note.includes('shell operators')), command)
  }

  const loose = compileRules([{ id: 'fetch', commandPrefix: 'cargo fetch', maxMode: 'danger-full-access', allowShellOperators: true }]).rules
  assert.equal(evaluateRules(loose, request({ command: 'cargo fetch; whoami' })).decision, 'grant')
})

test('a workdir outside the session directory never matches without workdirPrefix', () => {
  const { rules } = compileRules([{ id: 'fetch', commandPrefix: 'cargo fetch', maxMode: 'danger-full-access' }])
  const verdict = evaluateRules(rules, request({ workdir: OUTSIDE }))
  assert.equal(verdict.decision, 'ask')
  assert.ok(verdict.notes.some((note) => note.includes('outside the session working directory')))
})

test('workdirPrefix widens the workdir only inside that directory', () => {
  const { rules } = compileRules([{
    id: 'fetch',
    commandPrefix: 'cargo fetch',
    maxMode: 'danger-full-access',
    workdirPrefix: OUTSIDE,
  }])
  assert.equal(evaluateRules(rules, request({ workdir: OUTSIDE })).decision, 'grant')
  assert.equal(evaluateRules(rules, request({ workdir: path.resolve('/work/elsewhere') })).decision, 'ask')
})

test('file rules match by resolved path prefix', () => {
  const { rules } = compileRules([{ id: 'git', tools: ['write', 'edit'], pathPrefix: OUTSIDE, maxMode: 'danger-full-access' }])
  const inside = request({ tool: 'write', filePath: path.join(OUTSIDE, 'a.txt'), command: '' })
  assert.equal(evaluateRules(rules, inside).decision, 'grant')
  const outside = request({ tool: 'write', filePath: path.join(WS, 'a.txt'), command: '' })
  assert.equal(evaluateRules(rules, outside).decision, 'ask')
})

test('a rule never covers a tool it does not list', () => {
  const { rules } = compileRules([{ id: 'fetch', tools: ['bash'], commandPrefix: 'cargo fetch', maxMode: 'danger-full-access' }])
  const verdict = evaluateRules(rules, request())
  assert.equal(verdict.decision, 'ask')
  assert.ok(verdict.notes.some((note) => note.includes('not covered')))
})

test('an empty justification is never auto-approved', () => {
  const { rules } = compileRules([{ id: 'fetch', commandPrefix: 'cargo fetch', maxMode: 'danger-full-access' }])
  assert.equal(evaluateRules(rules, request({ justification: '' })).decision, 'ask')
})

test('describeEscalation resolves a relative workdir against the session directory', () => {
  const described = describeEscalation('pwsh', {
    command: 'cargo fetch',
    workdir: 'sub',
    sandbox_permissions: 'danger-full-access',
    justification: ' reason ',
  }, WS)
  assert.equal(described.workdir, path.join(WS, 'sub'))
  assert.equal(described.justification, 'reason')
  assert.equal(described.sessionCwd, WS)
})
