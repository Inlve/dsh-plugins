/**
 * Client half of the sandbox guard.
 *
 * `sidebar.panellist` supplies only the left-sidebar glyph and its label;
 * `main` supplies the page shown while that panel is selected.
 *
 * The page edits the trusted-directory list through the settings form service
 * (`configForms`), so it needs no session id: the Host reads the volatile
 * config and grants the list for a workspace on the next command or session.
 * Grant *state* is optional extra information and only appears when a session
 * happens to be reachable.
 */

window.__ModuleLoader__.load({
  id: '@inlve/dsh-sandbox-guard',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = '@inlve/dsh-sandbox-guard'

    const STRINGS = {
      zh: {
        sidebarLabel: '沙箱信任',
        title: '沙箱信任目录',
        subtitle: '受管命令只能写工作区；这里列出的目录会额外获得沙箱写授权。',
        back: '返回对话',
        sectionDirs: '信任目录',
        empty: '还没有信任目录。',
        pathPlaceholder: 'C:\\Users\\you\\AppData\\Local\\npm-cache',
        notePlaceholder: '备注（可选）',
        add: '添加',
        remove: '移除',
        save: '保存',
        reset: '还原',
        saving: '保存中…',
        saved: '已保存',
        failedSave: '保存失败',
        dirty: '有未保存的更改',
        unsavedHint: '保存后在下一次命令或新会话生效；不需要重启。',
        ack: '已确认风险',
        markAck: '标记为已确认风险（!ack）',
        riskTitle: '授权前要清楚',
        riskBody: '写入授权会把目录完整性标签降到 Low：任何低完整性进程都能写它，不只是 DSH；权限项可继承，等于授权整棵子树。',
        hardTitle: '不会生效的目录',
        hardBody: '盘根、用户主目录及其祖先、PATH 上的目录、C:\\Windows、Program Files。',
        riskyTitle: '需要确认的风险项',
        riskyBody: 'LOCALAPPDATA / APPDATA 根、顶层含可执行文件、包含当前工作区的目录：HOST 会跳过它们，除非该行带 !ack。',
        scopeTitle: '生效范围',
        scopeBody: '清单是全局的：保存后会对每个已注册工作区分别授权；撤销只移除当前工作区的权限项。',
        stateTitle: '授权状态',
        stateRefresh: '刷新状态',
        stateUnavailable: '没有可用的会话，无法读取实时状态；授权本身不依赖会话。',
        notServed: '这个配置表单还没有被 Host 提供，无法在此编辑。可以直接改 profile 的 cordis.patch.yml：',
        granted: '已授权',
        notGranted: '未授权',
        unchecked: '未检查',
        configHint: '配置文件写法',
        auditLabel: '沙箱审计',
        auditTitle: '沙箱提权与审计',
        auditSubtitle: '提权规则决定哪些命令能自动绕过沙箱；申请记录是每次放权请求的可回溯日志。',
        policySection: '提权策略',
        policyEnabled: '自动放行已启用',
        policyDisabled: '自动放行未启用',
        policySourceConfig: '来源：配置文件',
        policySourcePanel: '来源：面板覆盖',
        policyRefresh: '刷新',
        rulesEmpty: '还没有规则。',
        rulesJsonTitle: '规则 JSON',
        rulesJsonHint: '留空表示沿用配置文件里的 escalation.rules；保存后对下一次申请生效。',
        rulesSave: '保存规则',
        rulesClear: '清空（回到配置）',
        rulesInvalid: '规则不是合法 JSON',
        rulesNotArray: '规则必须是 JSON 数组',
        confirmBody: '提权规则命中后会直接批准“绕过沙箱”的请求，不再询问你。确认保存？',
        confirmYes: '确认保存',
        confirmNo: '取消',
        auditSection: '申请记录',
        auditFilterAll: '全部',
        auditFilterGranted: '已放行',
        auditFilterAsked: '已询问',
        auditEmpty: '还没有提权申请记录。',
        auditUnavailable: '没有可用的会话，读不到申请记录；规则编辑不受影响。',
        auditGranted: '放行',
        auditAsked: '询问',
        auditFile: '审计文件',
      },
      en: {
        sidebarLabel: 'Sandbox trust',
        title: 'Trusted sandbox roots',
        subtitle: 'Confined commands can only write the workspace; directories listed here get the sandbox write grant too.',
        back: 'Back to conversation',
        sectionDirs: 'Trusted directories',
        empty: 'No trusted directory yet.',
        pathPlaceholder: 'C:\\Users\\you\\AppData\\Local\\npm-cache',
        notePlaceholder: 'Note (optional)',
        add: 'Add',
        remove: 'Remove',
        save: 'Save',
        reset: 'Revert',
        saving: 'Saving...',
        saved: 'Saved',
        failedSave: 'Save failed',
        dirty: 'Unsaved changes',
        unsavedHint: 'Applies on the next command or new session; no restart needed.',
        ack: 'risk acknowledged',
        markAck: 'Acknowledge the risk (!ack)',
        riskTitle: 'Before granting',
        riskBody: 'A grant lowers the directory integrity label to Low: any low-integrity process may write it, not only DSH; the entry is inheritable, so it covers the whole subtree.',
        hardTitle: 'Never granted',
        hardBody: 'Drive roots, the user profile and its ancestors, PATH directories, C:\\Windows, Program Files.',
        riskyTitle: 'Needs confirmation',
        riskyBody: 'LOCALAPPDATA / APPDATA roots, directories with top-level executables, and directories containing the workspace: the Host skips them unless the line carries !ack.',
        scopeTitle: 'Scope',
        scopeBody: 'The list is global: saving grants it for every registered workspace; revoking removes only one workspace\'s entry.',
        stateTitle: 'Grant state',
        stateRefresh: 'Refresh state',
        stateUnavailable: 'No session is reachable, so live state is unavailable; granting does not depend on a session.',
        notServed: 'The Host does not serve this config form yet, so it cannot be edited here. Edit the profile cordis.patch.yml instead:',
        granted: 'granted',
        notGranted: 'not granted',
        unchecked: 'unchecked',
        configHint: 'Config file form',
        auditLabel: 'Sandbox audit',
        auditTitle: 'Sandbox escalation and audit',
        auditSubtitle: 'Escalation rules decide which commands may bypass the sandbox automatically; the request log keeps every grant traceable.',
        policySection: 'Escalation policy',
        policyEnabled: 'Auto-approval on',
        policyDisabled: 'Auto-approval off',
        policySourceConfig: 'Source: config file',
        policySourcePanel: 'Source: panel override',
        policyRefresh: 'Refresh',
        rulesEmpty: 'No rule yet.',
        rulesJsonTitle: 'Rules JSON',
        rulesJsonHint: 'Leave empty to keep escalation.rules from the config file; a save applies to the next request.',
        rulesSave: 'Save rules',
        rulesClear: 'Clear (back to config)',
        rulesInvalid: 'Rules are not valid JSON',
        rulesNotArray: 'Rules must be a JSON array',
        confirmBody: 'A matching rule approves a sandbox-bypassing request without asking you. Save anyway?',
        confirmYes: 'Save',
        confirmNo: 'Cancel',
        auditSection: 'Request log',
        auditFilterAll: 'All',
        auditFilterGranted: 'Granted',
        auditFilterAsked: 'Asked',
        auditEmpty: 'No escalation request yet.',
        auditUnavailable: 'No session is reachable, so the request log is unavailable; rule editing still works.',
        auditGranted: 'granted',
        auditAsked: 'asked',
        auditFile: 'Audit file',
      },
    }

    const CONFIG_SAMPLE = [
      'trustRoots: |',
      '  %LOCALAPPDATA%\\npm-cache | npm 缓存',
      '  %LOCALAPPDATA%\\pnpm | pnpm 全局',
    ].join('\n')

    const CSS = `
.sg-page { box-sizing: border-box; height: 100%; overflow-y: auto; padding: 24px 32px 56px; }
.sg-inner { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; font-size: 13.5px; line-height: 1.6; color: inherit; }
.sg-head { display: flex; align-items: center; gap: 12px; }
.sg-back { appearance: none; border: 1px solid transparent; background: transparent; color: inherit; border-radius: 5px; padding: 3px 8px; font: inherit; font-size: 12px; cursor: pointer; opacity: .75; }
.sg-back:hover { opacity: 1; background: color-mix(in srgb, currentColor 8%, transparent); }
.sg-titleblock { display: flex; flex-direction: column; gap: 2px; }
.sg-h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -.01em; }
.sg-sub { margin: 0; font-size: 12.5px; opacity: .72; }
.sg-bar { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
.sg-status { font-size: 12px; opacity: .72; margin-left: auto; }
.sg-btn { appearance: none; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); background: transparent; color: inherit; border-radius: 5px; padding: 4px 12px; font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.sg-btn:hover:not(:disabled) { background: color-mix(in srgb, currentColor 8%, transparent); }
.sg-btn:disabled { opacity: .45; cursor: default; }
.sg-btn.primary { background: #0e639c; border-color: #0e639c; color: #fff; }
.sg-btn.primary:hover:not(:disabled) { background: #1177bb; }
.sg-section { display: flex; flex-direction: column; gap: 10px; }
.sg-h2 { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; opacity: .6; }
.sg-p { margin: 0; }
.sg-muted { opacity: .7; font-size: 12.5px; }
.sg-card { border: 1px solid color-mix(in srgb, currentColor 13%, transparent); border-radius: 6px; overflow: hidden; }
.sg-row { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-top: 1px solid color-mix(in srgb, currentColor 9%, transparent); }
.sg-row:first-child { border-top: 0; }
.sg-row:hover { background: color-mix(in srgb, currentColor 4%, transparent); }
.sg-path { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12.5px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.sg-note { font-size: 12px; opacity: .65; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sg-badge { font-size: 11px; padding: 0 7px; border-radius: 10px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); opacity: .8; white-space: nowrap; }
.sg-badge.warn { border-color: #c98a00; color: #d9a13b; opacity: 1; }
.sg-badge.ok { border-color: #2e7d32; color: #6cc06f; opacity: 1; }
.sg-icon { appearance: none; border: 0; background: transparent; color: inherit; cursor: pointer; opacity: .55; font-size: 14px; line-height: 1; padding: 2px 4px; border-radius: 4px; }
.sg-icon:hover { opacity: 1; background: color-mix(in srgb, currentColor 8%, transparent); }
.sg-add { display: flex; gap: 8px; flex-wrap: wrap; }
.sg-input { box-sizing: border-box; flex: 1 1 260px; min-width: 0; padding: 5px 9px; border-radius: 4px; border: 1px solid color-mix(in srgb, currentColor 22%, transparent); background: color-mix(in srgb, currentColor 4%, transparent); color: inherit; font: inherit; font-size: 12.5px; }
.sg-input.mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.sg-input:focus { outline: 1px solid #0e639c; outline-offset: 0; border-color: #0e639c; }
.sg-code { margin: 0; padding: 10px 12px; border-radius: 6px; background: color-mix(in srgb, currentColor 6%, transparent); border: 1px solid color-mix(in srgb, currentColor 12%, transparent); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; line-height: 1.55; overflow-x: auto; white-space: pre; }
.sg-err { color: #f14c4c; font-size: 12.5px; }
.sg-help { border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 6px; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
.sg-help p { margin: 0; }
.sg-toggle { display: flex; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer; }
.sg-filters { display: flex; gap: 6px; }
.sg-codearea { flex: 1 1 100%; box-sizing: border-box; resize: vertical; line-height: 1.5; }
.sg-confirm { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border: 1px solid #c98a00; border-radius: 6px; background: color-mix(in srgb, #c98a00 8%, transparent); }
.sg-audit-row { display: grid; grid-template-columns: 130px 60px 130px 110px 64px minmax(120px, 1fr) minmax(120px, 1fr); align-items: center; gap: 8px; }
.sg-time { font-variant-numeric: tabular-nums; white-space: nowrap; }
.sg-ruleTitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
`

    function PanelIcon({ size }) {
      const px = typeof size === 'number' ? size : 18
      return h('svg', {
        viewBox: '0 0 24 24', width: px, height: px, 'aria-hidden': true,
        style: { display: 'block' },
      },
      h('path', { d: 'M6 3h8l4 4v14H6z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
      h('path', { d: 'M14 3v4h4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
      h('path', { d: 'M9 13l2 2 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    // ---------------------------------------------------------------- sessions

    let lastSessionId = ''

    function idOf(value) {
      if (typeof value === 'string') return value
      if (!value || typeof value !== 'object') return ''
      for (const key of ['sessionId', 'id']) {
        const candidate = value[key]
        if (typeof candidate === 'string' && candidate !== '') return candidate
      }
      const session = value.session
      if (session && typeof session === 'object') {
        for (const key of ['id', 'sessionId']) {
          const candidate = session[key]
          if (typeof candidate === 'string' && candidate !== '') return candidate
        }
        if (session.header && typeof session.header.id === 'string' && session.header.id !== '') return session.header.id
      }
      return ''
    }

    function currentSessionId(ctx) {
      const reads = [
        () => ctx.get?.('uiSession')?.current,
        () => ctx.get?.('uiSession')?.current?.getSnapshot?.(),
        () => ctx.get?.('uiSession')?.sessionId?.getSnapshot?.(),
        () => ctx.get?.('uiWorkspace')?.currentSession,
        () => ctx.get?.('uiWorkspace')?.currentSessionId?.getSnapshot?.(),
        () => ctx.get?.('uiWorkspace')?.lastSessionId,
        () => ctx.get?.('sessions')?.current?.getSnapshot?.(),
      ]
      for (const read of reads) {
        try {
          const value = idOf(read())
          if (value !== '') return value
        } catch {
          // Try the next accessor.
        }
      }
      try {
        const match = /(session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(location.href)
        if (match) return match[1]
      } catch {
        // No address bar access.
      }
      return ''
    }

    function rememberSession(ctx) {
      try {
        const id = currentSessionId(ctx)
        if (id !== '') lastSessionId = id
      } catch {
        // Remembering is best effort.
      }
    }

    async function runCommand(ctx, text) {
      const sessionId = lastSessionId !== '' ? lastSessionId : currentSessionId(ctx)
      if (sessionId === '') return { ok: false, error: { code: 'no-session', message: 'no session' } }
      try {
        const result = await ctx.remote.commands.execute(sessionId, text, [])
        if (!result?.ok) return { ok: false, error: result?.error ?? { code: 'command-failed', message: 'command failed' } }
        if (result.value === undefined) return { ok: false, error: { code: 'unknown-command', message: 'unknown command' } }
        if (typeof result.value === 'string') {
          try {
            return JSON.parse(result.value)
          } catch {
            return { ok: true, text: result.value }
          }
        }
        return result.value
      } catch (error) {
        return { ok: false, error: { code: 'command-failed', message: String(error?.message ?? error) } }
      }
    }

    // ------------------------------------------------------------------- list

    function parseLines(text) {
      const rows = []
      for (const rawLine of String(text ?? '').split(/\r?\n/)) {
        const line = rawLine.trim()
        if (line === '') continue
        const ack = /\s!ack$/i.test(line)
        const body = ack ? line.replace(/\s!ack$/i, '') : line
        const [rawPath, ...rest] = body.split('|')
        rows.push({ path: rawPath.trim(), note: rest.join('|').trim(), ack })
      }
      return rows.filter(row => row.path !== '')
    }

    function serialize(rows) {
      return rows
        .filter(row => row.path.trim() !== '')
        .map(row => `${row.path.trim()}${row.note.trim() ? ` | ${row.note.trim()}` : ''}${row.ack ? ' !ack' : ''}`)
        .join('\n')
    }

    function textOf(snapshot) {
      const user = snapshot?.user ?? snapshot?.view?.user
      const base = snapshot?.base ?? snapshot?.view?.base
      const fromUser = typeof user?.trustRoots === 'string' ? user.trustRoots : undefined
      const fromBase = typeof base?.trustRoots === 'string' ? base.trustRoots : undefined
      return fromUser !== undefined ? fromUser : (fromBase ?? '')
    }

    function Panel({ t, ctx, close, store }) {
      const [snapshot, setSnapshot] = React.useState(() => (store ? store.getSnapshot() : undefined))
      const [rows, setRows] = React.useState(() => parseLines(textOf(store ? store.getSnapshot() : undefined)))
      const [dirty, setDirty] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const [draftPath, setDraftPath] = React.useState('')
      const [draftNote, setDraftNote] = React.useState('')
      const [states, setStates] = React.useState(null)
      const [stateError, setStateError] = React.useState(null)

      React.useEffect(() => {
        if (!store || typeof store.subscribe !== 'function') return undefined
        return store.subscribe(() => {
          const next = store.getSnapshot()
          setSnapshot(next)
          if (!dirty) setRows(parseLines(textOf(next)))
        })
      }, [store, dirty])

      const served = Boolean(store) && (snapshot?.status === 'ready' || snapshot?.writable === true)
      const writable = served && snapshot?.writable !== false

      const save = React.useCallback(async () => {
        if (!store || typeof store.set !== 'function') return
        setBusy(true)
        setMessage(null)
        const text = serialize(rows)
        try {
          const ok = await store.set('trustRoots', text)
          if (ok === false) {
            setMessage({ kind: 'error', text: t('failedSave') })
          } else {
            setDirty(false)
            setMessage({ kind: 'ok', text: t('saved') })
          }
        } catch (error) {
          setMessage({ kind: 'error', text: String(error?.message ?? error) })
        } finally {
          setBusy(false)
        }
      }, [store, rows, t])

      const revert = React.useCallback(() => {
        setRows(parseLines(textOf(snapshot)))
        setDirty(false)
        setMessage(null)
      }, [snapshot])

      const addRow = React.useCallback(() => {
        const value = draftPath.trim()
        if (value === '') return
        setRows(previous => [...previous, { path: value, note: draftNote.trim(), ack: false }])
        setDraftPath('')
        setDraftNote('')
        setDirty(true)
      }, [draftPath, draftNote])

      const refreshStates = React.useCallback(async () => {
        setStateError(null)
        const payload = await runCommand(ctx, '/trust list --json')
        if (payload?.ok && Array.isArray(payload.roots)) {
          const byPath = new Map(payload.roots.map(root => [String(root.path).toLowerCase(), root.state]))
          setStates(byPath)
        } else if (payload?.error?.code === 'no-session') {
          setStateError(t('stateUnavailable'))
        } else {
          setStateError(payload?.error?.message ?? t('failed'))
        }
      }, [ctx, t])

      const badge = (text, cls) => h('span', { className: `sg-badge ${cls ?? ''}` }, text)

      const rowViews = rows.length === 0
        ? h('div', { className: 'sg-row' }, h('span', { className: 'sg-muted' }, t('empty')))
        : rows.map((row, index) => {
          const state = states?.get(row.path.toLowerCase())
          return h('div', { className: 'sg-row', key: `${row.path}-${index}` },
            h('span', { className: 'sg-path', title: row.path }, row.path),
            row.note ? h('span', { className: 'sg-note', title: row.note }, row.note) : null,
            row.ack ? badge(t('ack')) : null,
            state ? (state.checked && state.granted ? badge(t('granted'), 'ok') : badge(t('notGranted'))) : null,
            h('button', {
              type: 'button',
              className: 'sg-btn',
              title: t('markAck'),
              onClick: () => { setRows(previous => previous.map((item, at) => at === index ? { ...item, ack: !item.ack } : item)); setDirty(true) },
            }, row.ack ? '!ack' : '!'),
            h('button', {
              type: 'button',
              className: 'sg-icon',
              title: t('remove'),
              'aria-label': t('remove'),
              onClick: () => { setRows(previous => previous.filter((_, at) => at !== index)); setDirty(true) },
            }, '×'),
          )
        })

      if (!served) {
        return h('div', { className: 'sg-page' },
          h('style', { key: 'css' }, CSS),
          h('div', { className: 'sg-inner' },
            h('div', { className: 'sg-head' },
              h('button', { type: 'button', className: 'sg-back', onClick: close }, '← ' + t('back')),
              h('div', { className: 'sg-titleblock' }, h('h1', { className: 'sg-h1' }, t('title'))),
            ),
            h('p', { className: 'sg-p' }, t('notServed')),
            h('pre', { className: 'sg-code' }, CONFIG_SAMPLE),
          ))
      }

      return h('div', { className: 'sg-page' },
        h('style', { key: 'css' }, CSS),
        h('div', { className: 'sg-inner' },
          h('div', { className: 'sg-head', key: 'head' },
            h('button', { type: 'button', className: 'sg-back', onClick: close }, '← ' + t('back')),
            h('div', { className: 'sg-titleblock' },
              h('h1', { className: 'sg-h1' }, t('title')),
              h('p', { className: 'sg-sub' }, t('subtitle')),
            ),
          ),

          h('div', { className: 'sg-bar', key: 'bar' },
            h('button', { type: 'button', className: 'sg-btn primary', disabled: busy || !writable || !dirty, onClick: save }, busy ? t('saving') : t('save')),
            h('button', { type: 'button', className: 'sg-btn', disabled: busy || !dirty, onClick: revert }, t('reset')),
            h('span', { className: 'sg-status' }, dirty ? t('dirty') : (message?.text ?? t('saved'))),
          ),

          h('div', { className: 'sg-section', key: 'dirs' },
            h('p', { className: 'sg-h2' }, t('sectionDirs')),
            h('div', { className: 'sg-card' }, rowViews),
            h('div', { className: 'sg-add' },
              h('input', {
                className: 'sg-input mono',
                value: draftPath,
                placeholder: t('pathPlaceholder'),
                spellCheck: false,
                disabled: !writable,
                onChange: event => setDraftPath(event.target.value),
                onKeyDown: event => { if (event.key === 'Enter') addRow() },
              }),
              h('input', {
                className: 'sg-input',
                value: draftNote,
                placeholder: t('notePlaceholder'),
                disabled: !writable,
                onChange: event => setDraftNote(event.target.value),
                onKeyDown: event => { if (event.key === 'Enter') addRow() },
              }),
              h('button', { type: 'button', className: 'sg-btn', disabled: !writable || draftPath.trim() === '', onClick: addRow }, t('add')),
            ),
            message?.kind === 'error' ? h('p', { className: 'sg-err' }, message.text) : null,
          ),

          h('div', { className: 'sg-section', key: 'state' },
            h('div', { className: 'sg-bar', style: { borderBottom: 0, padding: 0 } },
              h('p', { className: 'sg-h2' }, t('stateTitle')),
              h('button', {
                type: 'button',
                className: 'sg-btn',
                style: { marginLeft: 'auto' },
                onClick: refreshStates,
              }, t('stateRefresh')),
            ),
            stateError ? h('p', { className: 'sg-muted' }, stateError) : null,
          ),

          h('details', { className: 'sg-help', key: 'help' },
            h('summary', { className: 'sg-h2', style: { cursor: 'pointer' } }, t('riskTitle')),
            h('p', { className: 'sg-p' }, t('riskBody')),
            h('p', { className: 'sg-h2', style: { marginTop: 8 } }, t('hardTitle')),
            h('p', { className: 'sg-p' }, t('hardBody')),
            h('p', { className: 'sg-h2', style: { marginTop: 8 } }, t('riskyTitle')),
            h('p', { className: 'sg-p' }, t('riskyBody')),
            h('p', { className: 'sg-h2', style: { marginTop: 8 } }, t('scopeTitle')),
            h('p', { className: 'sg-p' }, t('scopeBody')),
            h('p', { className: 'sg-muted', style: { marginTop: 8 } }, t('unsavedHint')),
          ),
        ))
    }

    const AUDIT_ID = '@inlve/dsh-sandbox-guard/audit'

    const RULE_SAMPLE = JSON.stringify([
      {
        id: 'npm-ci-noscripts',
        title: 'npm 安装依赖但不跑生命周期脚本',
        tools: ['pwsh', 'bash'],
        commandPattern: '^npm\\s+ci\\s+--ignore-scripts(\\s+[^\\s]+)*$',
        maxMode: 'workspace-write',
      },
    ], null, 2)

    /** A config field from the settings snapshot: the user layer wins over the base. */
    function fieldOf(snapshot, name) {
      const user = snapshot?.user ?? snapshot?.view?.user ?? {}
      const base = snapshot?.base ?? snapshot?.view?.base ?? {}
      if (user && Object.prototype.hasOwnProperty.call(user, name)) return user[name]
      return base ? base[name] : undefined
    }

    function formatTime(value) {
      if (value === undefined || value === null || value === '') return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
    }

    function ruleMatch(rule) {
      if (!rule || typeof rule !== 'object') return ''
      if (typeof rule.commandPrefix === 'string' && rule.commandPrefix !== '') return `前缀 ${rule.commandPrefix}`
      if (typeof rule.commandPattern === 'string' && rule.commandPattern !== '') return `正则 ${rule.commandPattern}`
      if (typeof rule.pathPrefix === 'string' && rule.pathPrefix !== '') return `路径 ${rule.pathPrefix}`
      return '—'
    }

    function AuditIcon({ size }) {
      const px = typeof size === 'number' ? size : 18
      return h('svg', {
        viewBox: '0 0 24 24', width: px, height: px, 'aria-hidden': true,
        style: { display: 'block' },
      },
      h('path', { d: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
      h('path', { d: 'M8 12h8M8 15.5h5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }))
    }

    function AuditPanel({ t, ctx, close, store, write }) {
      const [snapshot, setSnapshot] = React.useState(() => (store ? store.getSnapshot() : undefined))
      const [rulesText, setRulesText] = React.useState(() => String(fieldOf(store ? store.getSnapshot() : undefined, 'escalationRulesJson') ?? ''))
      const [dirty, setDirty] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [policy, setPolicy] = React.useState(null)
      const [entries, setEntries] = React.useState(null)
      const [filter, setFilter] = React.useState('all')
      const [confirming, setConfirming] = React.useState(false)

      React.useEffect(() => {
        if (!store || typeof store.subscribe !== 'function') return undefined
        return store.subscribe(() => {
          const next = store.getSnapshot()
          setSnapshot(next)
          if (!dirty) setRulesText(String(fieldOf(next, 'escalationRulesJson') ?? ''))
        })
      }, [store, dirty])

      const load = React.useCallback(async () => {
        const listed = await runCommand(ctx, '/grants list --json')
        if (listed?.ok) setPolicy(listed)
        const audited = await runCommand(ctx, '/grants audit --json')
        if (audited?.ok && Array.isArray(audited.entries)) setEntries(audited.entries)
        else setEntries(null)
      }, [ctx])

      React.useEffect(() => { void load() }, [load])

      const saveRules = React.useCallback(async () => {
        const text = rulesText.trim()
        if (text !== '') {
          let parsed
          try {
            parsed = JSON.parse(text)
          } catch (error) {
            setNotice({ kind: 'error', text: `${t('rulesInvalid')}：${error?.message ?? error}` })
            return
          }
          if (!Array.isArray(parsed)) {
            setNotice({ kind: 'error', text: t('rulesNotArray') })
            return
          }
        }
        setBusy(true)
        const result = await write('escalationRulesJson', text)
        setBusy(false)
        setConfirming(false)
        if (!result.ok) {
          setNotice({ kind: 'error', text: `${t('failedSave')}：${result.message ?? ''}` })
          return
        }
        setDirty(false)
        setNotice({ kind: 'ok', text: t('saved') })
        void load()
      }, [rulesText, write, t, load])

      const clearRules = React.useCallback(async () => {
        setBusy(true)
        const result = await write('escalationRulesJson', '')
        setBusy(false)
        if (!result.ok) {
          setNotice({ kind: 'error', text: `${t('failedSave')}：${result.message ?? ''}` })
          return
        }
        setRulesText('')
        setDirty(false)
        setNotice({ kind: 'ok', text: t('saved') })
        void load()
      }, [write, t, load])

      const toggleEnabled = React.useCallback(async (next) => {
        const result = await write('escalationEnabled', next)
        if (!result.ok) {
          setNotice({ kind: 'error', text: `${t('failedSave')}：${result.message ?? ''}` })
          return
        }
        void load()
      }, [write, load, t])

      const parseRules = text => {
        try {
          const parsed = JSON.parse(text === '' ? '[]' : text)
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }
      const rules = rulesText.trim() !== ''
        ? parseRules(rulesText)
        : (Array.isArray(policy?.rules) ? policy.rules : [])
      const overrideEnabled = fieldOf(snapshot, 'escalationEnabled')
      const enabled = typeof policy?.enabled === 'boolean'
        ? policy.enabled
        : (typeof overrideEnabled === 'boolean' ? overrideEnabled : null)
      const visible = (entries ?? []).filter(entry => filter === 'all' || entry?.decision === filter)
      const filters = [
        ['all', t('auditFilterAll')],
        ['granted', t('auditFilterGranted')],
        ['asked', t('auditFilterAsked')],
      ]

      return h('div', { className: 'sg-page' },
        h('style', { key: 'css' }, CSS),
        h('div', { className: 'sg-inner' },
          h('div', { className: 'sg-head', key: 'head' },
            h('button', { type: 'button', className: 'sg-back', onClick: close }, '← ' + t('back')),
            h('div', { className: 'sg-titleblock' },
              h('h1', { className: 'sg-h1' }, t('auditTitle')),
              h('p', { className: 'sg-sub' }, t('auditSubtitle')),
            ),
          ),

          h('div', { className: 'sg-section', key: 'policy' },
            h('div', { className: 'sg-bar', style: { borderBottom: 0, paddingBottom: 0 } },
              h('p', { className: 'sg-h2' }, t('policySection')),
              h('label', { className: 'sg-toggle', style: { marginLeft: 'auto' } },
                h('input', {
                  type: 'checkbox',
                  checked: enabled === true,
                  disabled: busy || enabled === null,
                  onChange: event => { void toggleEnabled(event.target.checked) },
                }),
                h('span', null, enabled === true ? t('policyEnabled') : t('policyDisabled')),
              ),
              h('button', { type: 'button', className: 'sg-btn', onClick: () => { void load() } }, t('policyRefresh')),
            ),
            policy?.source
              ? h('p', { className: 'sg-muted' }, policy.source === 'panel' ? t('policySourcePanel') : t('policySourceConfig'))
              : null,
            h('div', { className: 'sg-card' },
              rules.length === 0
                ? h('div', { className: 'sg-row' }, h('span', { className: 'sg-muted' }, t('rulesEmpty')))
                : rules.map((rule, index) => h('div', { className: 'sg-row', key: `${rule?.id ?? 'rule'}-${index}` },
                    h('span', { className: 'sg-badge' }, String(rule?.id ?? '?')),
                    h('span', { className: 'sg-ruleTitle', title: String(rule?.title ?? '') }, String(rule?.title ?? '')),
                    h('span', { className: 'sg-muted' }, Array.isArray(rule?.tools) ? rule.tools.join(', ') : String(rule?.tools ?? '')),
                    h('span', { className: 'sg-path', title: ruleMatch(rule) }, ruleMatch(rule)),
                    h('span', { className: `sg-badge${rule?.maxMode === 'danger-full-access' ? ' warn' : ''}` }, String(rule?.maxMode ?? 'workspace-write')),
                  )),
            ),
            h('textarea', {
              className: 'sg-input mono sg-codearea',
              rows: 6,
              value: rulesText,
              spellCheck: false,
              placeholder: RULE_SAMPLE,
              onChange: event => { setRulesText(event.target.value); setDirty(true) },
            }),
            h('div', { className: 'sg-add' },
              h('button', { type: 'button', className: 'sg-btn primary', disabled: busy, onClick: () => setConfirming(true) }, t('rulesSave')),
              h('button', { type: 'button', className: 'sg-btn', disabled: busy || rulesText === '', onClick: clearRules }, t('rulesClear')),
            ),
            h('p', { className: 'sg-muted' }, t('rulesJsonHint')),
            notice ? h('p', { className: notice.kind === 'error' ? 'sg-err' : 'sg-muted' }, notice.text) : null,
          ),

          confirming
            ? h('div', { className: 'sg-confirm', key: 'confirm' },
                h('p', { className: 'sg-p' }, t('confirmBody')),
                h('div', { className: 'sg-add' },
                  h('button', { type: 'button', className: 'sg-btn primary', disabled: busy, onClick: saveRules }, t('confirmYes')),
                  h('button', { type: 'button', className: 'sg-btn', onClick: () => setConfirming(false) }, t('confirmNo')),
                ),
              )
            : null,

          h('div', { className: 'sg-section', key: 'audit' },
            h('div', { className: 'sg-bar', style: { borderBottom: 0, paddingBottom: 0 } },
              h('p', { className: 'sg-h2' }, t('auditSection')),
              h('div', { className: 'sg-filters', style: { marginLeft: 'auto' } },
                filters.map(([value, label]) => h('button', {
                  key: value,
                  type: 'button',
                  className: `sg-btn${filter === value ? ' primary' : ''}`,
                  onClick: () => setFilter(value),
                }, label)),
              ),
              h('button', { type: 'button', className: 'sg-btn', onClick: () => { void load() } }, t('stateRefresh')),
            ),
            h('p', { className: 'sg-muted' }, `${t('auditFile')}：${policy?.auditFile ?? '…'}`),
            entries === null ? h('p', { className: 'sg-muted' }, t('auditUnavailable')) : null,
            entries !== null && visible.length === 0 ? h('p', { className: 'sg-muted' }, t('auditEmpty')) : null,
            entries !== null && visible.length > 0
              ? h('div', { className: 'sg-card' }, visible.slice().reverse().map((entry, index) => h('div', { className: 'sg-row sg-audit-row', key: `${entry?.at ?? 'entry'}-${index}` },
                  h('span', { className: 'sg-muted sg-time' }, formatTime(entry?.at)),
                  h('span', null, String(entry?.tool ?? '')),
                  h('span', { className: `sg-badge${entry?.mode === 'danger-full-access' ? ' warn' : ''}` }, String(entry?.mode ?? '')),
                  h('span', { className: 'sg-badge' }, String(entry?.rule ?? '—')),
                  h('span', { className: `sg-badge ${entry?.decision === 'granted' ? 'ok' : 'warn'}` }, entry?.decision === 'granted' ? t('auditGranted') : t('auditAsked')),
                  h('span', { className: 'sg-path', title: String(entry?.command || entry?.filePath || '') }, String(entry?.command || entry?.filePath || '—')),
                  h('span', { className: 'sg-note', title: String(entry?.justification ?? '') }, String(entry?.justification ?? '')),
                )))
              : null,
          ),
        ),
      )
    }

    function activeLanguage(ctx) {
      try {
        const active = ctx?.locale?.getLocale?.()?.active
        if (typeof active === 'string' && active.toLowerCase().startsWith('zh')) return 'zh'
        if (typeof active === 'string') return 'en'
      } catch {
        // Fall through to the default.
      }
      return 'zh'
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        let language = activeLanguage(ctx)
        ctx.effect(() => {
          try {
            const off = ctx.locale?.onChange?.(() => { language = activeLanguage(ctx) })
            return typeof off === 'function' ? off : () => {}
          } catch {
            return () => {}
          }
        })
        const t = key => (STRINGS[language] ?? STRINGS.zh)[key] ?? STRINGS.zh[key] ?? key
        const close = () => {
          try {
            ctx.get?.('layout')?.selectPanel?.(null)
          } catch {
            // Leaving the panel is the shell's job; never throw from a click.
          }
        }

        const storeRef = { current: null }

        // Settings writes go through the Remote directly: the config-form
        // controller collapses every failure into `false`, and a revision read
        // before the panel opened can be stale. Read the authoritative
        // revision from describe() and retry once on a conflict.
        const remoteRef = { current: null }
        ctx.inject(['remote', 'remote.settings'], (child) => {
          // A dotted injection is required: reading `remote.settings` without
          // it throws "cannot get property ... without inject".
          remoteRef.current = child.remote.settings
          child.effect(() => () => { remoteRef.current = null })
        })

        async function writeField(field, value) {
          const settings = remoteRef.current
          if (settings?.mutate) {
            const readRevision = async () => {
              try {
                const raw = await settings.describe()
                const view = raw?.ok ? raw.value : raw
                const list = Array.isArray(view?.namespaces) ? view.namespaces : (Array.isArray(view) ? view : [])
                const row = list.find(item => item?.ns === 'sandbox-guard')
                return typeof row?.revision === 'number' ? row.revision : undefined
              } catch {
                return storeRef.current?.getSnapshot?.()?.revision
              }
            }
            let revision = await readRevision()
            let failure = null
            for (let attempt = 0; attempt < 2; attempt += 1) {
              try {
                const result = await settings.mutate('sandbox-guard', [{ op: 'set', path: [field], value }], revision)
                if (result?.ok) return { ok: true }
                failure = String(result?.error?.message ?? result?.error?.code ?? 'save failed')
              } catch (error) {
                failure = String(error?.message ?? error)
              }
              if (attempt === 0 && /revision|conflict/i.test(failure)) {
                revision = await readRevision()
                await new Promise(resolve => setTimeout(resolve, 150))
                continue
              }
              break
            }
            return { ok: false, message: failure ?? 'save failed' }
          }
          const ok = await storeRef.current?.set?.(field, value)
          return ok === false ? { ok: false, message: 'save failed' } : { ok: true }
        }

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 30,
          label: () => t('sidebarLabel'),
        }, (props) => {
          // The glyph renders beside the conversation; remember the session it
          // belongs to, because the panel page replaces that conversation.
          rememberSession(ctx)
          return h(PanelIcon, props)
        }))

        // `configForms` may be absent in a composition without Settings; the
        // panel then explains the config-file form instead of failing.
        ctx.inject(['configForms'], (child) => {
          try {
            if (typeof child.configForms?.get === 'function') storeRef.current = child.configForms.get('sandbox-guard')
          } catch {
            storeRef.current = null
          }
          const store = storeRef.current
          if (store) {
            child.effect(() => () => {
              try { store.dispose?.() } catch { /* already gone */ }
              storeRef.current = null
            })
          }
        })

        // Registered unconditionally: a sidebar entry whose `main` key is
        // missing would make the click fail.
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, () => h(Panel, { t, ctx, close, store: storeRef.current })))

        // Second entry: escalation policy plus the traceable request log. The
        // glyph is a separate sidebar item so both pages stay one click away.
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: AUDIT_ID,
          order: 32,
          label: () => t('auditLabel'),
        }, (props) => {
          rememberSession(ctx)
          return h(AuditIcon, props)
        }))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: AUDIT_ID,
        }, () => h(AuditPanel, { t, ctx, close, store: storeRef.current, write: writeField })))
      },
    }
  },
})
