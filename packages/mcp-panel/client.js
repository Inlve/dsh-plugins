/**
 * Client half of the MCP panel.
 *
 * `sidebar.panellist` supplies the left-sidebar entry and its glyph; `main`
 * supplies the page the shell renders while that entry is selected.
 *
 * Everything the page shows or changes is already a Host Remote:
 *   - the server fleet lives in the volatile `mcp-manager.servers` map, read
 *     and written through `ctx.remote.settings`;
 *   - live connection state and tool counts stream from
 *     `ctx.remote.mcpManager.watch`;
 *   - "detect" is `mcpManager.probe`, "restart" is `mcpManager.restart`;
 *   - servers that other configuration rows (or plugins) supply come from the
 *     read-only `ctx.remote.pluginInventory.list`.
 *
 * Nothing here is persisted locally: a save is one `settings.mutate` on the
 * `mcp-manager` namespace, which the Host serializes against its own reload.
 */

window.__ModuleLoader__.load({
  id: '@inlve/dsh-mcp-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = '@inlve/dsh-mcp-panel'
    const MCP_MODULE = '@deepseek-ai/dsh-mcp-client'
    const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

    const STRINGS = {
      zh: {
        sidebarLabel: 'MCP',
        back: '返回对话',
        title: 'MCP 服务器',
        subtitle: '管理 DSH 的 MCP 服务器：添加、修改、停用、删除；状态点表示连接结果，点击可重新检测。',
        add: '添加服务器',
        refresh: '刷新',
        checkAll: '依次检测',
        search: '搜索名称、命令或 URL',
        loading: '读取中…',
        sectionList: '面板管理的服务器',
        empty: '还没有由面板管理的服务器。用工具栏的「添加服务器」新建一个，或看看下面的配置行。',
        sectionStatic: '配置行与插件提供的服务器',
        staticHint: '这些服务器来自其它配置行（例如 cordis.patch.yml 里 magpie 写入的 @deepseek-ai/dsh-mcp-client 行），或由插件在运行时注册。面板只显示它们的加载状态。要把某个配置行交给面板管理：先在 cordis.patch.yml 里删掉那一行，再用上面的「添加服务器」重建同名条目。',
        registeredBadge: '插件注册',
        removedBadge: '已移除',
        tools: '{{n}} 个工具',
        check: '检测',
        checking: '检测中…',
        restart: '重启',
        restarting: '重启中…',
        edit: '编辑',
        remove: '删除',
        confirmRemove: '确认删除？',
        cancel: '取消',
        enable: '启用',
        disable: '停用',
        enabled: '已启用',
        disabled: '已停用',
        save: '保存',
        saving: '保存中…',
        formAdd: '添加 MCP 服务器',
        formEdit: '编辑 {{name}}',
        editorSubtitle: '按 DSH 的 MCP 配置填写；保存后 Host 立即应用，不需要重启。',
        readonlyPill: '只读',
        name: '名称',
        nameHint: '工具命名空间：字母、数字、下划线、短横线，最长 32 位',
        transport: '类型',
        stdio: 'STDIO',
        http: '流式 HTTP',
        command: '启动命令',
        args: '参数（每行一个）',
        env: '环境变量（每行一个 KEY=VALUE）',
        cwd: '工作目录（可选）',
        url: 'URL',
        headers: '请求头（每行一个 Name: value）',
        startup: '启动超时（毫秒，留空用默认 30000）',
        pluginFields: '启用后立即连接',
        advanced: '高级',
        toolTimeout: '工具调用超时（毫秒，留空用默认）',
        reconnect: '断线后自动重连',
        templates: '展开 ${credential:…} 模板',
        addArg: '添加参数',
        addEnv: '添加环境变量',
        addHeader: '添加请求头',
        keyPlaceholder: '键',
        valuePlaceholder: '值',
        argPlaceholder: '参数',
        removeRow: '删除这一行',
        pairNoKey: '{{what}} 里这些行没有键：{{lines}}',
        toolTimeoutInvalid: '工具调用超时必须是一个正整数毫秒数，或者留空。',
        managedPill: '面板',
        staticPill: '配置行',
        saveOk: '已保存，Host 已开始应用',
        saveFailed: '保存失败',
        deleteOk: '已删除',
        probeOk: '检测通过',
        probeFailed: '检测失败',
        stateConnected: '已连接',
        stateConnecting: '连接中',
        stateReconnecting: '重连中',
        stateWaiting: '等待凭据',
        stateFailed: '失败',
        stateClosed: '已关闭',
        stateDisabled: '已停用',
        stateUnknown: '未检测',
        stateLoaded: '已加载',
        stateLoading: '加载中',
        statePending: '等待加载',
        stateUnloading: '卸载中',
        stateFailedShort: '加载失败',
        reasonGaveUp: '重连次数用尽',
        reasonReconnectDisabled: '未启用重连',
        reasonUnclosed: '连接未能正常关闭',
        reasonLoad: '实例加载失败',
        reasonCleanup: '清理失败',
        managerMissing: '这份配置里没有 mcp-manager 行（@deepseek-ai/dsh-mcp-manager），面板无法保存服务器。请先在 profile 的 cordis.patch.yml 里加上这一行。',
        settingsMissing: 'Host 没有提供 settings 接口，读不到也改不了 MCP 配置。',
        inventoryMissing: '读不到插件的加载清单。',
        noManagerApi: 'Host 没有提供 mcpManager 接口，无法检测状态或重启。',
        nameInvalid: '名称只能包含字母、数字、下划线、短横线，且不超过 32 位。',
        nameTaken: '已经有同名服务器了。',
        commandRequired: 'STDIO 服务器需要启动命令。',
        urlRequired: '流式 HTTP 服务器需要 http(s) URL。',
        helpTitle: '保存到哪里、有什么限制',
        helpBody1: '服务器保存在 profile 的 cordis.patch.yml 里 mcp-manager 行的 servers 字段。保存后 Host 立即协调：新增即连接、修改即重建该实例、删除即卸载，不需要重启。',
        helpBody2: '名称同时是工具命名空间。和配置文件里的静态行重名时，Host 会以「名称被占用」失败，状态点变红并给出原因。密文请用 ${credential:NAME} 模板，不要直接写进配置。',
        helpBody3: '状态点优先显示实时连接状态；点一下会另起一次一次性探测（连接、列出工具、关闭），结果保留到状态下一次变化。',
        countSummary: '{{total}} 个 · {{ok}} 个已连接 · {{bad}} 个失败',
        neverProbed: '点击状态点检测',
        probing: '探测中…',
        staticEmpty: '没有读到配置行或插件注册的 MCP 服务器。',
        noMatch: '没有匹配的服务器。',
        justNow: '刚刚',
        secondsAgo: '{{n}} 秒前',
        minutesAgo: '{{n}} 分钟前',
        noCommand: '（未配置启动命令）',
        startupInvalid: '启动超时必须是一个正整数毫秒数，或者留空。',
        badPairs: '这些行没看懂（{{what}}）：{{lines}}',
        inventoryFailed: '读不到配置行清单：{{reason}}',
        inventoryPending: '读取配置行…',
        managerConflict: '已经有同名服务器了：{{name}}',
        streamLost: '实时状态流已中断（{{reason}}），状态可能过期；点「刷新」重新读取。',
        closeUnconfirmed: '连接未能确认关闭，Host 会暂时拒绝对它的重启或检测。',
      },
      en: {
        sidebarLabel: 'MCP',
        back: 'Back to conversation',
        title: 'MCP servers',
        subtitle: 'Manage DSH MCP servers: add, edit, disable and delete them; the status dot shows the last connection result and probes again when clicked.',
        add: 'Add server',
        refresh: 'Refresh',
        checkAll: 'Check each',
        search: 'Search name, command or URL',
        loading: 'Loading...',
        sectionList: 'Servers managed here',
        empty: 'No server is managed here yet. Use Add server on the toolbar, or look at the configuration rows below.',
        sectionStatic: 'Servers from configuration rows and plugins',
        staticHint: 'These servers come from other configuration rows (such as the @deepseek-ai/dsh-mcp-client rows magpie writes into cordis.patch.yml), or from plugins that register at runtime. The panel shows their load state only. To move one here: remove its row from cordis.patch.yml, then recreate it with Add server.',
        registeredBadge: 'registered',
        removedBadge: 'removed',
        tools: '{{n}} tools',
        check: 'Check',
        checking: 'Checking...',
        restart: 'Restart',
        restarting: 'Restarting...',
        edit: 'Edit',
        remove: 'Delete',
        confirmRemove: 'Delete?',
        cancel: 'Cancel',
        enable: 'Enable',
        disable: 'Disable',
        enabled: 'enabled',
        disabled: 'disabled',
        save: 'Save',
        saving: 'Saving...',
        formAdd: 'Add MCP server',
        formEdit: 'Edit {{name}}',
        editorSubtitle: 'Fill in the DSH MCP configuration; the Host applies it as soon as you save.',
        readonlyPill: 'read-only',
        name: 'Name',
        nameHint: 'Tool namespace: letters, digits, underscore and dash, up to 32 characters',
        transport: 'Transport',
        stdio: 'STDIO',
        http: 'Streamable HTTP',
        command: 'Command',
        args: 'Arguments (one per line)',
        env: 'Environment (KEY=VALUE per line)',
        cwd: 'Working directory (optional)',
        url: 'URL',
        headers: 'Headers (Name: value per line)',
        startup: 'Startup timeout (ms, empty uses the 30000 default)',
        pluginFields: 'Connect as soon as saving',
        advanced: 'Advanced',
        toolTimeout: 'Tool call timeout (ms, empty uses the default)',
        reconnect: 'Reconnect after a lost connection',
        templates: 'Expand ${credential:…} templates',
        addArg: 'Add argument',
        addEnv: 'Add environment variable',
        addHeader: 'Add header',
        keyPlaceholder: 'Key',
        valuePlaceholder: 'Value',
        argPlaceholder: 'Argument',
        removeRow: 'Remove this row',
        pairNoKey: 'These {{what}} rows have no key: {{lines}}',
        toolTimeoutInvalid: 'The tool call timeout must be a positive whole number of milliseconds, or empty.',
        managedPill: 'panel',
        staticPill: 'config row',
        saveOk: 'Saved; the Host is applying it',
        saveFailed: 'Save failed',
        deleteOk: 'Deleted',
        probeOk: 'Check passed',
        probeFailed: 'Check failed',
        stateConnected: 'connected',
        stateConnecting: 'connecting',
        stateReconnecting: 'reconnecting',
        stateWaiting: 'waiting for credentials',
        stateFailed: 'failed',
        stateClosed: 'closed',
        stateDisabled: 'disabled',
        stateUnknown: 'not checked',
        stateLoaded: 'loaded',
        stateLoading: 'loading',
        statePending: 'pending',
        stateUnloading: 'unloading',
        stateFailedShort: 'load failed',
        reasonGaveUp: 'reconnect budget used up',
        reasonReconnectDisabled: 'reconnect disabled',
        reasonUnclosed: 'connection did not close',
        reasonLoad: 'instance failed to load',
        reasonCleanup: 'cleanup failed',
        managerMissing: 'This composition has no mcp-manager row (@deepseek-ai/dsh-mcp-manager), so the panel cannot save servers. Add that row to the profile cordis.patch.yml first.',
        settingsMissing: 'The Host does not serve the settings Remote, so MCP configuration cannot be read or written.',
        inventoryMissing: 'The plugin inventory Remote is unavailable.',
        noManagerApi: 'The Host does not serve the mcpManager Remote, so status checks and restarts are unavailable.',
        nameInvalid: 'A name may contain letters, digits, underscore and dash, up to 32 characters.',
        nameTaken: 'A server with that name already exists.',
        commandRequired: 'A STDIO server needs a command.',
        urlRequired: 'A streamable HTTP server needs an http(s) URL.',
        helpTitle: 'Where it is saved, and the limits',
        helpBody1: 'Servers live in the servers field of the mcp-manager row in the profile cordis.patch.yml. Saving makes the Host reconcile immediately: a new entry connects, an edited entry is rebuilt, a removed entry unmounts - no restart.',
        helpBody2: 'The name is also the tool namespace. A name already used by a static configuration row fails as "name taken"; the dot turns red with the reason. Keep secrets as ${credential:NAME} templates instead of writing them into the configuration.',
        helpBody3: 'The dot shows live connection state first. Clicking it runs a one-shot probe (connect, list tools, close) whose result stays until the next state change.',
        countSummary: '{{total}} servers · {{ok}} connected · {{bad}} failed',
        neverProbed: 'Click the dot to check',
        probing: 'Checking...',
        staticEmpty: 'No MCP server was found in configuration rows or plugin registrations.',
        noMatch: 'No server matches.',
        justNow: 'just now',
        secondsAgo: '{{n}}s ago',
        minutesAgo: '{{n}}m ago',
        noCommand: '(no command configured)',
        startupInvalid: 'The startup timeout must be a positive whole number of milliseconds, or empty.',
        badPairs: 'These lines could not be read ({{what}}): {{lines}}',
        inventoryFailed: 'The configuration-row list is unavailable: {{reason}}',
        inventoryPending: 'Reading configuration rows...',
        managerConflict: 'A server with that name already exists: {{name}}',
        streamLost: 'The live status stream ended ({{reason}}); state may be stale. Press Refresh to read it again.',
        closeUnconfirmed: 'Transport closure was not confirmed, so the Host refuses a restart or probe until then.',
      },
    }

    const CSS = `
.mc-page { box-sizing: border-box; height: 100%; overflow-y: auto; padding: 24px 32px 80px; background: var(--dsw-alias-bg-base, transparent); color: var(--dsw-alias-label-primary, inherit); }
.mc-inner { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; font-size: 13.5px; line-height: 1.6; }
.mc-head { display: flex; align-items: flex-start; gap: 12px; }
.mc-back { appearance: none; border: 1px solid transparent; background: transparent; color: inherit; border-radius: 6px; padding: 3px 8px; font: inherit; font-size: 12px; cursor: pointer; opacity: .72; white-space: nowrap; }
.mc-back:hover { opacity: 1; background: color-mix(in srgb, currentColor 8%, transparent); }
.mc-titleblock { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.mc-h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -.01em; }
.mc-sub { margin: 0; font-size: 12.5px; color: var(--dsw-alias-label-secondary, inherit); }
.mc-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 12%, transparent)); }
.mc-bar .mc-status { font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); margin-left: auto; }
.mc-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 20%, transparent)); background: transparent; color: inherit; border-radius: 8px; padding: 6px 14px; font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
.mc-btn:hover:not(:disabled) { background: color-mix(in srgb, currentColor 8%, transparent); }
.mc-btn:disabled { opacity: .45; cursor: default; }
.mc-btn.primary { background: var(--dsw-alias-brand-primary, #2f6fed); border-color: var(--dsw-alias-brand-primary, #2f6fed); color: #fff; }
.mc-btn.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6fed) 74%, #000); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6fed) 74%, #000); color: #fff; }
.mc-btn.primary:disabled { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6fed) 50%, var(--dsw-alias-bg-base, #000)); border-color: transparent; color: color-mix(in srgb, #fff 85%, transparent); }
.mc-btn.danger { color: var(--dsw-alias-state-error-primary, #d64545); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d64545) 45%, transparent); }
.mc-btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d64545) 12%, transparent); }
.mc-btn.small { padding: 3px 10px; font-size: 12px; border-radius: 7px; }
.mc-input { box-sizing: border-box; width: 100%; min-height: 38px; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 20%, transparent)); background: color-mix(in srgb, currentColor 3%, transparent); color: inherit; font: inherit; font-size: 13.5px; }
.mc-input::placeholder { color: var(--dsw-alias-label-secondary, inherit); opacity: .55; }
.mc-input:focus { outline: 1px solid var(--dsw-alias-brand-primary, #2f6fed); outline-offset: 0; border-color: transparent; }
.mc-input.mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12.5px; }
.mc-section { display: flex; flex-direction: column; gap: 10px; }
.mc-h2 { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--dsw-alias-label-secondary, inherit); }
.mc-muted { margin: 0; font-size: 12.5px; color: var(--dsw-alias-label-secondary, inherit); }
.mc-card { border: 1px solid var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 13%, transparent)); border-radius: 12px; overflow: hidden; background: var(--dsw-alias-bg-layer-1, transparent); }
.mc-row { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; border-top: 1px solid var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 10%, transparent)); }
.mc-row:first-child { border-top: 0; }
.mc-row:hover { background: color-mix(in srgb, currentColor 3%, transparent); }
.mc-dotwrap { appearance: none; border: 0; background: transparent; padding: 5px; margin: 2px 0 0; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: none; }
.mc-dotwrap:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.mc-dotwrap:disabled { cursor: default; }
.mc-dot { width: 9px; height: 9px; border-radius: 50%; display: block; flex: none; background: var(--mc-tone, var(--dsw-alias-state-idle-primary, #8a8f98)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--mc-tone, #8a8f98) 16%, transparent); }
.mc-dot.ok { --mc-tone: var(--dsw-alias-state-success-primary, #2e9e5b); }
.mc-dot.error { --mc-tone: var(--dsw-alias-state-error-primary, #d64545); }
.mc-dot.warn { --mc-tone: var(--dsw-alias-state-warn-primary, #c98a00); }
.mc-dot.busy { --mc-tone: var(--dsw-alias-brand-primary, #3b82f6); animation: mc-pulse 1.1s ease-in-out infinite; }
.mc-dot.idle { --mc-tone: var(--dsw-alias-state-idle-primary, #8a8f98); box-shadow: none; }
@keyframes mc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .mc-dot.busy { animation: none; } }
.mc-main { display: flex; flex-direction: column; gap: 3px; flex: 1 1 auto; min-width: 0; }
.mc-rowhead { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.mc-name { font-weight: 600; font-size: 13.5px; }
.mc-pill { font-size: 11px; padding: 0 8px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 20%, transparent)); color: var(--dsw-alias-label-secondary, inherit); white-space: nowrap; }
.mc-pill.warn { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c98a00) 55%, transparent); color: var(--dsw-alias-state-warn-primary, #c98a00); }
.mc-pill.ok { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2e9e5b) 55%, transparent); color: var(--dsw-alias-state-success-primary, #2e9e5b); }
.mc-state { font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); }
.mc-state.ok { color: var(--dsw-alias-state-success-primary, #2e9e5b); }
.mc-state.error { color: var(--dsw-alias-state-error-primary, #d64545); }
.mc-state.warn { color: var(--dsw-alias-state-warn-primary, #c98a00); }
.mc-spec { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); overflow-wrap: anywhere; }
.mc-detail { font-size: 12px; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary, inherit); }
.mc-detail.error { color: var(--dsw-alias-state-error-primary, #d64545); }
.mc-detail.warn { color: var(--dsw-alias-state-warn-primary, #c98a00); }
.mc-actions { display: flex; align-items: center; gap: 6px; flex: none; flex-wrap: wrap; justify-content: flex-end; }
.mc-editor { display: flex; flex-direction: column; gap: 14px; }
.mc-sheet { border: 1px solid var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 13%, transparent)); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, transparent); padding: 0 18px; }
.mc-frow { display: flex; flex-direction: column; gap: 9px; padding: 16px 0; border-top: 1px solid var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 9%, transparent)); }
.mc-frow:first-child { border-top: 0; }
.mc-frow.split { flex-direction: row; align-items: center; justify-content: space-between; gap: 16px; }
.mc-flabel { font-size: 13.5px; font-weight: 600; }
.mc-fhint { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); }
.mc-hint { font-size: 11.5px; color: var(--dsw-alias-label-secondary, inherit); opacity: .8; }
.mc-iter { display: flex; align-items: center; gap: 8px; }
.mc-iter > .mc-input { flex: 1 1 auto; min-width: 0; }
.mc-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 8px; align-items: center; }
.mc-trash { appearance: none; border: 0; background: transparent; color: inherit; opacity: .5; border-radius: 7px; padding: 7px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: none; }
.mc-trash:hover { opacity: .95; background: color-mix(in srgb, currentColor 8%, transparent); }
.mc-addbtn { width: 100%; appearance: none; border: 0; border-radius: 10px; padding: 11px 12px; background: color-mix(in srgb, currentColor 6%, transparent); color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
.mc-addbtn:hover { background: color-mix(in srgb, currentColor 11%, transparent); }
.mc-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 18%, transparent)); border-radius: 9px; overflow: hidden; background: color-mix(in srgb, currentColor 4%, transparent); flex: none; }
.mc-seg button { appearance: none; border: 0; background: transparent; color: inherit; font: inherit; font-size: 13px; padding: 6px 18px; cursor: pointer; }
.mc-seg button:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.mc-seg button[aria-pressed='true'] { background: color-mix(in srgb, currentColor 14%, transparent); font-weight: 600; }
.mc-switchrow { display: flex; align-items: center; gap: 10px; font-size: 13.5px; }
.mc-switch { width: 16px; height: 16px; accent-color: var(--dsw-alias-brand-primary, #2f6fed); cursor: pointer; }
.mc-savebar { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 6px 2px 0; }
.mc-savebar .mc-status { margin-right: auto; }
.mc-msg { margin: 0; font-size: 12.5px; }
.mc-msg.ok { color: var(--dsw-alias-state-success-primary, #2e9e5b); }
.mc-msg.error { color: var(--dsw-alias-state-error-primary, #d64545); }
.mc-help { border: 1px solid var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 12%, transparent)); border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }
.mc-help summary { cursor: pointer; font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); }
.mc-help p { margin: 0; font-size: 12.5px; color: var(--dsw-alias-label-secondary, inherit); }
.mc-empty { padding: 16px 14px; font-size: 12.5px; color: var(--dsw-alias-label-secondary, inherit); }
.mc-counts { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); }
`

    // ------------------------------------------------------------ utilities

    function activeLanguage(ctx) {
      try {
        const active = ctx?.locale?.getLocale?.()?.active
        if (typeof active === 'string' && active.toLowerCase().startsWith('zh')) return 'zh'
        if (typeof active === 'string') return 'en'
        const snapshot = ctx?.locale?.getSnapshot?.()
        const next = typeof snapshot?.active === 'string' ? snapshot.active : ''
        if (next !== '') return next.toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch {
        // Fall through to the default.
      }
      return 'zh'
    }

    function isObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    function failureText(result) {
      const error = result?.error
      if (typeof error === 'string') return error
      if (isObject(error)) return String(error.message ?? error.code ?? JSON.stringify(error))
      if (typeof result?.message === 'string') return result.message
      return 'unknown failure'
    }

    // The gateway wraps every answer as { ok, value } or { ok: false, error };
    // a business value that itself carries `ok` (a probe result) arrives inside
    // that envelope, so only a shape with `value` or `error` is an envelope.
    async function unwrap(promise) {
      const result = await promise
      if (!isObject(result) || typeof result.ok !== 'boolean') return { ok: true, value: result }
      if (Object.hasOwn(result, 'value') || Object.hasOwn(result, 'error')) return result
      return { ok: true, value: result }
    }

    function pickNamespace(view) {
      const rows = Array.isArray(view?.namespaces) ? view.namespaces : (Array.isArray(view) ? view : [])
      const withServers = rows.filter(row => isObject(row) && isObject(row.value) && isObject(row.value.servers))
      const named = withServers.find(row => row.ns === 'mcp-manager') ?? withServers.find(row => row.ns === 'mcp') ?? withServers[0]
      if (named) return named
      const bySchema = rows.find(row => {
        try {
          return typeof row?.ns === 'string' && JSON.stringify(row.schema ?? {}).includes('"servers"')
        } catch {
          return false
        }
      })
      return bySchema ?? null
    }

    function normaliseServers(raw) {
      const servers = {}
      if (!isObject(raw)) return servers
      for (const [name, entry] of Object.entries(raw)) {
        if (!isObject(entry)) continue
        servers[name] = entry
      }
      return servers
    }

    function argsOf(entry) {
      return Array.isArray(entry?.args) ? entry.args.map(value => String(value)) : []
    }

    function specOf(entry, placeholder) {
      if (entry?.transport === 'streamable-http') return String(entry.url ?? '')
      const parts = [String(entry?.command ?? '')].concat(argsOf(entry))
      const spec = parts.filter(part => part !== '').join(' ')
      return spec === '' ? String(placeholder ?? '') : spec
    }

    // A cheap identity for one server's live status, so a probe result can be
    // dropped as soon as the Host reports something else.
    function statusSignature(view) {
      try {
        return JSON.stringify(view?.status ?? null)
      } catch {
        return ''
      }
    }

    function transportLabel(entry) {
      return entry?.transport === 'streamable-http' ? 'HTTP' : 'STDIO'
    }

    function reasonText(t, reason) {
      switch (reason) {
        case 'gave-up': return t('reasonGaveUp')
        case 'reconnect-disabled': return t('reasonReconnectDisabled')
        case 'unclosed-generation': return t('reasonUnclosed')
        case 'load': return t('reasonLoad')
        case 'cleanup': return t('reasonCleanup')
        default: return String(reason ?? '')
      }
    }

    // Live state as the manager reports it after every change.
    function describeLive(t, view) {
      const status = view?.status
      if (!isObject(status)) return null
      switch (status.state) {
        case 'connected':
          return { tone: 'ok', label: t('stateConnected'), detail: t('tools', { n: status.toolCount ?? 0 }), tools: status.toolCount }
        case 'connecting':
          return { tone: 'busy', label: t('stateConnecting'), detail: '' }
        case 'reconnecting':
          return {
            tone: 'warn',
            label: t('stateReconnecting'),
            detail: `${status.attempt ?? 0}/${status.maxAttempts ?? 0} · ${String(status.lastError ?? '')}`.trim(),
          }
        case 'waiting-credentials':
          return { tone: 'warn', label: t('stateWaiting'), detail: String(status.lastError ?? '') }
        case 'failed':
          return {
            tone: 'error',
            label: t('stateFailed'),
            detail: [reasonText(t, status.reason), String(status.lastError ?? status.result?.cleanupError ?? '')]
              .filter(part => part !== '')
              .join(' · '),
          }
        case 'closed':
          return { tone: 'idle', label: t('stateClosed'), detail: String(status.result?.cleanupError ?? '') }
        case 'disabled':
          return { tone: 'idle', label: t('stateDisabled'), detail: '' }
        default:
          return { tone: 'idle', label: String(status.state ?? ''), detail: '' }
      }
    }

    // Static configuration rows report a Loader phase, not connectivity.
    function describePhase(t, entry) {
      switch (entry?.fiberPhase) {
        case 'active': return { tone: 'ok', label: t('stateLoaded'), detail: '' }
        case 'loading': return { tone: 'busy', label: t('stateLoading'), detail: '' }
        case 'pending': return { tone: 'idle', label: t('statePending'), detail: '' }
        case 'unloading': return { tone: 'idle', label: t('stateUnloading'), detail: '' }
        case 'failed': return { tone: 'error', label: t('stateFailedShort'), detail: String(entry?.diagnostic ?? '') }
        default: return { tone: 'idle', label: entry?.enabled === false ? t('stateDisabled') : t('stateUnknown'), detail: '' }
      }
    }

    function splitLines(text) {
      return String(text ?? '').split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
    }

    function pairsOf(value) {
      if (!isObject(value)) return []
      return Object.entries(value).map(([key, item]) => ({ key, value: String(item ?? '') }))
    }

    // Blank rows are ignored; a value without its key is reported instead of
    // being dropped, so a half-typed row never saves as something else.
    function collectPairs(rows, label) {
      const pairs = {}
      const bad = []
      for (const row of Array.isArray(rows) ? rows : []) {
        const key = String(row?.key ?? '').trim()
        const value = String(row?.value ?? '').trim()
        if (key === '') {
          if (value !== '') bad.push(`${label}=${value}`)
          continue
        }
        pairs[key] = value
      }
      return { pairs: Object.keys(pairs).length === 0 ? undefined : pairs, bad }
    }

    function formFromEntry(name, entry) {
      const args = argsOf(entry)
      const env = pairsOf(entry?.env)
      const headers = pairsOf(entry?.headers)
      return {
        mode: 'edit',
        original: name,
        name,
        transport: entry?.transport === 'streamable-http' ? 'http' : 'stdio',
        command: String(entry?.command ?? ''),
        cwd: String(entry?.cwd ?? ''),
        url: String(entry?.url ?? ''),
        args: args.length > 0 ? args : [''],
        env: env.length > 0 ? env : [{ key: '', value: '' }],
        headers: headers.length > 0 ? headers : [{ key: '', value: '' }],
        startup: entry?.startupTimeoutMs === undefined ? '' : String(entry.startupTimeoutMs),
        toolTimeout: entry?.toolCallTimeoutMs === undefined ? '' : String(entry.toolCallTimeoutMs),
        reconnect: entry?.reconnect?.enabled !== false,
        expandTemplates: entry?.expandTemplates === true,
        enabled: entry?.enabled !== false,
      }
    }

    function blankForm() {
      return {
        mode: 'add',
        original: null,
        name: '',
        transport: 'stdio',
        command: '',
        cwd: '',
        url: '',
        args: [''],
        env: [{ key: '', value: '' }],
        headers: [{ key: '', value: '' }],
        startup: '',
        toolTimeout: '',
        reconnect: true,
        expandTemplates: false,
        enabled: true,
      }
    }

    // Empty means "use the plugin default"; anything else must be a positive
    // whole number of milliseconds.
    function positiveNumber(raw) {
      const value = String(raw ?? '').trim()
      if (value === '') return undefined
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) return null
      return Math.round(number)
    }

    function entryFromForm(t, form) {
      const entry = { transport: form.transport === 'http' ? 'streamable-http' : 'stdio', enabled: form.enabled !== false }
      if (entry.transport === 'stdio') {
        const command = String(form.command ?? '').trim()
        if (command === '') return { error: t('commandRequired') }
        entry.command = command
        const args = (Array.isArray(form.args) ? form.args : [])
          .map(value => String(value ?? '').trim())
          .filter(value => value !== '')
        if (args.length > 0) entry.args = args
        const env = collectPairs(form.env, 'ENV')
        if (env.bad.length > 0) return { error: t('pairNoKey', { what: t('env'), lines: env.bad.join(' / ') }) }
        if (env.pairs) entry.env = env.pairs
        const cwd = String(form.cwd ?? '').trim()
        if (cwd !== '') entry.cwd = cwd
      } else {
        const url = String(form.url ?? '').trim()
        if (!/^https?:\/\//i.test(url)) return { error: t('urlRequired') }
        entry.url = url
        const headers = collectPairs(form.headers, 'HEADER')
        if (headers.bad.length > 0) return { error: t('pairNoKey', { what: t('headers'), lines: headers.bad.join(' / ') }) }
        if (headers.pairs) entry.headers = headers.pairs
      }
      const startup = positiveNumber(form.startup)
      if (startup === null) return { error: t('startupInvalid') }
      if (startup !== undefined) entry.startupTimeoutMs = startup
      const toolTimeout = positiveNumber(form.toolTimeout)
      if (toolTimeout === null) return { error: t('toolTimeoutInvalid') }
      if (toolTimeout !== undefined) entry.toolCallTimeoutMs = toolTimeout
      if (form.expandTemplates === true) entry.expandTemplates = true
      if (form.reconnect === false) entry.reconnect = { enabled: false }
      return { entry }
    }

    // --------------------------------------------------------------- icon

    function PanelIcon({ size }) {
      const px = typeof size === 'number' ? size : 18
      return h('svg', { viewBox: '0 0 24 24', width: px, height: px, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 3, y: 4.5, width: 13, height: 5.5, rx: 1.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('rect', { x: 3, y: 14, width: 13, height: 5.5, rx: 1.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('circle', { cx: 6.2, cy: 7.25, r: 1, fill: 'currentColor' }),
        h('circle', { cx: 6.2, cy: 16.75, r: 1, fill: 'currentColor' }),
        h('path', { d: 'M9.5 7.25h4M9.5 16.75h4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('path', { d: 'M16 7.25h4.2v9.5H16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    // -------------------------------------------------------------- store

    // A tiny external store so the sidebar entry, the page and the Remote
    // wiring share one snapshot without a second state library.
    function createStore() {
      return {
        version: 0,
        listeners: new Set(),
        api: { settings: null, manager: null, inventory: null },
        flags: { settings: false, manager: false, inventory: false },
        errors: { settings: null, manager: null, managerStream: null, inventory: null },
        statuses: {},
        staticRows: [],
        bump() {
          this.version += 1
          for (const listener of [...this.listeners]) {
            try {
              listener()
            } catch {
              // A listener that throws must not stop the others.
            }
          }
        },
      }
    }

    function useStoreVersion(store) {
      return React.useSyncExternalStore(
        React.useCallback(listener => {
          store.listeners.add(listener)
          return () => store.listeners.delete(listener)
        }, [store]),
        React.useCallback(() => store.version, [store]),
      )
    }

    // --------------------------------------------------------------- page

    function Panel({ t, store, close }) {
      useStoreVersion(store)
      const [snapshot, setSnapshot] = React.useState(null)
      const [loadError, setLoadError] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [form, setForm] = React.useState(null)
      const [probes, setProbes] = React.useState({})
      const [busyName, setBusyName] = React.useState('')
      const [message, setMessage] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [confirmDelete, setConfirmDelete] = React.useState('')
      const [saving, setSaving] = React.useState(false)
      const [checking, setChecking] = React.useState(false)

      const readSnapshot = React.useCallback(async () => {
        const api = store.api.settings
        if (!api?.describe) return { error: t('settingsMissing') }
        try {
          const result = await unwrap(api.describe())
          if (!result.ok) return { error: failureText(result) }
          const row = pickNamespace(result.value)
          if (!row) return { managerMissing: true }
          return {
            ns: row.ns,
            revision: row.revision,
            servers: normaliseServers(row.value?.servers),
          }
        } catch (error) {
          return { error: String(error?.message ?? error) }
        }
      }, [store, t])

      const refresh = React.useCallback(async () => {
        setLoading(true)
        const next = await readSnapshot()
        setLoading(false)
        if (next.managerMissing) {
          setSnapshot(null)
          setLoadError(t('managerMissing'))
          return
        }
        if (next.error) {
          setLoadError(next.error)
          return
        }
        setSnapshot(next)
        setLoadError(null)
      }, [readSnapshot, t])

      React.useEffect(() => {
        void refresh()
      }, [refresh, store.flags.settings])

      const writeOps = React.useCallback(async (ops, okText, scope) => {
        const api = store.api.settings
        const where = scope ?? 'page'
        if (!api?.mutate) {
          setMessage({ kind: 'error', text: t('settingsMissing'), scope: where })
          return false
        }
        const ns = snapshot?.ns
        if (!ns) {
          setMessage({ kind: 'error', text: t('managerMissing'), scope: where })
          return false
        }
        setSaving(true)
        let revision = snapshot?.revision
        try {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const result = await unwrap(api.mutate(ns, ops, revision))
            if (result.ok) {
              setMessage({ kind: 'ok', text: okText, scope: where })
              await refresh()
              return true
            }
            const text = failureText(result)
            // A stale revision while the page stayed open is the one failure
            // worth retrying: re-read the authoritative revision and repeat.
            if (attempt === 0 && /revision|conflict|stale|changed/i.test(text)) {
              const fresh = await readSnapshot()
              if (fresh && typeof fresh.revision === 'number') {
                revision = fresh.revision
                continue
              }
            }
            setMessage({ kind: 'error', text: `${t('saveFailed')}：${text}`, scope: where })
            return false
          }
          setMessage({ kind: 'error', text: t('saveFailed'), scope: where })
          return false
        } catch (error) {
          setMessage({ kind: 'error', text: `${t('saveFailed')}：${String(error?.message ?? error)}`, scope: where })
          return false
        } finally {
          setSaving(false)
        }
      }, [store, snapshot, refresh, readSnapshot, t])

      const probe = React.useCallback(async (name) => {
        const api = store.api.manager
        // Remember which live status the probe started from: as soon as the
        // Host reports something else, the probe result is stale and ignored.
        const signature = statusSignature(store.statuses[name])
        if (!api?.probe) {
          setProbes(previous => ({ ...previous, [name]: { at: Date.now(), signature, error: t('noManagerApi') } }))
          return
        }
        setProbes(previous => ({ ...previous, [name]: { ...(previous[name] ?? {}), pending: true, signature } }))
        try {
          const result = await unwrap(api.probe(name))
          if (!result.ok) {
            setProbes(previous => ({ ...previous, [name]: { at: Date.now(), signature, error: failureText(result) } }))
            return
          }
          const value = result.value
          if (value?.ok === true) {
            setProbes(previous => ({
              ...previous,
              [name]: {
                at: Date.now(),
                signature,
                ok: true,
                tools: Array.isArray(value.toolNames) ? value.toolNames.length : 0,
                truncated: value.truncated === true,
                server: isObject(value.serverInfo) ? `${value.serverInfo.name} ${value.serverInfo.version}` : '',
                durationMs: value.durationMs,
                closeConfirmed: value.closeConfirmed !== false,
                cleanupError: value.closeConfirmed === false ? t('closeUnconfirmed') : value.cleanupError,
              },
            }))
          } else {
            setProbes(previous => ({
              ...previous,
              [name]: {
                at: Date.now(),
                signature,
                ok: false,
                stage: value?.stage ?? '',
                message: String(value?.message ?? ''),
                durationMs: value?.durationMs,
                cleanupError: value?.closeConfirmed === false ? t('closeUnconfirmed') : value?.cleanupError,
              },
            }))
          }
        } catch (error) {
          setProbes(previous => ({ ...previous, [name]: { at: Date.now(), signature, error: String(error?.message ?? error) } }))
        }
      }, [store, t])

      const restart = React.useCallback(async (name) => {
        const api = store.api.manager
        if (!api?.restart) {
          setMessage({ kind: 'error', text: t('noManagerApi'), scope: 'page' })
          return
        }
        setBusyName(name)
        try {
          const result = await unwrap(api.restart(name))
          setProbes(previous => ({ ...previous, [name]: undefined }))
          setMessage(result.ok
            ? { kind: 'ok', text: `${name}: ${t('stateConnecting')}`, scope: 'page' }
            : { kind: 'error', text: `${name}: ${failureText(result)}`, scope: 'page' })
        } catch (error) {
          setMessage({ kind: 'error', text: `${name}: ${String(error?.message ?? error)}`, scope: 'page' })
        } finally {
          setBusyName('')
        }
      }, [store, t])

      const servers = snapshot?.servers ?? {}
      const serverNames = Object.keys(servers)
      const checkableNames = serverNames.filter(name => servers[name]?.enabled !== false)
      const statuses = store.statuses

      // Registered servers the manager knows but the config does not: a plugin
      // contributes them, so they are observable but not editable here.
      const registeredNames = Object.keys(statuses).filter(name => !Object.hasOwn(servers, name))

      const liveOf = name => statuses[name]

      // A probe answers one moment in time. As soon as the Host reports a
      // different live status for that server, the answer no longer describes
      // it, so the dot falls back to the live state instead of staying red.
      const freshProbe = name => {
        const probe = probes[name]
        if (!probe) return null
        if (probe.pending === true) return probe
        if (probe.signature !== statusSignature(liveOf(name))) return null
        return probe
      }

      const toneOf = name => {
        const probe = freshProbe(name)
        if (probe?.pending) return 'busy'
        if (probe && probe.ok === true) return 'ok'
        if (probe && probe.ok === false) return 'error'
        if (probe?.error) return 'error'
        const live = describeLive(t, liveOf(name))
        if (live) return live.tone
        return 'idle'
      }

      const labelOf = name => {
        const probe = freshProbe(name)
        if (probe?.pending) return t('probing')
        if (probe && probe.ok === true) return `${t('probeOk')} · ${t('tools', { n: probe.tools ?? 0 })}`
        if (probe && probe.ok === false) return `${t('probeFailed')} · ${probe.stage}`
        if (probe?.error) return `${t('probeFailed')} · ${probe.error}`
        const live = describeLive(t, liveOf(name))
        if (live) return live.label
        if (servers[name] && servers[name].enabled === false) return t('stateDisabled')
        return t('stateUnknown')
      }

      const detailOf = name => {
        const parts = []
        const live = describeLive(t, liveOf(name))
        if (live?.detail) parts.push(live.detail)
        const probe = freshProbe(name)
        if (probe && probe.ok === false) parts.push(`${probe.stage}: ${probe.message}`)
        else if (probe?.error) parts.push(probe.error)
        else if (probe?.ok === true && probe.cleanupError) parts.push(probe.cleanupError)
        return parts.filter(part => part !== '').join(' · ')
      }

      const summary = (() => {
        let ok = 0
        let bad = 0
        for (const name of serverNames) {
          const tone = toneOf(name)
          if (tone === 'ok') ok += 1
          else if (tone === 'error') bad += 1
        }
        return { total: serverNames.length, ok, bad }
      })()

      const filtered = serverNames.filter(name => {
        const needle = query.trim().toLowerCase()
        if (needle === '') return true
        const entry = servers[name]
        return name.toLowerCase().includes(needle)
          || specOf(entry).toLowerCase().includes(needle)
          || transportLabel(entry).toLowerCase().includes(needle)
      })

      const submit = React.useCallback(async () => {
        if (!form) return
        const name = String(form.name ?? '').trim()
        if (!NAME_RE.test(name)) {
          setMessage({ kind: 'error', text: t('nameInvalid'), scope: 'form' })
          return
        }
        const original = form.mode === 'edit' ? form.original : null
        // A rename onto an existing key would replace that server outright, so
        // the collision rule applies to edits too.
        if (Object.hasOwn(servers, name) && name !== original) {
          setMessage({ kind: 'error', text: t('managerConflict', { name }), scope: 'form' })
          return
        }
        const parsed = entryFromForm(t, form)
        if (parsed.error) {
          setMessage({ kind: 'error', text: parsed.error, scope: 'form' })
          return
        }
        // Keep the fields this form does not model (toolCallTimeoutMs,
        // closeTimeoutMs, reconnect, …) instead of resetting them on every save.
        const base = original && isObject(servers[original]) ? { ...servers[original] } : {}
        for (const key of ['transport', 'command', 'args', 'env', 'cwd', 'url', 'headers', 'startupTimeoutMs', 'toolCallTimeoutMs', 'expandTemplates', 'reconnect', 'enabled']) {
          delete base[key]
        }
        const next = { ...base, ...parsed.entry }
        const ops = []
        if (original && original !== name) ops.push({ op: 'unset', path: ['servers', original] })
        ops.push({ op: 'set', path: ['servers', name], value: next })
        const ok = await writeOps(ops, t('saveOk'), 'form')
        if (ok) {
          const cleared = { [name]: undefined }
          if (original && original !== name) cleared[original] = undefined
          setForm(null)
          setProbes(previous => ({ ...previous, ...cleared }))
        }
      }, [form, servers, t, writeOps])

      const removeServer = React.useCallback(async (name) => {
        const ok = await writeOps([{ op: 'unset', path: ['servers', name] }], t('deleteOk'), 'page')
        if (ok) {
          setConfirmDelete('')
          setProbes(previous => ({ ...previous, [name]: undefined }))
        }
      }, [writeOps, t])

      const toggleEnabled = React.useCallback(async (name) => {
        const entry = servers[name]
        if (!entry) return
        await writeOps([{ op: 'set', path: ['servers', name, 'enabled'], value: entry.enabled === false }], t('saveOk'), 'page')
        setProbes(previous => ({ ...previous, [name]: undefined }))
      }, [servers, writeOps, t])

      const checkAll = React.useCallback(async () => {
        const names = checkableNames
        if (names.length === 0) {
          setMessage({ kind: 'error', text: t('stateDisabled'), scope: 'page' })
          return
        }
        setChecking(true)
        try {
          for (const name of names) {
            // Sequential on purpose: probing a stdio server starts a process.
            await probe(name)
          }
        } finally {
          setChecking(false)
        }
      }, [checkableNames, probe, t])

      const ago = at => {
        if (!at) return ''
        const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
        if (seconds < 10) return t('justNow')
        if (seconds < 60) return t('secondsAgo', { n: seconds })
        return t('minutesAgo', { n: Math.round(seconds / 60) })
      }

      const row = (name, entry, options) => {
        const readonly = options.registered === true || options.removed === true
        const tone = toneOf(name)
        const pending = probes[name]?.pending === true
        const spec = readonly ? '' : specOf(entry, t('noCommand'))
        const probeAt = freshProbe(name)?.at
        const detail = detailOf(name)
        const rowDisabled = saving
        return h('div', { className: 'mc-row', key: `server-${name}` },
          h('button', {
            type: 'button',
            className: 'mc-dotwrap',
            title: t('check'),
            'aria-label': `${t('check')} ${name}`,
            disabled: pending,
            onClick: () => { void probe(name) },
          }, h('span', { className: `mc-dot ${tone}${pending ? ' busy' : ''}` })),
          h('div', { className: 'mc-main' },
            h('div', { className: 'mc-rowhead' },
              h('span', { className: 'mc-name' }, name),
              options.removed === true
                ? h('span', { className: 'mc-pill warn' }, t('removedBadge'))
                : options.registered === true
                  ? h('span', { className: 'mc-pill' }, t('registeredBadge'))
                  : h('span', { className: 'mc-pill' }, transportLabel(entry)),
              !readonly && entry?.enabled === false ? h('span', { className: 'mc-pill warn' }, t('disabled')) : null,
              h('span', { className: `mc-state ${tone}` }, labelOf(name)),
              probeAt ? h('span', { className: 'mc-hint' }, ago(probeAt)) : null,
            ),
            spec !== '' ? h('div', { className: 'mc-spec', title: spec }, spec) : null,
            detail !== '' ? h('div', { className: `mc-detail ${tone === 'ok' ? '' : tone}` }, detail) : null,
          ),
          h('div', { className: 'mc-actions' },
            h('button', {
              type: 'button', className: 'mc-btn small', disabled: rowDisabled || busyName === name,
              onClick: () => { void restart(name) },
            }, busyName === name ? t('restarting') : t('restart')),
            readonly
              ? h('button', {
                type: 'button', className: 'mc-btn small', disabled: pending || rowDisabled,
                onClick: () => { void probe(name) },
              }, pending ? t('checking') : t('check'))
              : null,
            !readonly
              ? h('button', {
                type: 'button', className: 'mc-btn small', disabled: rowDisabled,
                onClick: () => { setMessage(null); setForm(formFromEntry(name, entry)) },
              }, t('edit'))
              : null,
            !readonly
              ? h('button', {
                type: 'button', className: 'mc-btn small', disabled: rowDisabled,
                onClick: () => { void toggleEnabled(name) },
              }, entry?.enabled === false ? t('enable') : t('disable'))
              : null,
            !readonly
              ? (confirmDelete === name
                ? h(React.Fragment, null,
                  h('button', {
                    type: 'button', className: 'mc-btn small danger', disabled: rowDisabled,
                    onClick: () => { void removeServer(name) },
                  }, t('confirmRemove')),
                  h('button', {
                    type: 'button', className: 'mc-btn small',
                    onClick: () => setConfirmDelete(''),
                  }, t('cancel')))
                : h('button', {
                  type: 'button', className: 'mc-btn small danger', disabled: rowDisabled,
                  onClick: () => setConfirmDelete(name),
                }, t('remove')))
              : null,
          ))
      }

      const trashIcon = () => h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M4 7h16M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7M6.6 7l.8 12.1c.05.7.6 1.2 1.3 1.2h6.6c.7 0 1.25-.5 1.3-1.2L17.4 7', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))

      const setField = patch => setForm(current => (current === null ? current : { ...current, ...patch }))

      // Key/value rows: input + input + trash, matching the reference form.
      const pairRows = (rows, onChange, kind) => (Array.isArray(rows) ? rows : []).map((row, index) => h('div', { className: 'mc-pair', key: kind + '-' + index },
        h('input', {
          className: 'mc-input mono', value: row.key, placeholder: t('keyPlaceholder'), spellCheck: false,
          'aria-label': t('keyPlaceholder'),
          onChange: event => onChange(rows.map((item, at) => (at === index ? { ...item, key: event.target.value } : item))),
        }),
        h('input', {
          className: 'mc-input mono', value: row.value, placeholder: t('valuePlaceholder'), spellCheck: false,
          'aria-label': t('valuePlaceholder'),
          onChange: event => onChange(rows.map((item, at) => (at === index ? { ...item, value: event.target.value } : item))),
        }),
        h('button', {
          type: 'button', className: 'mc-trash', title: t('removeRow'), 'aria-label': t('removeRow'),
          onClick: () => onChange(rows.filter((_, at) => at !== index)),
        }, trashIcon()),
      ))

      const editor = form === null ? null : h('div', { className: 'mc-editor', key: 'editor' },
        h('div', { className: 'mc-sheet' },
          h('div', { className: 'mc-frow' },
            h('label', { className: 'mc-flabel', htmlFor: 'mc-name' }, t('name')),
            h('input', {
              id: 'mc-name', className: 'mc-input mono', value: form.name, spellCheck: false,
              placeholder: 'filesystem', autoFocus: true,
              onChange: event => setField({ name: event.target.value }),
            }),
            h('p', { className: 'mc-fhint' }, t('nameHint')),
          ),
          h('div', { className: 'mc-frow split' },
            h('span', { className: 'mc-flabel' }, t('transport')),
            h('div', { className: 'mc-seg', role: 'group', 'aria-label': t('transport') },
              h('button', { type: 'button', 'aria-pressed': form.transport !== 'http', onClick: () => setField({ transport: 'stdio' }) }, t('stdio')),
              h('button', { type: 'button', 'aria-pressed': form.transport === 'http', onClick: () => setField({ transport: 'http' }) }, t('http')),
            ),
          ),
        ),
        h('div', { className: 'mc-sheet' },
          form.transport === 'http'
            ? h(React.Fragment, null,
              h('div', { className: 'mc-frow' },
                h('label', { className: 'mc-flabel', htmlFor: 'mc-url' }, t('url')),
                h('input', {
                  id: 'mc-url', className: 'mc-input mono', value: form.url, spellCheck: false,
                  placeholder: 'https://mcp.example.com/mcp',
                  onChange: event => setField({ url: event.target.value }),
                }),
              ),
              h('div', { className: 'mc-frow' },
                h('span', { className: 'mc-flabel' }, t('headers')),
                pairRows(form.headers, rows => setField({ headers: rows }), 'header'),
                h('button', {
                  type: 'button', className: 'mc-addbtn',
                  onClick: () => setField({ headers: [...(form.headers ?? []), { key: '', value: '' }] }),
                }, '＋ ' + t('addHeader')),
              ),
            )
            : h(React.Fragment, null,
              h('div', { className: 'mc-frow' },
                h('label', { className: 'mc-flabel', htmlFor: 'mc-command' }, t('command')),
                h('input', {
                  id: 'mc-command', className: 'mc-input mono', value: form.command, spellCheck: false,
                  placeholder: 'npx',
                  onChange: event => setField({ command: event.target.value }),
                }),
              ),
              h('div', { className: 'mc-frow' },
                h('span', { className: 'mc-flabel' }, t('args')),
                (form.args ?? []).map((value, index) => h('div', { className: 'mc-iter', key: 'arg-' + index },
                  h('input', {
                    className: 'mc-input mono', value, spellCheck: false, placeholder: t('argPlaceholder'),
                    'aria-label': t('argPlaceholder') + ' ' + (index + 1),
                    onChange: event => setField({ args: (form.args ?? []).map((item, at) => (at === index ? event.target.value : item)) }),
                  }),
                  h('button', {
                    type: 'button', className: 'mc-trash', title: t('removeRow'), 'aria-label': t('removeRow'),
                    onClick: () => setField({ args: (form.args ?? []).filter((_, at) => at !== index) }),
                  }, trashIcon()),
                )),
                h('button', {
                  type: 'button', className: 'mc-addbtn',
                  onClick: () => setField({ args: [...(form.args ?? []), ''] }),
                }, '＋ ' + t('addArg')),
              ),
              h('div', { className: 'mc-frow' },
                h('span', { className: 'mc-flabel' }, t('env')),
                pairRows(form.env, rows => setField({ env: rows }), 'env'),
                h('button', {
                  type: 'button', className: 'mc-addbtn',
                  onClick: () => setField({ env: [...(form.env ?? []), { key: '', value: '' }] }),
                }, '＋ ' + t('addEnv')),
              ),
              h('div', { className: 'mc-frow' },
                h('label', { className: 'mc-flabel', htmlFor: 'mc-cwd' }, t('cwd')),
                h('input', {
                  id: 'mc-cwd', className: 'mc-input mono', value: form.cwd, spellCheck: false,
                  placeholder: 'C:\\work',
                  onChange: event => setField({ cwd: event.target.value }),
                }),
              ),
            ),
        ),
        h('div', { className: 'mc-sheet' },
          h('div', { className: 'mc-frow' },
            h('span', { className: 'mc-flabel' }, t('advanced')),
            h('div', { className: 'mc-pair' },
              h('input', {
                className: 'mc-input', value: form.startup, inputMode: 'numeric',
                placeholder: t('startup'), 'aria-label': t('startup'),
                onChange: event => setField({ startup: event.target.value }),
              }),
              h('input', {
                className: 'mc-input', value: form.toolTimeout, inputMode: 'numeric',
                placeholder: t('toolTimeout'), 'aria-label': t('toolTimeout'),
                onChange: event => setField({ toolTimeout: event.target.value }),
              }),
              h('span'),
            ),
            h('label', { className: 'mc-switchrow' },
              h('input', {
                type: 'checkbox', className: 'mc-switch', checked: form.reconnect !== false,
                onChange: event => setField({ reconnect: event.target.checked }),
              }),
              t('reconnect'),
            ),
            h('label', { className: 'mc-switchrow' },
              h('input', {
                type: 'checkbox', className: 'mc-switch', checked: form.expandTemplates === true,
                onChange: event => setField({ expandTemplates: event.target.checked }),
              }),
              t('templates'),
            ),
            h('label', { className: 'mc-switchrow' },
              h('input', {
                type: 'checkbox', className: 'mc-switch', checked: form.enabled !== false,
                onChange: event => setField({ enabled: event.target.checked }),
              }),
              t('pluginFields'),
            ),
          ),
        ),
        h('div', { className: 'mc-savebar' },
          message?.scope === 'form' ? h('span', { className: 'mc-status mc-msg ' + message.kind }, message.text) : null,
          h('button', {
            type: 'button', className: 'mc-btn', disabled: saving,
            onClick: () => { setForm(null); setMessage(null) },
          }, t('cancel')),
          h('button', {
            type: 'button', className: 'mc-btn primary', disabled: saving,
            onClick: () => { void submit() },
          }, saving ? t('saving') : t('save')),
        ),
      )
      const staticView = staticRows.length === 0
        ? h('p', { className: 'mc-muted' }, t('staticEmpty'))
        : staticRows.map(entry => {
          const phase = describePhase(t, entry)
          return h('div', { className: 'mc-row', key: `static-${entry.entryId}` },
            h('span', { className: 'mc-dotwrap', style: { cursor: 'default' } },
              h('span', { className: `mc-dot ${phase.tone}` })),
            h('div', { className: 'mc-main' },
              h('div', { className: 'mc-rowhead' },
                h('span', { className: 'mc-name' }, String(entry.entryId)),
                h('span', { className: 'mc-pill' }, t('staticPill')),
                h('span', { className: 'mc-pill' }, t('readonlyPill')),
                h('span', { className: `mc-state ${phase.tone}` }, phase.label),
              ),
              h('div', { className: 'mc-spec' }, `${MCP_MODULE} · ${String(entry.moduleName ?? '')}`),
              phase.detail !== '' ? h('div', { className: 'mc-detail error' }, phase.detail) : null,
            ))
        })

      const served = store.flags.settings
      const pending = !served && loadError === null
      const editing = form !== null
      const head = h('div', { className: 'mc-head', key: 'head' },
        h('button', {
          type: 'button', className: 'mc-back',
          onClick: () => { if (editing) { setForm(null); setMessage(null) } else { close() } },
        }, '← ' + t('back')),
        h('div', { className: 'mc-titleblock' },
          h('h1', { className: 'mc-h1' }, editing
            ? (form.mode === 'edit' ? t('formEdit', { name: form.original }) : t('formAdd'))
            : t('title')),
          h('p', { className: 'mc-sub' }, editing ? t('editorSubtitle') : t('subtitle'))))

      if (editing) {
        return h('div', { className: 'mc-page' },
          h('style', { key: 'css' }, CSS),
          h('div', { className: 'mc-inner' }, head, editor))
      }

      if (pending && serverNames.length === 0) {
        return h('div', { className: 'mc-page' },
          h('style', { key: 'css' }, CSS),
          h('div', { className: 'mc-inner' }, head, h('p', { className: 'mc-muted' }, t('loading'))))
      }

      return h('div', { className: 'mc-page' },
        h('style', { key: 'css' }, CSS),
        h('div', { className: 'mc-inner' },
          head,
          h('div', { className: 'mc-bar', key: 'bar' },
            h('button', {
              type: 'button', className: 'mc-btn primary',
              disabled: loading || !!loadError,
              onClick: () => { setMessage(null); setForm(blankForm()) },
            }, t('add')),
            h('button', {
              type: 'button', className: 'mc-btn', disabled: loading,
              onClick: () => { void refresh() },
            }, loading ? t('loading') : t('refresh')),
            h('button', {
              type: 'button', className: 'mc-btn',
              disabled: checking || checkableNames.length === 0,
              onClick: () => { void checkAll() },
            }, checking ? t('checking') : t('checkAll')),
            h('span', { className: 'mc-status' }, loadError ? '' : t('countSummary', summary))),

          message && message.scope !== 'form' ? h('p', { className: 'mc-msg ' + message.kind, key: 'msg' }, message.text) : null,
          loadError ? h('p', { className: 'mc-msg error', key: 'loaderr' }, loadError) : null,
          !store.flags.manager
            ? h('p', { className: 'mc-msg error', key: 'mgrerr' }, t('noManagerApi'))
            : null,
          store.errors.managerStream
            ? h('p', { className: 'mc-msg error', key: 'streamerr' }, t('streamLost', { reason: store.errors.managerStream }))
            : null,

          h('div', { className: 'mc-section', key: 'list' },
            h('div', { className: 'mc-rowhead' },
              h('p', { className: 'mc-h2' }, t('sectionList')),
              query !== '' || serverNames.length > 3
                ? h('input', {
                  className: 'mc-input mono', value: query, placeholder: t('search'),
                  'aria-label': t('search'), spellCheck: false,
                  style: { maxWidth: '280px', marginLeft: 'auto', minHeight: '32px' },
                  onChange: event => setQuery(event.target.value),
                })
                : null),
            h('div', { className: 'mc-card' },
              loading && serverNames.length === 0
                ? h('div', { className: 'mc-empty' }, t('loading'))
                : filtered.length === 0
                  ? h('div', { className: 'mc-empty' }, serverNames.length === 0 ? t('empty') : t('noMatch'))
                  : filtered.map(name => row(name, servers[name], {})))),

          h('div', { className: 'mc-section', key: 'static' },
            h('p', { className: 'mc-h2' }, t('sectionStatic')),
            h('p', { className: 'mc-muted' }, t('staticHint')),
            store.errors.inventory
              ? h('p', { className: 'mc-msg error' }, t('inventoryFailed', { reason: store.errors.inventory }))
              : null,
            h('div', { className: 'mc-card' },
              registeredNames.length > 0
                ? registeredNames.map(name => row(name, null, {
                  registered: true,
                  removed: liveOf(name)?.configured === false,
                }))
                : null,
              staticRows.length > 0 ? staticView : null,
              registeredNames.length === 0 && staticRows.length === 0 && !store.errors.inventory
                ? h('div', { className: 'mc-empty' }, store.flags.inventory ? t('staticEmpty') : t('inventoryPending'))
                : null)),

          h('details', { className: 'mc-help', key: 'help' },
            h('summary', null, t('helpTitle')),
            h('p', null, t('helpBody1')),
            h('p', null, t('helpBody2')),
            h('p', null, t('helpBody3'))),
        ))
    }

    // ------------------------------------------------------------- plugin

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        let language = activeLanguage(ctx)
        const store = createStore()

        ctx.effect(() => {
          try {
            const off = ctx.locale?.onChange?.(() => {
              language = activeLanguage(ctx)
              store.bump()
            })
            return typeof off === 'function' ? off : () => {}
          } catch {
            return () => {}
          }
        }, 'mcp-panel: locale')

        const t = (key, vars) => {
          const table = STRINGS[language] ?? STRINGS.zh
          const text = table[key] ?? STRINGS.zh[key] ?? STRINGS.en[key] ?? key
          if (!vars) return String(text)
          return String(text).replace(/\{\{(\w+)\}\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])))
        }

        const close = () => {
          try {
            const layout = ctx.get?.('layout')
            if (layout?.selectPanel) {
              // Clearing the selection returns the shell to the conversation;
              // an older shell only accepts the conversation id.
              layout.selectPanel(null)
              if (layout.panelInfo?.getSnapshot?.()?.activePanelId === PANEL_ID) layout.selectPanel('conversation')
            }
          } catch {
            // Leaving the panel is the shell's job; never throw from a click.
          }
        }

        // Configuration writes and reads: the volatile `mcp-manager.servers`
        // map, addressed by its profile entry id.
        ctx.inject(['remote', 'remote.settings'], child => {
          child.effect(() => {
            store.api.settings = child.remote.settings
            store.flags.settings = true
            store.errors.settings = null
            store.bump()
            return () => {
              store.api.settings = null
              store.flags.settings = false
              store.bump()
            }
          }, 'mcp-panel: settings')
        })

        // Live fleet state. `watch` replays the complete list on subscription
        // and after every status or entry change.
        ctx.inject(['remote', 'remote.mcpManager'], child => {
          child.effect(() => {
            store.api.manager = child.remote.mcpManager
            store.flags.manager = true
            store.errors.manager = null
            store.errors.managerStream = null
            store.bump()
            let stream = null
            try {
              if (typeof child.remote.$stream === 'function') {
                stream = child.remote.$stream({
                  name: 'mcpManager',
                  open: signal => child.remote.mcpManager.watch(signal),
                  ended: () => new Error('mcpManager watch ended'),
                  carrierFailed: () => {
                    store.errors.managerStream = 'watch carrier failed'
                    store.bump()
                  },
                })
              } else {
                store.errors.managerStream = 'no stream carrier'
                store.bump()
              }
            } catch (error) {
              store.errors.managerStream = String(error?.message ?? error)
              store.bump()
            }
            if (stream) {
              void (async () => {
                try {
                  for await (const frame of stream) {
                    const list = frame?.value
                    if (!Array.isArray(list)) continue
                    const next = {}
                    for (const view of list) {
                      if (isObject(view) && typeof view.name === 'string') next[view.name] = view
                    }
                    store.statuses = next
                    store.errors.managerStream = null
                    store.bump()
                  }
                } catch (error) {
                  store.errors.manager = String(error?.message ?? error)
                  store.bump()
                }
              })()
            }
            return () => {
              try {
                stream?.dispose?.()
              } catch {
                // Already gone.
              }
              store.api.manager = null
              store.flags.manager = false
              store.statuses = {}
              store.bump()
            }
          }, 'mcp-panel: manager')
        })

        // Read-only view of MCP servers this composition supplies another way:
        // static `dsh-mcp-client` rows and rows an installed plugin adds.
        ctx.inject(['remote', 'remote.pluginInventory'], child => {
          child.effect(() => {
            store.api.inventory = child.remote.pluginInventory
            store.bump()
            void (async () => {
              try {
                const result = await child.remote.pluginInventory.list()
                const snapshot = isObject(result) && 'ok' in result ? (result.ok ? result.value : null) : result
                const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : []
                store.staticRows = entries.filter(entry => String(entry?.moduleName ?? '').startsWith(MCP_MODULE))
                store.errors.inventory = snapshot === null ? 'inventory read failed' : null
              } catch (error) {
                store.errors.inventory = String(error?.message ?? error)
              } finally {
                store.flags.inventory = true
                store.bump()
              }
            })()
            return () => {
              store.api.inventory = null
              store.flags.inventory = false
              store.staticRows = []
              store.bump()
            }
          }, 'mcp-panel: inventory')
        })

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 22,
          label: () => t('sidebarLabel'),
        }, props => {
          return h(PanelIcon, props)
        }))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, () => h(Panel, { t, store, close })))
      },
    }
  },
})
