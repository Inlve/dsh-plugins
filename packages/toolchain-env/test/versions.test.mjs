import assert from 'node:assert/strict'
import test from 'node:test'
import { compareNodeVersion, parseRequirement, parseVersion, versionFromPath } from '../lib/versions.js'

test('parseVersion accepts the shapes a manager publishes', () => {
  assert.deepEqual(parseVersion('v24.22.3'), { major: 24, minor: 22, patch: 3 })
  assert.deepEqual(parseVersion('18.17'), { major: 18, minor: 17, patch: 0 })
  assert.deepEqual(parseVersion('20'), { major: 20, minor: 0, patch: 0 })
  assert.equal(parseVersion('default'), null)
})

test('parseRequirement extracts a provable major and refuses the rest', () => {
  assert.deepEqual(parseRequirement('18'), { major: 18 })
  assert.deepEqual(parseRequirement('18.17.0'), { major: 18 })
  assert.deepEqual(parseRequirement('v20.11.1'), { major: 20 })
  assert.deepEqual(parseRequirement('18.x'), { major: 18 })
  assert.deepEqual(parseRequirement('^18.17.0'), { major: 18 })
  assert.deepEqual(parseRequirement('~18'), { major: 18 })
  assert.deepEqual(parseRequirement('>=18'), { major: 18 })
  assert.deepEqual(parseRequirement('>=18 <20'), { major: 18 })
  assert.equal(parseRequirement('lts/*'), null)
  assert.equal(parseRequirement('*'), null)
  assert.equal(parseRequirement('node'), null)
  assert.equal(parseRequirement('>=18 || >=20'), null)
  assert.equal(parseRequirement('18 - 20'), null)
})

test('versionFromPath reads the version segment a manager encodes', () => {
  assert.equal(
    versionFromPath('C:\\Users\\x\\AppData\\Roaming\\fnm\\node-versions\\v24.22.3\\installation'),
    '24.22.3',
  )
  assert.equal(versionFromPath('/home/x/.nvm/versions/node/v20.11.1/bin'), '20.11.1')
  assert.equal(versionFromPath('C:\\Program Files\\nodejs'), null)
  assert.equal(versionFromPath(''), null)
})

test('compareNodeVersion flags a different major and stays silent otherwise', () => {
  assert.equal(compareNodeVersion({ requested: '18', current: '24.22.3' }).mismatch, true)
  assert.equal(compareNodeVersion({ requested: '24', current: '24.22.3' }).mismatch, false)
  assert.equal(compareNodeVersion({ requested: '^24.1.0', current: '24.22.3' }).mismatch, false)
  assert.equal(compareNodeVersion({ requested: 'lts/*', current: '24.22.3' }).skipped, true)
  assert.equal(compareNodeVersion({ requested: '18', current: 'unknown' }).skipped, true)
})
