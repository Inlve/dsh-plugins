import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// The plugin imports @deepseek-ai/schemastery, which resolves from the DSH
// installation (or the profile) at runtime but not from this checkout before
// `pnpm install`. Skipping here is explicit rather than failing on a module
// error that says nothing about the plugin.
let apply = null
try {
  ({ apply } = await import('../index.js'))
} catch {
  apply = null
}

const skip = apply === null
  ? { skip: 'plugin dependencies are not installed in this checkout (run pnpm install)' }
  : {}

const pathValue = () => process.env.Path ?? process.env.PATH ?? ''
const reportDir = path.join(os.tmpdir(), 'toolchain-env-audit')

function fakeContext() {
  const disposers = []
  return {
    ctx: {
      effect(fn) {
        const dispose = fn()
        if (typeof dispose === 'function') disposers.push(dispose)
        return () => {}
      },
      on() { return () => {} },
      get() { return undefined },
      logger: { info() {} },
      tools: { register() { return () => {} } },
      commands: { register() { return () => {} } },
    },
    disposeAll() {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

const options = { selfTestOnActivate: false, refreshTtlMs: 0, reportDir }

test('apply composes the PATH and disposal restores the baseline', skip, () => {
  const before = pathValue()
  const { ctx, disposeAll } = fakeContext()
  apply(ctx, options)

  const composed = pathValue()
  assert.notEqual(composed, before)
  assert.ok(composed.startsWith(before), 'append keeps the baseline as a prefix')
  assert.equal(
    Object.keys(process.env).filter(key => key.toUpperCase() === 'PATH').length,
    1,
    'the plugin must not create a second PATH-cased key',
  )

  disposeAll()
  assert.equal(pathValue(), before)
})

test('a second instance reuses the captured baseline instead of stacking', skip, () => {
  const before = pathValue()

  const first = fakeContext()
  apply(first.ctx, options)
  const once = pathValue()

  const second = fakeContext()
  apply(second.ctx, options)
  assert.equal(pathValue(), once, 're-applying must not append the same directories twice')

  first.disposeAll()
  assert.equal(pathValue(), once, 'a superseded instance must not restore over the live one')

  second.disposeAll()
  assert.equal(pathValue(), before)
})
