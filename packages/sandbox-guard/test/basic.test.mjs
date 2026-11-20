import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.dirname(here)
const scriptPath = path.join(packageDir, 'scripts', 'acl.ps1')
const powershell = process.env.DSH_ACCESS_GUARD_POWERSHELL || 'powershell.exe'

test('acl.ps1 reports one ACL_RESULT contract for this package directory', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows file permissions are only managed on Windows')
    return
  }

  const outFile = path.join(tmpdir(), `dsh-access-guard-test-${process.pid}.txt`)
  rmSync(outFile, { force: true })

  // The script writes its result to -OutFile, so the child needs no captured
  // stdio and the test also runs under a sandboxed parent.
  const run = spawnSync(
    powershell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Path', packageDir, '-Mode', 'check', '-OutFile', outFile],
    { stdio: 'ignore' },
  )

  if (!existsSync(outFile)) {
    assert.fail(`PowerShell produced no result file (status ${run.status}, error ${run.error?.message ?? 'none'})`)
  }
  const text = readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '')
  rmSync(outFile, { force: true })

  // A nested sandbox can deny the module autoloading Get-Acl needs; that is an
  // environment limit, not a defect in this script.
  if (/CouldNotAutoloadMatchingModule|module could not be loaded/.test(text)) {
    t.skip('PowerShell module autoloading is unavailable in this environment; run the suite from a normal terminal')
    return
  }

  const line = text.split(/\r?\n/).find((entry) => entry.includes('ACL_RESULT '))
  assert.ok(line, `no ACL_RESULT line in the PowerShell output: ${text.slice(0, 400)}`)
  const value = JSON.parse(line.slice(line.indexOf('ACL_RESULT ') + 'ACL_RESULT '.length))

  assert.equal(value.mode, 'check')
  assert.equal(value.platform, 'windows')
  assert.equal(path.resolve(value.path), path.resolve(packageDir))
  assert.equal(value.isOwner, true)
  assert.ok(
    ['ready', 'needs-grant', 'blocked', 'null-dacl', 'error', 'missing', 'not-directory', 'reparse-point'].includes(value.readiness),
    `unexpected readiness: ${value.readiness}`,
  )
})
