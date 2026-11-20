/**
 * Client half of the toolchain settings page.
 *
 * `sidebar.panellist` supplies only the left-sidebar glyph and its label;
 * `main` supplies the page shown while that panel is selected (keyed by the
 * same id, which is what the shell uses for `layout.selectPanel`).
 *
 * The page edits the toolchain list through the settings form service
 * (`configForms`), so it needs no session id: the Host reads the volatile
 * config on the next command and recomposes the PATH. Discovery is the one
 * optional extra that does need a session (it runs `/toolchain scan --json`),
 * so that whole section hides when no session is reachable — editing the list
 * never depends on it.
 */

window.__ModuleLoader__.load({
  id: '@inlve/dsh-toolchain-env',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = '@inlve/dsh-toolchain-env'

    const STRINGS = {
      zh: {
        sidebarLabel: '工具链',
        title: '工具链设置',
        subtitle: '浏览、勾选并覆盖 DSH 子进程可见的工具链目录；保存后下一条命令生效，不需要重启。',
        back: '返回对话',
        sectionList: '工具链清单',
        listHint: '每行一个目录。取消勾选只是停用该行，不会删除它。',
        empty: '清单还是空的：可以从下面的「自动发现」加入，或在底部手动添加一行。',
        idPlaceholder: 'id（如 fnm）',
        pathPlaceholder: '%LOCALAPPDATA%\\pnpm',
        notePlaceholder: '备注（可选）',
        add: '添加',
        remove: '删除',
        save: '保存',
        reset: '还原',
        saving: '保存中…',
        saved: '已保存，下一条命令生效',
        failedSave: '保存失败',
        dirty: '有未保存的更改',
        noId: '无 id',
        disabledLabel: '已停用',
        enable: '启用这一行',
        disable: '停用这一行',
        active: '已生效',
        addedFromScan: '已加入清单，记得保存',
        sectionPrefs: '生效方式',
        autoScanLabel: '自动发现',
        autoScanHint: '开启时，扫描到的已存在目录也会加入 PATH。它与内置发现表重叠，重复目录只加一次。',
        positionLabel: '位置',
        positionFollow: '跟随配置文件（position）',
        positionAppend: 'append — 不抢已有解析',
        positionPrepend: 'prepend — 优先于原有目录',
        sectionScan: '自动发现',
        scanHint: '扫描这台机器上版本管理器和包管理器的目录；「加入」会把该行写进上面的清单（用 %VAR% 模板保存，保持可移植）。',
        scanRefresh: '重新扫描',
        scanning: '扫描中…',
        scanEmpty: '没有扫描到已安装的目录。',
        scanNotAdded: '加入',
        scanListed: '已在清单',
        scanAbsent: '未安装',
        sectionState: '生效状态',
        stateRefresh: '刷新状态',
        stateUnavailable: '没有可用的会话，读不到实时状态。清单编辑不依赖会话。',
        stateLine: '当前生效 {{n}} 个目录',
        positionNow: '位置 {{p}}',
        loading: '读取中…',
        detailsTitle: '格式与行为',
        detailsFormat: '每行「id | path | note」；%VAR% 与开头的 ~ 会展开；行首 ! 表示停用；# 开头是注释。',
        detailsPathOnly: '也可以只写路径，或写「路径 | 备注」——id 只用于显示和审计。',
        detailsScope: '宿主 PATH 是整个进程共用的：pwsh/bash 工具、Web 终端、MCP server、子 agent 一起生效，没有「只对某个会话生效」。',
        detailsNoPersist: '不写注册表、不改用户 PATH；DSH 退出即还原，每次变更留在审计文件里。',
        notServed: '这个配置表单还没有被 Host 提供，无法在此编辑。可以直接改 profile 的 cordis.patch.yml：',
        configHint: '配置文件写法',
        failed: '失败',
      },
      en: {
        sidebarLabel: 'Toolchain',
        title: 'Toolchain settings',
        subtitle: 'Browse, tick and override the toolchain directories every DSH child process sees. Saving applies on the next command; no restart.',
        back: 'Back to conversation',
        sectionList: 'Toolchain list',
        listHint: 'One directory per line. Unticking only disables the line; it is not deleted.',
        empty: 'The list is empty: add something from Auto-discover below, or add a row manually.',
        idPlaceholder: 'id (e.g. fnm)',
        pathPlaceholder: '%LOCALAPPDATA%\\pnpm',
        notePlaceholder: 'Note (optional)',
        add: 'Add',
        remove: 'Remove',
        save: 'Save',
        reset: 'Revert',
        saving: 'Saving...',
        saved: 'Saved; applies on the next command',
        failedSave: 'Save failed',
        dirty: 'Unsaved changes',
        noId: 'no id',
        disabledLabel: 'disabled',
        enable: 'Enable this line',
        disable: 'Disable this line',
        active: 'active',
        addedFromScan: 'Added to the list; remember to save',
        sectionPrefs: 'How it applies',
        autoScanLabel: 'Auto-discover',
        autoScanHint: 'When on, the directories the scan finds existing are added to PATH too. It overlaps the built-in discovery table; a duplicate directory is added once.',
        positionLabel: 'Position',
        positionFollow: 'Follow the config file (position)',
        positionAppend: 'append — never shadow an existing resolution',
        positionPrepend: 'prepend — ahead of the existing directories',
        sectionScan: 'Auto-discover',
        scanHint: 'Scan this machine for version- and package-manager directories. "Add" writes the line into the list above, keeping the %VAR% template so it stays portable.',
        scanRefresh: 'Scan again',
        scanning: 'Scanning...',
        scanEmpty: 'No installed directory was found.',
        scanNotAdded: 'Add',
        scanListed: 'already listed',
        scanAbsent: 'Not installed',
        sectionState: 'Applied state',
        stateRefresh: 'Refresh state',
        stateUnavailable: 'No session is reachable, so live state is unavailable. Editing the list does not depend on a session.',
        stateLine: '{{n}} director(y|ies) applied',
        positionNow: 'position {{p}}',
        loading: 'Loading...',
        detailsTitle: 'Format and behaviour',
        detailsFormat: 'One "id | path | note" per line; %VAR% and a leading ~ are expanded; a leading ! disables the line; # starts a comment.',
        detailsPathOnly: 'A bare path, or "path | note", also works — the id is only for display and audit.',
        detailsScope: 'The host PATH is process-wide: the pwsh/bash tools, the Web terminal, MCP servers and subagents all inherit it; there is no per-session value.',
        detailsNoPersist: 'Nothing is written to the registry or the user PATH; DSH restores it on exit and every change is audited.',
        notServed: 'The Host does not serve this config form yet, so it cannot be edited here. Edit the profile cordis.patch.yml instead:',
        configHint: 'Config file form',
        failed: 'failed',
      },
    }

    const CONFIG_SAMPLE = [
      'toolchainEntries: |',
      '  fnm | %APPDATA%\\fnm\\aliases\\default | Node via fnm',
      '  %LOCALAPPDATA%\\pnpm | pnpm 全局',
      '  !C:\\Tools\\old | 暂时停用',
      'toolchainAutoScan: true',
      "toolchainPosition: ''   # 空 = 跟随 position",
    ].join('\n')

    const CSS = `
.tc-page { box-sizing: border-box; height: 100%; overflow-y: auto; padding: 24px 32px 56px; }
.tc-inner { max-width: 940px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; font-size: 13.5px; line-height: 1.6; color: inherit; }
.tc-head { display: flex; align-items: center; gap: 12px; }
.tc-back { appearance: none; border: 1px solid transparent; background: transparent; color: inherit; border-radius: 5px; padding: 3px 8px; font: inherit; font-size: 12px; cursor: pointer; opacity: .75; }
.tc-back:hover { opacity: 1; background: color-mix(in srgb, currentColor 8%, transparent); }
.tc-titleblock { display: flex; flex-direction: column; gap: 2px; }
.tc-h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -.01em; }
.tc-sub { margin: 0; font-size: 12.5px; opacity: .72; }
.tc-bar { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
.tc-status { font-size: 12px; opacity: .72; margin-left: auto; }
.tc-btn { appearance: none; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); background: transparent; color: inherit; border-radius: 5px; padding: 4px 12px; font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.tc-btn:hover:not(:disabled) { background: color-mix(in srgb, currentColor 8%, transparent); }
.tc-btn:disabled { opacity: .45; cursor: default; }
.tc-btn.primary { background: #0e639c; border-color: #0e639c; color: #fff; }
.tc-btn.primary:hover:not(:disabled) { background: #1177bb; }
.tc-section { display: flex; flex-direction: column; gap: 10px; }
.tc-section-head { display: flex; align-items: center; gap: 10px; }
.tc-h2 { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; opacity: .6; }
.tc-p { margin: 0; }
.tc-muted { opacity: .7; font-size: 12.5px; }
.tc-card { border: 1px solid color-mix(in srgb, currentColor 13%, transparent); border-radius: 6px; overflow: hidden; }
.tc-row { display: flex; align-items: flex-start; gap: 10px; padding: 8px 12px; border-top: 1px solid color-mix(in srgb, currentColor 9%, transparent); }
.tc-row:first-child { border-top: 0; }
.tc-row:hover { background: color-mix(in srgb, currentColor 4%, transparent); }
.tc-row.compact { padding: 4px 12px; }
.tc-row-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.tc-row-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tc-path { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12.5px; overflow-wrap: anywhere; }
.tc-note { font-size: 12px; opacity: .65; overflow-wrap: anywhere; }
.tc-pill { font-size: 11px; padding: 0 7px; border-radius: 10px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); opacity: .85; white-space: nowrap; }
.tc-pill.muted { opacity: .5; }
.tc-badge { font-size: 11px; padding: 0 7px; border-radius: 10px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); opacity: .8; white-space: nowrap; }
.tc-badge.warn { border-color: #c98a00; color: #d9a13b; opacity: 1; }
.tc-badge.ok { border-color: #2e7d32; color: #6cc06f; opacity: 1; }
.tc-cmds { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; max-width: 260px; }
.tc-cmd { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; padding: 0 6px; border-radius: 3px; border: 1px solid color-mix(in srgb, currentColor 16%, transparent); opacity: .75; }
.tc-check { width: 15px; height: 15px; margin: 2px 0 0; accent-color: #0e639c; cursor: pointer; flex: none; }
.tc-icon { appearance: none; border: 0; background: transparent; color: inherit; cursor: pointer; opacity: .55; font-size: 14px; line-height: 1; padding: 2px 4px; border-radius: 4px; flex: none; }
.tc-icon:hover { opacity: 1; background: color-mix(in srgb, currentColor 8%, transparent); }
.tc-add { display: flex; gap: 8px; flex-wrap: wrap; }
.tc-input { box-sizing: border-box; flex: 1 1 200px; min-width: 0; padding: 5px 9px; border-radius: 4px; border: 1px solid color-mix(in srgb, currentColor 22%, transparent); background: color-mix(in srgb, currentColor 4%, transparent); color: inherit; font: inherit; font-size: 12.5px; }
.tc-input.mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; flex: 1 1 300px; }
.tc-input.narrow { flex: 0 1 160px; }
.tc-input:focus { outline: 1px solid #0e639c; outline-offset: 0; border-color: #0e639c; }
.tc-select { padding: 4px 8px; border-radius: 4px; border: 1px solid color-mix(in srgb, currentColor 22%, transparent); background: color-mix(in srgb, currentColor 4%, transparent); color: inherit; font: inherit; font-size: 12.5px; }
.tc-prefs { display: flex; flex-direction: column; gap: 10px; }
.tc-pref { display: flex; align-items: flex-start; gap: 10px; }
.tc-pref-text { display: flex; flex-direction: column; gap: 1px; }
.tc-pref-title { font-size: 12.5px; }
.tc-code { margin: 0; padding: 10px 12px; border-radius: 6px; background: color-mix(in srgb, currentColor 6%, transparent); border: 1px solid color-mix(in srgb, currentColor 12%, transparent); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; line-height: 1.55; overflow-x: auto; white-space: pre; }
.tc-err { color: #f14c4c; font-size: 12.5px; margin: 0; }
.tc-help { border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 6px; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
.tc-help p { margin: 0; }
`

    function PanelIcon({ size }) {
      const px = typeof size === 'number' ? size : 18
      return h('svg', {
        viewBox: '0 0 24 24', width: px, height: px, 'aria-hidden': true,
        style: { display: 'block' },
      },
      h('path', { d: 'M3 5h18v11H3z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
      h('path', { d: 'M6 9l2.5 2.5L6 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      h('path', { d: 'M12 14h4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      h('path', { d: 'M8 19h8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }))
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

    function hasSession(ctx) {
      if (lastSessionId !== '') return true
      try {
        return currentSessionId(ctx) !== ''
      } catch {
        return false
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

    // ------------------------------------------------------- list field mapping

    // Mirrors lib/entries.js. The client cannot import a node module, so the
    // grammar lives in both halves; the host copy is the tested one.
    function looksLikePath(value) {
      const text = String(value ?? '').trim()
      if (text === '') return false
      if (text === '~' || text.startsWith('~/') || text.startsWith('~\\')) return true
      if (/%[^%]+%/.test(text)) return true
      if (/^[a-zA-Z]:[\\/]/.test(text)) return true
      if (text.startsWith('\\\\') || text.startsWith('//')) return true
      if (text.startsWith('/')) return true
      return /[\\/]/.test(text)
    }

    function parseEntries(text) {
      const rows = []
      for (const rawLine of String(text ?? '').split(/\r?\n/)) {
        const raw = rawLine.trim()
        if (raw === '' || raw.startsWith('#')) continue
        let line = raw
        let enabled = true
        if (line.startsWith('!')) {
          enabled = false
          line = line.slice(1).trim()
        }
        if (line === '') continue
        const parts = line.split('|').map(part => part.trim())
        let id = ''
        let pathText = ''
        let note = ''
        if (parts.length === 1) {
          pathText = parts[0]
        } else if (parts.length === 2) {
          if (looksLikePath(parts[0]) && !looksLikePath(parts[1])) {
            pathText = parts[0]
            note = parts[1]
          } else {
            id = parts[0]
            pathText = parts[1]
          }
        } else if (looksLikePath(parts[0]) && !looksLikePath(parts[1])) {
          pathText = parts[0]
          note = parts.slice(1).join(' | ')
        } else {
          id = parts[0]
          pathText = parts[1]
          note = parts.slice(2).join(' | ')
        }
        if (pathText === '') continue
        rows.push({ id, path: pathText, note, enabled })
      }
      return rows
    }

    function serializeEntries(rows) {
      const lines = []
      for (const row of rows ?? []) {
        const pathText = String(row?.path ?? '').trim()
        if (pathText === '') continue
        const id = String(row?.id ?? '').trim()
        const note = String(row?.note ?? '').trim()
        const disabled = row?.enabled === false
        const head = disabled
          ? (id === '' ? `!${pathText}` : `!${id} | ${pathText}`)
          : (id === '' ? pathText : `${id} | ${pathText}`)
        lines.push(note === '' ? head : `${head} | ${note}`)
      }
      return lines.join('\n')
    }

    function fieldOf(snapshot, name) {
      const user = snapshot?.user ?? snapshot?.view?.user
      const base = snapshot?.base ?? snapshot?.view?.base
      if (user && user[name] !== undefined) return user[name]
      if (base && base[name] !== undefined) return base[name]
      return undefined
    }

    function textOf(snapshot) {
      const value = fieldOf(snapshot, 'toolchainEntries')
      return typeof value === 'string' ? value : ''
    }

    function samePath(left, right) {
      return String(left ?? '').trim().toLowerCase() === String(right ?? '').trim().toLowerCase()
    }

    // ------------------------------------------------------------------- panel

    function Panel({ t, ctx, close, store, write }) {
      const boot = store && typeof store.getSnapshot === 'function' ? store.getSnapshot() : undefined
      const [snapshot, setSnapshot] = React.useState(boot)
      const [rows, setRows] = React.useState(() => parseEntries(textOf(boot)))
      const [dirty, setDirty] = React.useState(false)
      const dirtyRef = React.useRef(false)
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const [prefs, setPrefs] = React.useState({})
      const [draft, setDraft] = React.useState({ id: '', path: '', note: '' })
      const [scanState, setScanState] = React.useState('idle')
      const [scanPayload, setScanPayload] = React.useState(null)
      const [scanError, setScanError] = React.useState(null)
      const [sessionOk, setSessionOk] = React.useState(() => hasSession(ctx))
      const [applied, setApplied] = React.useState(null)
      const [appliedError, setAppliedError] = React.useState(null)

      React.useEffect(() => { dirtyRef.current = dirty }, [dirty])

      // The form store may arrive after the first render (configForms is
      // injected asynchronously); subscribing here also refreshes the rows when
      // the store's own snapshot changes.
      React.useEffect(() => {
        if (!store || typeof store.getSnapshot !== 'function') return undefined
        const sync = () => {
          const next = store.getSnapshot()
          setSnapshot(next)
          if (!dirtyRef.current) setRows(parseEntries(textOf(next)))
        }
        sync()
        if (typeof store.subscribe !== 'function') return undefined
        return store.subscribe(sync)
      }, [store])

      const served = Boolean(store)
      const writable = served && snapshot?.writable !== false
      const canSave = writable

      const autoScanValue = fieldOf(snapshot, 'toolchainAutoScan')
      const positionValue = fieldOf(snapshot, 'toolchainPosition')
      const autoScan = prefs.autoScan !== undefined
        ? prefs.autoScan
        : (typeof autoScanValue === 'boolean' ? autoScanValue : true)
      const position = prefs.position !== undefined
        ? prefs.position
        : (typeof positionValue === 'string' ? positionValue : '')

      const loadApplied = React.useCallback(async () => {
        const payload = await runCommand(ctx, '/toolchain list --json')
        if (payload?.ok && Array.isArray(payload.wanted)) {
          setApplied({
            paths: payload.wanted.map(item => String(item.path ?? '')).filter(Boolean),
            position: payload.position,
            summary: payload.summary,
          })
          setAppliedError(null)
        } else if (payload?.error?.code === 'no-session') {
          setSessionOk(false)
        } else {
          setAppliedError(payload?.error?.message ?? t('failed'))
        }
      }, [ctx, t])

      const refreshScan = React.useCallback(async () => {
        if (!hasSession(ctx)) {
          setSessionOk(false)
          setScanState('unavailable')
          return
        }
        setScanState('loading')
        setScanError(null)
        const payload = await runCommand(ctx, '/toolchain scan --json')
        if (payload?.ok && Array.isArray(payload.entries)) {
          setScanPayload(payload)
          setScanState('ready')
          setSessionOk(true)
          void loadApplied()
        } else if (payload?.error?.code === 'no-session') {
          setSessionOk(false)
          setScanState('unavailable')
          setScanError(t('stateUnavailable'))
        } else {
          setScanState('error')
          setScanError(payload?.error?.message ?? t('failed'))
        }
      }, [ctx, t, loadApplied])

      // Discovery is optional: only try it when a session happens to exist.
      React.useEffect(() => {
        if (!hasSession(ctx)) {
          setSessionOk(false)
          return
        }
        setSessionOk(true)
        void refreshScan()
      }, [ctx, refreshScan])

      const save = React.useCallback(async () => {
        if (!canSave) return
        setBusy(true)
        setMessage(null)
        try {
          const result = await write('toolchainEntries', serializeEntries(rows))
          if (!result.ok) {
            setMessage({ kind: 'error', text: result.message ? `${t('failedSave')}：${result.message}` : t('failedSave') })
          } else {
            setDirty(false)
            setMessage({ kind: 'ok', text: t('saved') })
            void loadApplied()
          }
        } catch (error) {
          setMessage({ kind: 'error', text: String(error?.message ?? error) })
        } finally {
          setBusy(false)
        }
      }, [canSave, store, rows, t, loadApplied])

      const savePref = React.useCallback(async (field, value) => {
        if (!canSave) return
        const previous = prefs[field]
        setPrefs(current => ({ ...current, [field]: value }))
        setBusy(true)
        try {
          const result = await write(field, value)
          if (!result.ok) {
            setPrefs(current => ({ ...current, [field]: previous }))
            setMessage({ kind: 'error', text: result.message ? `${t('failedSave')}：${result.message}` : t('failedSave') })
          } else {
            setMessage({ kind: 'ok', text: t('saved') })
            void loadApplied()
          }
        } catch (error) {
          setPrefs(current => ({ ...current, [field]: previous }))
          setMessage({ kind: 'error', text: String(error?.message ?? error) })
        } finally {
          setBusy(false)
        }
      }, [canSave, store, prefs, t, loadApplied])

      const revert = React.useCallback(() => {
        setRows(parseEntries(textOf(snapshot)))
        setPrefs({})
        setDirty(false)
        setMessage(null)
      }, [snapshot])

      const addRow = React.useCallback(() => {
        const pathText = draft.path.trim()
        if (pathText === '') return
        setRows(previous => [...previous, { id: draft.id.trim(), path: pathText, note: draft.note.trim(), enabled: true }])
        setDraft({ id: '', path: '', note: '' })
        setDirty(true)
      }, [draft])

      const addFromScan = React.useCallback((entry) => {
        const pathText = String(entry?.template && entry.template !== '' ? entry.template : entry?.path ?? '').trim()
        if (pathText === '') return
        setRows(previous => {
          if (previous.some(row => samePath(row.path, pathText) || samePath(row.path, entry?.path))) return previous
          return [...previous, {
            id: String(entry?.id ?? entry?.manager ?? ''),
            path: pathText,
            note: String(entry?.label ?? ''),
            enabled: true,
          }]
        })
        setDirty(true)
        setMessage({ kind: 'ok', text: t('addedFromScan') })
      }, [t])

      const badge = (text, cls) => h('span', { className: `tc-badge ${cls ?? ''}` }, text)

      // Command names per directory, from the last scan, keyed by both the
      // template and the expanded path so a saved row can show its badges.
      const commandMap = new Map()
      for (const entry of scanPayload?.entries ?? []) {
        const names = Array.isArray(entry.commands) ? entry.commands : []
        if (names.length === 0) continue
        if (entry.template) commandMap.set(String(entry.template).toLowerCase(), names)
        commandMap.set(String(entry.path ?? '').toLowerCase(), names)
      }

      const rowViews = rows.length === 0
        ? h('div', { className: 'tc-row' }, h('span', { className: 'tc-muted' }, t('empty')))
        : rows.map((row, index) => {
          const commands = commandMap.get(row.path.trim().toLowerCase()) ?? []
          const isActive = applied?.paths?.some(value => samePath(value, row.path)) === true
          return h('div', { className: 'tc-row', key: `row-${index}-${row.path}` },
            h('input', {
              type: 'checkbox',
              className: 'tc-check',
              checked: row.enabled !== false,
              disabled: !writable,
              title: row.enabled === false ? t('enable') : t('disable'),
              'aria-label': row.enabled === false ? t('enable') : t('disable'),
              onChange: (event) => {
                const next = rows.map((item, at) => (at === index ? { ...item, enabled: event.target.checked } : item))
                setRows(next)
                setDirty(true)
              },
            }),
            h('div', { className: 'tc-row-main' },
              h('div', { className: 'tc-row-title' },
                row.id !== ''
                  ? h('span', { className: 'tc-pill' }, row.id)
                  : h('span', { className: 'tc-pill muted' }, t('noId')),
                row.note !== '' ? h('span', { className: 'tc-note' }, row.note) : null,
                row.enabled === false ? badge(t('disabledLabel'), 'warn') : null,
                isActive ? badge(t('active'), 'ok') : null,
              ),
              h('div', { className: 'tc-path', title: row.path }, row.path),
            ),
            commands.length > 0
              ? h('div', { className: 'tc-cmds' }, commands.slice(0, 6).map(name => h('span', { className: 'tc-cmd', key: name }, name)))
              : null,
            h('button', {
              type: 'button',
              className: 'tc-icon',
              title: t('remove'),
              'aria-label': t('remove'),
              onClick: () => {
                setRows(previous => previous.filter((_, at) => at !== index))
                setDirty(true)
              },
            }, '×'),
          )
        })

      const scanEntries = (scanPayload?.entries ?? []).filter(entry => entry.exists === true)
      const absentEntries = (scanPayload?.entries ?? []).filter(entry => entry.exists !== true)
      const scanViews = scanEntries.map((entry) => {
        const template = String(entry.template && entry.template !== '' ? entry.template : entry.path)
        const listed = entry.listed === true
          || rows.some(row => samePath(row.path, template) || samePath(row.path, entry.path))
        const commands = Array.isArray(entry.commands) ? entry.commands : []
        return h('div', { className: 'tc-row', key: `scan-${entry.id}-${entry.path}` },
          h('div', { className: 'tc-row-main' },
            h('div', { className: 'tc-row-title' },
              h('span', { className: 'tc-pill' }, entry.label ?? entry.id),
              entry.version ? badge(`v${entry.version}`) : null,
              listed ? badge(t('scanListed'), 'ok') : null,
            ),
            h('div', { className: 'tc-path', title: entry.path }, String(entry.path ?? '')),
          ),
          commands.length > 0
            ? h('div', { className: 'tc-cmds' }, commands.slice(0, 6).map(name => h('span', { className: 'tc-cmd', key: name }, name)))
            : null,
          listed
            ? null
            : h('button', { type: 'button', className: 'tc-btn', disabled: !writable, onClick: () => addFromScan(entry) }, t('scanNotAdded')),
        )
      })

      const statusText = busy
        ? t('saving')
        : dirty
          ? t('dirty')
          : (message?.text ?? '')

      if (!served) {
        return h('div', { className: 'tc-page' },
          h('style', { key: 'css' }, CSS),
          h('div', { className: 'tc-inner' },
            h('div', { className: 'tc-head' },
              h('button', { type: 'button', className: 'tc-back', onClick: close }, '← ' + t('back')),
              h('div', { className: 'tc-titleblock' }, h('h1', { className: 'tc-h1' }, t('title'))),
            ),
            h('p', { className: 'tc-p' }, t('notServed')),
            h('p', { className: 'tc-h2' }, t('configHint')),
            h('pre', { className: 'tc-code' }, CONFIG_SAMPLE),
          ))
      }

      return h('div', { className: 'tc-page' },
        h('style', { key: 'css' }, CSS),
        h('div', { className: 'tc-inner' },
          h('div', { className: 'tc-head', key: 'head' },
            h('button', { type: 'button', className: 'tc-back', onClick: close }, '← ' + t('back')),
            h('div', { className: 'tc-titleblock' },
              h('h1', { className: 'tc-h1' }, t('title')),
              h('p', { className: 'tc-sub' }, t('subtitle')),
            ),
          ),

          h('div', { className: 'tc-bar', key: 'bar' },
            h('button', {
              type: 'button',
              className: 'tc-btn primary',
              disabled: busy || !canSave || !dirty,
              onClick: save,
            }, busy ? t('saving') : t('save')),
            h('button', { type: 'button', className: 'tc-btn', disabled: busy || !dirty, onClick: revert }, t('reset')),
            h('span', { className: 'tc-status' }, statusText),
          ),

          h('div', { className: 'tc-section', key: 'list' },
            h('p', { className: 'tc-h2' }, t('sectionList')),
            h('p', { className: 'tc-muted' }, t('listHint')),
            h('div', { className: 'tc-card' }, rowViews),
            h('div', { className: 'tc-add' },
              h('input', {
                className: 'tc-input narrow',
                value: draft.id,
                placeholder: t('idPlaceholder'),
                spellCheck: false,
                disabled: !writable,
                onChange: event => setDraft(current => ({ ...current, id: event.target.value })),
              }),
              h('input', {
                className: 'tc-input mono',
                value: draft.path,
                placeholder: t('pathPlaceholder'),
                spellCheck: false,
                disabled: !writable,
                onChange: event => setDraft(current => ({ ...current, path: event.target.value })),
                onKeyDown: event => { if (event.key === 'Enter') addRow() },
              }),
              h('input', {
                className: 'tc-input narrow',
                value: draft.note,
                placeholder: t('notePlaceholder'),
                disabled: !writable,
                onChange: event => setDraft(current => ({ ...current, note: event.target.value })),
                onKeyDown: event => { if (event.key === 'Enter') addRow() },
              }),
              h('button', {
                type: 'button',
                className: 'tc-btn',
                disabled: !writable || draft.path.trim() === '',
                onClick: addRow,
              }, t('add')),
            ),
            message?.kind === 'error' ? h('p', { className: 'tc-err' }, message.text) : null,
          ),

          h('div', { className: 'tc-section', key: 'prefs' },
            h('p', { className: 'tc-h2' }, t('sectionPrefs')),
            h('div', { className: 'tc-prefs' },
              h('label', { className: 'tc-pref', key: 'auto' },
                h('input', {
                  type: 'checkbox',
                  className: 'tc-check',
                  checked: autoScan,
                  disabled: !writable || busy,
                  onChange: event => savePref('toolchainAutoScan', event.target.checked),
                }),
                h('div', { className: 'tc-pref-text' },
                  h('span', { className: 'tc-pref-title' }, t('autoScanLabel')),
                  h('span', { className: 'tc-muted' }, t('autoScanHint')),
                ),
              ),
              h('div', { className: 'tc-pref', key: 'pos' },
                h('span', { className: 'tc-pref-title', style: { minWidth: 120 } }, t('positionLabel')),
                h('select', {
                  className: 'tc-select',
                  value: position,
                  disabled: !writable || busy,
                  onChange: event => savePref('toolchainPosition', event.target.value),
                },
                h('option', { value: '' }, t('positionFollow')),
                h('option', { value: 'append' }, t('positionAppend')),
                h('option', { value: 'prepend' }, t('positionPrepend')),
                ),
              ),
            ),
          ),

          sessionOk
            ? h('div', { className: 'tc-section', key: 'scan' },
              h('div', { className: 'tc-section-head' },
                h('p', { className: 'tc-h2' }, t('sectionScan')),
                h('button', {
                  type: 'button',
                  className: 'tc-btn',
                  style: { marginLeft: 'auto' },
                  disabled: scanState === 'loading',
                  onClick: refreshScan,
                }, scanState === 'loading' ? t('scanning') : t('scanRefresh')),
              ),
              h('p', { className: 'tc-muted' }, t('scanHint')),
              scanState === 'error' && scanError ? h('p', { className: 'tc-err' }, scanError) : null,
              scanState === 'ready' && scanViews.length === 0
                ? h('p', { className: 'tc-muted' }, t('scanEmpty'))
                : null,
              scanViews.length > 0 ? h('div', { className: 'tc-card' }, scanViews) : null,
              absentEntries.length > 0
                ? h('p', { className: 'tc-muted' }, `${t('scanAbsent')}: ${absentEntries.map(entry => entry.id).join(', ')}`)
                : null,
            )
            : null,

          h('div', { className: 'tc-section', key: 'state' },
            h('div', { className: 'tc-section-head' },
              h('p', { className: 'tc-h2' }, t('sectionState')),
              h('button', {
                type: 'button',
                className: 'tc-btn',
                style: { marginLeft: 'auto' },
                disabled: !sessionOk,
                onClick: loadApplied,
              }, t('stateRefresh')),
            ),
            !sessionOk
              ? h('p', { className: 'tc-muted' }, t('stateUnavailable'))
              : applied
                ? h('div', { className: 'tc-section' },
                  h('p', { className: 'tc-p' },
                    `${t('stateLine', { n: applied.paths.length })} · ${t('positionNow', { p: applied.position ?? 'append' })}`),
                  h('div', { className: 'tc-card' },
                    applied.paths.length === 0
                      ? h('div', { className: 'tc-row compact' }, h('span', { className: 'tc-muted' }, '—'))
                      : applied.paths.map((value, index) => h('div', { className: 'tc-row compact', key: `${value}-${index}` },
                        h('span', { className: 'tc-path', title: value }, value)))),
                )
                : appliedError
                  ? h('p', { className: 'tc-err' }, appliedError)
                  : h('p', { className: 'tc-muted' }, t('loading')),
          ),

          h('details', { className: 'tc-help', key: 'help' },
            h('summary', { className: 'tc-h2', style: { cursor: 'pointer' } }, t('detailsTitle')),
            h('p', { className: 'tc-p' }, t('detailsFormat')),
            h('pre', { className: 'tc-code' }, CONFIG_SAMPLE),
            h('p', { className: 'tc-p' }, t('detailsPathOnly')),
            h('p', { className: 'tc-p' }, t('detailsScope')),
            h('p', { className: 'tc-p' }, t('detailsNoPersist')),
          ),
        ))
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
        const t = (key, vars) => {
          const text = (STRINGS[language] ?? STRINGS.zh)[key] ?? STRINGS.zh[key] ?? key
          if (!vars) return text
          return String(text).replace(/\{\{(\w+)\}\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])))
        }
        const close = () => {
          try {
            ctx.get?.('layout')?.selectPanel?.(null)
          } catch {
            // Leaving the panel is the shell's job; never throw from a click.
          }
        }

        const storeRef = { current: null }

        // Settings writes go through the Remote directly: the config-form
        // controller collapses every failure into `false`, and a revision that
        // went stale while the panel stayed open arrives as a conflict.
        // Retrying once with the fresh revision fixes that, and anything else
        // keeps its message so the panel can show why the save was refused.
        const remoteRef = { current: null }
        ctx.inject(['remote', 'remote.settings'], (child) => {
          // A dotted injection is required: reading `remote.settings` without
          // it throws "cannot get property ... without inject".
          remoteRef.current = child.remote.settings
          child.effect(() => () => { remoteRef.current = null })
        })

        async function writeSetting(field, value) {
          const settings = remoteRef.current
          if (settings?.mutate) {
            // The mirror behind configForms can lag a write made elsewhere, and
            // the Host refuses a stale revision. Read the authoritative
            // revision from `describe()` right before writing.
            const readRevision = async () => {
              try {
                const raw = await settings.describe()
                const view = raw?.ok ? raw.value : raw
                const list = Array.isArray(view?.namespaces)
                  ? view.namespaces
                  : (Array.isArray(view) ? view : [])
                const row = list.find(item => item?.ns === 'toolchain-env')
                return typeof row?.revision === 'number' ? row.revision : undefined
              } catch {
                return storeRef.current?.getSnapshot?.()?.revision
              }
            }

            let revision = await readRevision()
            let failure = null
            for (let attempt = 0; attempt < 2; attempt += 1) {
              try {
                const result = await settings.mutate('toolchain-env', [{ op: 'set', path: [field], value }], revision)
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
          order: 31,
          label: () => t('sidebarLabel'),
        }, (props) => {
          // The glyph renders beside the conversation; remember the session it
          // belongs to, because the panel page replaces that conversation.
          rememberSession(ctx)
          return h(PanelIcon, props)
        }))

        // `configForms` may be absent in a composition without Settings; the
        // page then explains the config-file form instead of failing. The entry
        // id is the one in cordis.patch.yml.
        ctx.inject(['configForms'], (child) => {
          try {
            if (typeof child.configForms?.get === 'function') storeRef.current = child.configForms.get('toolchain-env')
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
        }, () => h(Panel, { t, ctx, close, write: writeSetting, store: storeRef.current })))
      },
    }
  },
})
