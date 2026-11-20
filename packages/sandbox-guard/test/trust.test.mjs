import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { classifyRoot, normalizeRoots } from '../lib/trust.js'

const IS_WINDOWS = process.platform === 'win32'
const W = { skip: !IS_WINDOWS }

const ENV = {
  USERPROFILE: 'C:\\Users\\x',
  LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
  APPDATA: 'C:\\Users\\x\\AppData\\Roaming',
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  Path: 'C:\\Windows\\system32;C:\\Tools\\bin',
}

const noRead = () => []

test('normalizeRoots keeps absolute entries, dedupes and drops the rest', () => {
  const roots = normalizeRoots([
    { path: 'C:\\Data\\npm-cache', note: 'npm', acknowledgeRisk: true },
    { path: 'c:\\data\\NPM-CACHE', note: 'duplicate' },
    { path: 'relative\\dir' },
    { path: '' },
    'not-an-object',
  ])
  assert.equal(roots.length, 1)
  assert.equal(roots[0].note, 'npm')
  assert.equal(roots[0].acknowledgeRisk, true)
})

test('normalizeRoots expands %VAR% and an unset variable is dropped', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }
  const roots = normalizeRoots([
    { path: '%LOCALAPPDATA%\\npm-cache' },
    { path: '%NOPE%\\cache' },
  ], env)
  assert.equal(roots.length, 1)
  assert.equal(roots[0].path.toLowerCase(), 'c:\\users\\x\\appdata\\local\\npm-cache')
})

test('classifyRoot refuses a drive root and the user profile', W, () => {
  const driveRoot = classifyRoot('C:\\', { env: ENV, read: noRead })
  assert.equal(driveRoot.ok, false)
  assert.ok(driveRoot.blocked.includes('drive-root'))

  const home = classifyRoot('C:\\Users\\x', { env: ENV, read: noRead })
  assert.equal(home.ok, false)
  assert.ok(home.blocked.includes('user-profile'))

  // An ancestor of the profile is just as bad.
  assert.ok(classifyRoot('C:\\Users', { env: ENV, read: noRead }).blocked.includes('user-profile'))
})

test('classifyRoot refuses a directory that is on PATH', W, () => {
  const result = classifyRoot('C:\\Tools\\bin', { env: ENV, read: noRead })
  assert.equal(result.ok, false)
  assert.ok(result.blocked.includes('path-entry'))
})

test('classifyRoot refuses system directories', W, () => {
  assert.ok(classifyRoot('C:\\Windows', { env: ENV, read: noRead }).blocked.includes('system-directory'))
  assert.ok(classifyRoot('C:\\Program Files\\nodejs', { env: ENV, read: noRead }).blocked.includes('system-directory'))
})

test('classifyRoot accepts a cache directory with no risk flags', W, () => {
  const result = classifyRoot('C:\\Users\\x\\AppData\\Local\\npm-cache', { env: ENV, read: noRead })
  assert.equal(result.ok, true)
  assert.deepEqual(result.blocked, [])
  assert.deepEqual(result.risky, [])
})

test('classifyRoot flags app-data roots and executable content as risky', W, () => {
  const appData = classifyRoot('C:\\Users\\x\\AppData\\Local', { env: ENV, read: noRead })
  assert.equal(appData.ok, true)
  assert.ok(appData.risky.includes('local-app-data-root'))

  const withExe = classifyRoot('C:\\Users\\x\\AppData\\Local\\npm-cache', {
    env: ENV,
    read: () => ['a.exe', 'b.txt'],
  })
  assert.ok(withExe.risky.some(reason => reason.startsWith('top-level-executables:')))
})

test('classifyRoot flags a directory that contains the workspace', W, () => {
  const result = classifyRoot('C:\\Projects', {
    env: ENV,
    workspace: 'C:\\Projects\\app',
    read: noRead,
  })
  assert.equal(result.ok, true)
  assert.ok(result.risky.includes('contains-the-workspace'))
})
