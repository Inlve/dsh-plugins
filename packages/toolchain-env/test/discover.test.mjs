import assert from 'node:assert/strict'
import test from 'node:test'
import { describeDir, knownManagerIds, planWanted } from '../lib/discover.js'

const IS_WINDOWS = process.platform === 'win32'
const W = { skip: !IS_WINDOWS }

const ENV = {
  APPDATA: 'C:\\Users\\x\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
  USERPROFILE: 'C:\\Users\\x',
}

const FNM = 'C:\\Users\\x\\AppData\\Roaming\\fnm\\aliases\\default'
const PYENV = 'C:\\Users\\x\\.pyenv\\pyenv-win\\shims'

test('planWanted reports configured entries that are missing or unresolvable', W, () => {
  const plan = planWanted({
    pathEntries: ['C:\\Tools', '%NOPE%\\x', 'relative\\dir'],
    discover: false,
    env: ENV,
    exists: candidate => candidate.toLowerCase() === 'c:\\tools',
  })
  assert.deepEqual(plan.wanted, [{ path: 'C:\\Tools', source: 'config' }])
  assert.deepEqual(plan.missing, [])
  assert.equal(plan.unresolved.length, 2)
  assert.match(plan.unresolved[0].reason, /unresolved variable/)
  assert.match(plan.unresolved[1].reason, /not an absolute path/)
})

test('planWanted reports a configured directory that does not exist', W, () => {
  const plan = planWanted({
    pathEntries: ['C:\\Nope'],
    discover: false,
    env: ENV,
    exists: () => false,
  })
  assert.deepEqual(plan.missing, [{ entry: 'C:\\Nope', source: 'config' }])
  assert.deepEqual(plan.wanted, [])
})

test('planWanted discovers only managers whose directory exists', W, () => {
  const present = new Set([FNM.toLowerCase(), PYENV.toLowerCase()])
  const plan = planWanted({
    env: ENV,
    exists: candidate => present.has(candidate.toLowerCase()),
  })
  assert.deepEqual(plan.wanted.map(item => item.source).sort(), ['manager:fnm', 'manager:pyenv-win'])
  // An unset %NVM_SYMLINK% means "not installed", not a configuration error.
  assert.deepEqual(plan.unresolved, [])
})

test('planWanted honours the managers filter', W, () => {
  const plan = planWanted({
    managers: ['fnm'],
    env: ENV,
    exists: () => true,
  })
  assert.deepEqual(plan.wanted.map(item => item.source), ['manager:fnm'])
})

test('planWanted dedupes a directory claimed twice', W, () => {
  const plan = planWanted({
    pathEntries: [FNM],
    managers: ['fnm'],
    env: ENV,
    exists: () => true,
  })
  assert.equal(plan.wanted.length, 1)
  assert.equal(plan.wanted[0].source, 'config')
})

test('knownManagerIds covers the documented table', () => {
  const ids = knownManagerIds()
  for (const expected of ['fnm', 'pnpm', 'pyenv-win', 'rustup', 'winget', 'nvm-windows']) {
    assert.ok(ids.includes(expected), `missing ${expected}`)
  }
})

test('describeDir separates an empty directory from a populated one', () => {
  assert.deepEqual(
    describeDir('C:\\x', { exists: () => true, read: () => [] }),
    { exists: true, entries: 0, empty: true },
  )
  assert.deepEqual(
    describeDir('C:\\x', { exists: () => true, read: () => ['node.exe', 'npm.cmd'] }),
    { exists: true, entries: 2, empty: false },
  )
  assert.deepEqual(
    describeDir('C:\\x', { exists: () => false, read: () => [] }),
    { exists: false, entries: 0, empty: true },
  )
})
