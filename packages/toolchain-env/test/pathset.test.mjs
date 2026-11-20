import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  composePath,
  expandEntry,
  inspectPathValue,
  keyOf,
  pathextList,
  readPathValue,
  splitPathList,
  whichList,
  writePathValue,
} from '../lib/pathset.js'

const SEP = path.delimiter
const IS_WINDOWS = process.platform === 'win32'
const W = { skip: !IS_WINDOWS }

test('expandEntry expands environment variables and a leading tilde', W, () => {
  const env = { APPDATA: 'C:\\Users\\x\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\x' }
  assert.equal(
    expandEntry('%APPDATA%\\fnm\\aliases\\default', env).path.toLowerCase(),
    'c:\\users\\x\\appdata\\roaming\\fnm\\aliases\\default',
  )
  assert.equal(expandEntry('~\\bin', env).path.toLowerCase(), path.join(os.homedir(), 'bin').toLowerCase())
})

test('expandEntry refuses an unset variable and a relative path', () => {
  const env = { USERPROFILE: 'C:\\Users\\x' }
  assert.match(expandEntry('%NVM_SYMLINK%', env).error, /unresolved variable/)
  assert.match(expandEntry('relative\\dir', env).error, /not an absolute path/)
  assert.match(expandEntry('', env).error, /empty/)
})

test('writePathValue reuses the existing key instead of creating PATH', () => {
  const env = { Path: 'C:\\a' }
  const written = writePathValue(env, 'C:\\a;C:\\b')
  assert.deepEqual(written, ['Path'])
  assert.deepEqual(Object.keys(env), ['Path'])
  assert.equal(readPathValue(env), 'C:\\a;C:\\b')
})

test('writePathValue creates Path when the environment has no PATH key', () => {
  const env = {}
  assert.deepEqual(writePathValue(env, 'C:\\a'), ['Path'])
  assert.equal(env.Path, 'C:\\a')
})

test('composePath appends and skips directories already present', () => {
  const a = path.join(os.tmpdir(), 'tc-a')
  const b = path.join(os.tmpdir(), 'tc-b')
  const { value, added } = composePath({
    baseline: [a].join(SEP),
    wanted: [{ path: a }, { path: b }],
    position: 'append',
  })
  assert.deepEqual(added.map(item => item.path), [b])
  assert.equal(value, [a, b].join(SEP))
})

test('composePath is idempotent when the previous addition is passed back', () => {
  const baseline = path.join(os.tmpdir(), 'tc-base')
  const fnm = path.join(os.tmpdir(), 'tc-fnm')
  const first = composePath({ baseline, wanted: [{ path: fnm }], position: 'append' })
  const second = composePath({
    baseline,
    previousAdded: first.added,
    wanted: [{ path: fnm }],
    position: 'append',
  })
  assert.equal(second.value, first.value)
  assert.equal(second.added.length, 1)
})

test('composePath removes a directory that is no longer wanted', () => {
  const baseline = path.join(os.tmpdir(), 'tc-base')
  const fnm = path.join(os.tmpdir(), 'tc-fnm')
  const first = composePath({ baseline, wanted: [{ path: fnm }], position: 'append' })
  const second = composePath({ baseline, previousAdded: first.added, wanted: [], position: 'append' })
  assert.equal(second.value, baseline)
  assert.deepEqual(second.added, [])
})

test('composePath prepend puts new directories first', () => {
  const base = path.join(os.tmpdir(), 'tc-base')
  const fnm = path.join(os.tmpdir(), 'tc-fnm')
  const { value } = composePath({ baseline: base, wanted: [{ path: fnm }], position: 'prepend' })
  assert.equal(value, [fnm, base].join(SEP))
})

test('splitPathList drops empty segments and inspectPathValue counts them', () => {
  const value = ['a', '', 'b'].join(SEP)
  assert.deepEqual(splitPathList(value), ['a', 'b'])
  assert.deepEqual(inspectPathValue(value), { segments: ['a', 'b'], emptySegments: 1 })
  assert.deepEqual(inspectPathValue(''), { segments: [], emptySegments: 0 })
})

test('pathextList reads a differently cased key and normalizes dots', () => {
  assert.deepEqual(pathextList({ Pathext: 'EXE;.CMD;.exe' }), ['.EXE', '.CMD'])
  assert.deepEqual(pathextList({}), ['.COM', '.EXE', '.BAT', '.CMD'])
})

test('whichList follows PATH order, then PATHEXT order inside a directory', W, () => {
  const first = path.join(os.tmpdir(), 'tc-dir1')
  const second = path.join(os.tmpdir(), 'tc-dir2')
  const existing = new Set([
    path.join(first, 'node.exe').toLowerCase(),
    path.join(first, 'node.cmd').toLowerCase(),
    path.join(second, 'node.cmd').toLowerCase(),
  ])
  const matches = whichList('node', [first, second].join(SEP), {
    pathext: ['.EXE', '.CMD'],
    exists: candidate => existing.has(candidate.toLowerCase()),
  })
  assert.equal(matches.length, 2)
  assert.equal(matches[0].path.toLowerCase(), path.join(first, 'node.exe').toLowerCase())
  assert.equal(matches[1].path.toLowerCase(), path.join(second, 'node.cmd').toLowerCase())
})

test('whichList resolves an explicit command name with its extension', W, () => {
  const dir = path.join(os.tmpdir(), 'tc-dir3')
  const existing = new Set([path.join(dir, 'npm.CMD').toLowerCase()])
  const matches = whichList('npm.cmd', [dir].join(SEP), {
    pathext: ['.EXE', '.CMD'],
    exists: candidate => existing.has(candidate.toLowerCase()),
  })
  assert.equal(matches.length, 1)
  assert.equal(matches[0].path.toLowerCase(), path.join(dir, 'npm.cmd').toLowerCase())
})

test('whichList prefers the executable extension over an extensionless shim', W, () => {
  const dir = path.join(os.tmpdir(), 'tc-dir4')
  const existing = new Set([
    path.join(dir, 'corepack').toLowerCase(),
    path.join(dir, 'corepack.cmd').toLowerCase(),
  ])
  const matches = whichList('corepack', [dir].join(SEP), {
    pathext: ['.EXE', '.CMD'],
    exists: candidate => existing.has(candidate.toLowerCase()),
  })
  assert.equal(matches.length, 1)
  assert.equal(matches[0].path.toLowerCase(), path.join(dir, 'corepack.cmd').toLowerCase())
})

test('whichList treats a dotted name as a name, not as an extension', W, () => {
  const dir = path.join(os.tmpdir(), 'tc-dir5')
  const existing = new Set([path.join(dir, 'python3.11.exe').toLowerCase()])
  const matches = whichList('python3.11', [dir].join(SEP), {
    pathext: ['.EXE'],
    exists: candidate => existing.has(candidate.toLowerCase()),
  })
  assert.equal(matches.length, 1)
  assert.equal(matches[0].path.toLowerCase(), path.join(dir, 'python3.11.exe').toLowerCase())
})

test('keyOf folds case on Windows and keeps a drive root intact', W, () => {
  assert.equal(keyOf('C:\\Tools\\'), keyOf('c:\\tools'))
  assert.equal(keyOf('C:\\'), 'c:\\')
})
