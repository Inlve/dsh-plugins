const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const file = path.join(__dirname, 'client.js')
// Expose the component only in this test's in-memory copy of the bundle.
const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(
  "    return {\n      inject: ['slots', 'locale'],",
  "    globalThis.testExports = { Panel, createStore, blankForm, formFromEntry };\n    return {\n      inject: ['slots', 'locale'],",
)
let hooks
const testReact = { ...React,
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useState: initial => React.useState(hooks.length ? hooks.shift() : initial),
}
const context = { window: { __ModuleLoader__: { load: module => module.factory(() => testReact) } } }
vm.runInNewContext(source, context, { filename: file })
const { Panel, createStore, blankForm, formFromEntry } = context.testExports
function render(snapshot, form, staticRows = [], flags = true) {
  hooks = [snapshot, null, false, form]
  const store = createStore()
  store.flags = { settings: flags, manager: true, inventory: true }
  store.staticRows = staticRows
  return renderToStaticMarkup(React.createElement(Panel, { store, t: key => key, close() {} }))
}
assert.match(render(null, null, [], false), /loading/)
assert.match(render({ servers: {} }, null), /sectionList/)
assert.match(render({ servers: {} }, null, [{ entryId: 'static-example', moduleName: '@deepseek-ai/dsh-mcp-client' }]), /static-example/)
const snapshot = { servers: { example: { transport: 'stdio', command: 'node' } } }
assert.match(render(snapshot, null), /edit/)
assert.match(render(snapshot, null), /remove/)
assert.match(render(snapshot, blankForm()), /mc-command/)
assert.match(render(snapshot, { ...blankForm(), transport: 'http' }), /mc-url/)
assert.match(render(snapshot, formFromEntry('example', snapshot.servers.example)), /formEdit/)
// Verify this regression test catches the original failure, rather than merely
// accepting any nonempty HTML from a component that was never executed.
const brokenContext = { window: { __ModuleLoader__: { load: module => module.factory(() => testReact) } } }
vm.runInNewContext(source.replace('      const staticRows = store.staticRows\n', ''), brokenContext)
hooks = []
assert.throws(() => renderToStaticMarkup(React.createElement(brokenContext.testExports.Panel, {
  store: createStore(), t: key => key, close() {},
})), /staticRows is not defined/)
console.log('PASS: loading, empty list, static rows, managed actions, STDIO/HTTP add, edit renders; original crash reproduced')
