import assert from 'node:assert/strict'
import test from 'node:test'
import { MANAGERS } from '../lib/discover.js'
import { commandNameOf, isExecutableName, parseVersionOutput, pickCommands, scanManagers, summarizeScan } from '../lib/scan.js'

const IS_WINDOWS = process.platform === 'win32'
// The built-in manager table is spelled with Windows locations (%APPDATA%, …),
// so its expansion can only be exercised on Windows. The pure helpers below
// take an explicit platform and run everywhere.
const W = { skip: IS_WINDOWS ? false : 'the built-in manager table is Windows-shaped' }

const ENV = {
  APPDATA: 'C:\\Users\\x\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
  USERPROFILE: 'C:\\Users\\x',
}
const key = value => String(value).toLowerCase()

test('isExecutableName accepts only command-shaped files on Windows', () => {
  for (const name of ['node.exe', 'npm.cmd', 'build.bat', 'tool.COM']) {
    assert.equal(isExecutableName(name, { windows: true }), true, name)
  }
  for (const name of ['LICENSE', 'node_modules', '.hidden', 'README.md', 'lib.dll', '']) {
    assert.equal(isExecutableName(name, { windows: true }), false, name)
  }
})

test('isExecutableName keeps extensionless commands elsewhere and drops data files', () => {
  assert.equal(isExecutableName('python3', { windows: false }), true)
  assert.equal(isExecutableName('node', { windows: false }), true)
  assert.equal(isExecutableName('README.md', { windows: false }), false)
  assert.equal(isExecutableName('package.json', { windows: false }), false)
  assert.equal(isExecutableName('.DS_Store', { windows: false }), false)
})

test('commandNameOf strips the executable extension on Windows only', () => {
  assert.equal(commandNameOf('node.exe', { windows: true }), 'node')
  assert.equal(commandNameOf('npm.cmd', { windows: true }), 'npm')
  assert.equal(commandNameOf('node', { windows: true }), 'node')
  assert.equal(commandNameOf('python3.11', { windows: true }), 'python3.11')
  assert.equal(commandNameOf('python3', { windows: false }), 'python3')
})

test('pickCommands dedupes, sorts and caps at six names', () => {
  const windows = pickCommands(['node.exe', 'node.cmd', 'npm.cmd', 'npx.cmd', 'corepack.cmd', 'LICENSE', 'install_tools.bat', 'a.exe', 'b.exe'], { windows: true })
  assert.deepEqual(windows, ['a', 'b', 'corepack', 'install_tools', 'node', 'npm'])

  const capped = pickCommands(Array.from({ length: 9 }, (_, index) => `tool${index}.exe`), { windows: true })
  assert.equal(capped.length, 6)
  assert.deepEqual(capped, ['tool0', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5'])

  assert.deepEqual(pickCommands(['python3', 'python', 'README.md'], { windows: false }), ['python', 'python3'])
  assert.deepEqual(pickCommands([], { windows: true }), [])
})

test('parseVersionOutput finds the first version anywhere in the output', () => {
  assert.equal(parseVersionOutput('v22.11.0\n'), '22.11.0')
  assert.equal(parseVersionOutput('npm 10.2.4'), '10.2.4')
  assert.equal(parseVersionOutput('cargo 1.75.0 (1d8b05cdd 2023-11-20)'), '1.75.0')
  assert.equal(parseVersionOutput('go version go1.22.0 windows/amd64'), '1.22.0')
  assert.equal(parseVersionOutput('', 'warning: something 2.1.3'), '2.1.3')
  assert.equal(parseVersionOutput('no version here'), null)
  assert.equal(parseVersionOutput(undefined, null, ''), null)
})

test('scanManagers describes every candidate directory of the table', W, () => {
  const fnmDir = `${ENV.APPDATA}\\fnm\\aliases\\default`
  const pnpmDir = `${ENV.LOCALAPPDATA}\\pnpm`
  const files = {
    [key(fnmDir)]: ['corepack.cmd', 'node.exe', 'npm.cmd', 'npx.cmd', 'LICENSE'],
    [key(pnpmDir)]: ['pnpm.exe'],
  }
  const present = new Set(Object.keys(files))
  const entries = scanManagers({
    env: ENV,
    exists: candidate => present.has(key(candidate)),
    read: dir => files[key(dir)] ?? [],
    platform: 'win32',
  })

  assert.equal(entries.length, MANAGERS.reduce((total, manager) => total + manager.dirs.length, 0))

  const fnm = entries.find(entry => entry.manager === 'fnm')
  assert.equal(fnm.id, 'fnm', 'a single-directory manager keeps its id')
  assert.equal(fnm.path, fnmDir)
  assert.equal(fnm.template, '%APPDATA%\\fnm\\aliases\\default')
  assert.equal(fnm.exists, true)
  assert.equal(fnm.entries, 5)
  assert.equal(fnm.empty, false)
  assert.deepEqual(fnm.commands, ['corepack', 'node', 'npm', 'npx'])

  // pnpm owns two directories, so both rows get a distinct id.
  const pnpmRows = entries.filter(entry => entry.manager === 'pnpm')
  assert.deepEqual(pnpmRows.map(entry => entry.id), ['pnpm#1', 'pnpm#2'])
  assert.equal(pnpmRows[0].exists, true)
  assert.equal(pnpmRows[1].exists, false)

  // An unset %NVM_SYMLINK% means "not installed", reported without throwing.
  const nvm = entries.find(entry => entry.manager === 'nvm-windows')
  assert.equal(nvm.exists, false)
  assert.match(nvm.unresolved, /unresolved variable/)
})

test('scanManagers with describe:false only stats the directories', W, () => {
  const fnmDir = `${ENV.APPDATA}\\fnm\\aliases\\default`
  const entries = scanManagers({
    env: ENV,
    exists: candidate => key(candidate) === key(fnmDir),
    read: () => { throw new Error('must not read when describe is false') },
    describe: false,
    platform: 'win32',
  })
  const fnm = entries.find(entry => entry.manager === 'fnm')
  assert.equal(fnm.exists, true)
  assert.equal(fnm.entries, 0)
  assert.deepEqual(fnm.commands, [])
})

test('scanManagers does not throw when a directory cannot be read', W, () => {
  const entries = scanManagers({
    env: ENV,
    exists: () => true,
    read: () => { throw new Error('EACCES') },
    managers: ['fnm'],
    platform: 'win32',
  })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].exists, true)
  assert.deepEqual(entries[0].commands, [])
})

test('scanManagers honours the managers filter', W, () => {
  const entries = scanManagers({ env: ENV, exists: () => false, managers: ['fnm', 'go'], platform: 'win32' })
  assert.deepEqual(entries.map(entry => entry.manager), ['fnm', 'go'])
})

test('summarizeScan counts installed candidates and ones with commands', () => {
  assert.deepEqual(
    summarizeScan([
      { exists: true, commands: ['node'] },
      { exists: true, commands: [] },
      { exists: false, commands: [] },
    ]),
    { total: 3, installed: 2, withCommands: 1 },
  )
  assert.deepEqual(summarizeScan([]), { total: 0, installed: 0, withCommands: 0 })
})
