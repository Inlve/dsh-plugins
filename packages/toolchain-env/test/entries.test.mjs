import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import {
  looksLikePath,
  parseToolchainEntries,
  planToolchain,
  resolvePosition,
  serializeToolchainEntries,
} from '../lib/entries.js'
import { composePath } from '../lib/pathset.js'

const IS_WINDOWS = process.platform === 'win32'
const P = name => (IS_WINDOWS ? `C:\\Tools\\${name}` : `/tools/${name}`)
const key = value => (IS_WINDOWS ? String(value).toLowerCase() : String(value))
const withoutRaw = rows => rows.map(({ raw, ...rest }) => rest)

test('looksLikePath separates a directory from an id or a note', () => {
  for (const value of ['C:\\Tools', '/usr/local/bin', '~/bin', '%APPDATA%\\fnm', '\\\\server\\share', 'relative\\dir']) {
    assert.equal(looksLikePath(value), true, value)
  }
  for (const value of ['fnm', 'pnpm#2', 'Node via fnm', '', '   ']) {
    assert.equal(looksLikePath(value), false, value)
  }
})

test('parseToolchainEntries reads id | path | note, comments and disabled lines', () => {
  const rows = parseToolchainEntries([
    '# a comment',
    '',
    'fnm | %APPDATA%\\fnm\\aliases\\default | Node via fnm',
    '!pnpm | %LOCALAPPDATA%\\pnpm\\bin | disabled for now',
    'C:\\Tools',
    'C:\\Tools\\local | local tools',
  ].join('\r\n'))

  assert.equal(rows.length, 4)
  assert.deepEqual(rows[0], {
    id: 'fnm',
    path: '%APPDATA%\\fnm\\aliases\\default',
    note: 'Node via fnm',
    enabled: true,
    raw: 'fnm | %APPDATA%\\fnm\\aliases\\default | Node via fnm',
  })
  assert.equal(rows[1].id, 'pnpm')
  assert.equal(rows[1].enabled, false, 'a leading ! disables the line')
  assert.equal(rows[1].note, 'disabled for now')
  assert.deepEqual(
    { id: rows[2].id, path: rows[2].path, note: rows[2].note, enabled: rows[2].enabled },
    { id: '', path: 'C:\\Tools', note: '', enabled: true },
  )
  // `path | note` rather than `id | path`, because the first field is a directory.
  assert.deepEqual(
    { id: rows[3].id, path: rows[3].path, note: rows[3].note },
    { id: '', path: 'C:\\Tools\\local', note: 'local tools' },
  )
})

test('parseToolchainEntries keeps a note that itself contains a pipe', () => {
  const [row] = parseToolchainEntries('go | C:\\Go\\bin | tool | chain')
  assert.equal(row.id, 'go')
  assert.equal(row.path, 'C:\\Go\\bin')
  assert.equal(row.note, 'tool | chain')

  const [noteOnly] = parseToolchainEntries('C:\\Tools | a | b')
  assert.equal(noteOnly.id, '')
  assert.equal(noteOnly.path, 'C:\\Tools')
  assert.equal(noteOnly.note, 'a | b')
})

test('parseToolchainEntries ignores a line with no path', () => {
  assert.deepEqual(parseToolchainEntries('fnm |'), [])
  assert.deepEqual(parseToolchainEntries('   '), [])
  assert.deepEqual(parseToolchainEntries(undefined), [])
})

test('serializeToolchainEntries round-trips every form it produces', () => {
  const rows = [
    { id: 'fnm', path: '%APPDATA%\\fnm\\aliases\\default', note: 'Node via fnm', enabled: true },
    { id: 'pnpm', path: '%LOCALAPPDATA%\\pnpm\\bin', note: '', enabled: false },
    { id: '', path: 'C:\\Tools', note: '', enabled: true },
    { id: '', path: 'C:\\Tools\\local', note: 'local tools', enabled: true },
    { id: '', path: 'C:\\Tools\\off', note: '', enabled: false },
  ]
  const text = serializeToolchainEntries(rows)
  assert.equal(text.split('\n').length, rows.length)
  assert.deepEqual(withoutRaw(parseToolchainEntries(text)), rows)
})

test('serializeToolchainEntries drops an empty path and trims the rest', () => {
  assert.equal(serializeToolchainEntries([{ id: ' x ', path: '  ', note: 'n' }]), '')
  assert.equal(serializeToolchainEntries([{ id: ' x ', path: ' C:\\T ', note: ' n ' }]), 'x | C:\\T | n')
})

test('resolvePosition prefers the panel value and falls back to the config field', () => {
  assert.deepEqual(resolvePosition({ panel: 'prepend', configured: 'append' }), { value: 'prepend', source: 'panel' })
  assert.deepEqual(resolvePosition({ panel: 'append', configured: 'prepend' }), { value: 'append', source: 'panel' })
  assert.deepEqual(resolvePosition({ panel: '', configured: 'prepend' }), { value: 'prepend', source: 'config' })
  assert.deepEqual(resolvePosition({ panel: undefined, configured: 'append' }), { value: 'append', source: 'config' })
  // Anything that is not one of the two words falls back to the config field.
  assert.deepEqual(resolvePosition({ panel: 'sideways', configured: 'prepend' }), { value: 'prepend', source: 'config' })
  assert.deepEqual(resolvePosition(), { value: 'append', source: 'config' })
})

test('planToolchain merges the legacy entries, the panel list and the scan, deduped', () => {
  const present = new Set([P('legacy'), P('manual'), P('scan'), P('double')].map(key))
  const plan = planToolchain({
    pathEntries: [P('legacy')],
    discover: false,
    toolchainEntries: [
      `manual | ${P('manual')} | from the panel`,
      `!off | ${P('off')} | disabled`,
      `missing | ${P('missing')} | typo`,
    ].join('\n'),
    scanEntries: [
      { id: 'fnm', manager: 'fnm', path: P('scan'), exists: true },
      { id: 'gone', manager: 'gone', path: P('gone'), exists: false },
    ],
    autoScan: true,
    env: {},
    exists: candidate => present.has(key(candidate)),
  })

  assert.deepEqual(plan.wanted.map(item => [item.path, item.source]), [
    [P('legacy'), 'config'],
    [P('manual'), 'entry:manual'],
    [P('scan'), 'scan:fnm'],
  ])
  assert.deepEqual(plan.missing, [{ entry: P('missing'), source: 'entry:missing' }])
  // A disabled line contributes nothing at all: not wanted, not missing.
  assert.ok(!plan.wanted.some(item => key(item.path) === key(P('off'))))
  assert.ok(!plan.missing.some(item => key(item.entry) === key(P('off'))))
  // A scan candidate that does not exist is not added.
  assert.ok(!plan.wanted.some(item => key(item.path) === key(P('gone'))))
})

test('planToolchain adds a directory claimed twice only once', () => {
  const present = new Set([P('double')].map(key))
  const plan = planToolchain({
    pathEntries: [P('double')],
    discover: false,
    toolchainEntries: `double | ${P('double')}`,
    scanEntries: [{ id: 'double', manager: 'double', path: P('double'), exists: true }],
    env: {},
    exists: candidate => present.has(key(candidate)),
  })
  assert.equal(plan.wanted.length, 1, 'the first source wins the dedupe')
  assert.equal(plan.wanted[0].source, 'config')
})

test('planToolchain honours autoScan off and reports unresolvable entries', () => {
  const plan = planToolchain({
    discover: false,
    toolchainEntries: 'x | relative\\dir | not absolute',
    scanEntries: [{ id: 'fnm', manager: 'fnm', path: P('scan'), exists: true }],
    autoScan: false,
    env: {},
    exists: () => true,
  })
  assert.deepEqual(plan.wanted, [])
  assert.equal(plan.unresolved.length, 1)
  assert.match(plan.unresolved[0].reason, /not an absolute path/)
})

test('the composed PATH appends the merged set and keeps the baseline prefix', () => {
  const present = new Set([P('manual'), P('scan')].map(key))
  const plan = planToolchain({
    discover: false,
    toolchainEntries: `manual | ${P('manual')}`,
    scanEntries: [{ id: 'fnm', manager: 'fnm', path: P('scan'), exists: true }],
    env: {},
    exists: candidate => present.has(key(candidate)),
  })

  const baseline = [P('sys'), P('user')].join(path.delimiter)
  const append = composePath({ baseline, wanted: plan.wanted, position: 'append' })
  assert.equal(append.value, [P('sys'), P('user'), P('manual'), P('scan')].join(path.delimiter))

  // Re-applying with the previous "added" set must not stack duplicates.
  const again = composePath({ baseline, previousAdded: append.added, wanted: plan.wanted, position: 'append' })
  assert.equal(again.value, append.value)
})

test('prepend puts the merged set in front of the baseline', () => {
  const present = new Set([P('manual'), P('scan')].map(key))
  const plan = planToolchain({
    discover: false,
    toolchainEntries: `manual | ${P('manual')}`,
    scanEntries: [{ id: 'fnm', manager: 'fnm', path: P('scan'), exists: true }],
    env: {},
    exists: candidate => present.has(key(candidate)),
  })

  const baseline = [P('sys'), P('user')].join(path.delimiter)
  const prepend = composePath({ baseline, wanted: plan.wanted, position: 'prepend' })
  assert.equal(prepend.value, [P('manual'), P('scan'), P('sys'), P('user')].join(path.delimiter))
})
