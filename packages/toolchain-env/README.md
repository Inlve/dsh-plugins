# @inlve/dsh-toolchain-env

把「版本管理器装的工具链」送进 DSH 的每一个子进程，并给出一页可视化的工具链设置。

DSH 的模型 shell 是 `pwsh -NoLogo -NoProfile -NonInteractive`（POSIX 上是 `bash -c`），**不加载 profile**。
于是任何靠 profile 激活自己的工具链——`fnm env`、`volta`、`mise activate`、`pyenv init`——在 DSH 里都看不见，
尽管你自己的终端里一切正常。本插件把那些目录**追加**进宿主进程的 PATH，全部子进程（`pwsh`/`bash` 工具、
Web 侧栏终端、MCP stdio server、子 agent）随之继承。

- **可在面板里浏览与勾选**：左侧栏「工具链」→ 主区域设置页。扫描本机、逐行勾选、覆盖路径、加备注，
  保存即生效（下一条命令），不需要重启，也不需要 session。
- **只追加，不前置**：默认不覆盖任何已有解析，也不会把用户可写目录排到系统目录前面。
- **零持久化**：不写注册表、不改用户 PATH、不生成 `.cmd` 垫片。DSH 退出即还原。
- **可审计**：每次重算都记进 `~/.dsh/toolchain-env/pathenv.jsonl`。
- **可诊断**：`toolchain_env which` 按 PowerShell 的规则复现解析，`verify` 真起一次 pwsh 对照。

## 为什么需要它

宿主进程的环境是子进程环境的唯一来源：子进程服务每次 spawn 时遍历 `process.env`，剔除
credential 形状的变量名和 `DSH_*`，**保留 PATH**。DSH 没有「按次注入 env」的入口（`pwsh` 工具没有
env 参数，`ctx.shellEnv` 只收 `DSH_*`，`~/.dsh/.env` 明确拒绝 `PATH`），所以宿主 PATH 是唯一可用的杠杆。

## 有效 PATH 怎么算

按来源顺序合并，**去重**、**只保留存在的目录**，再按位置（append / prepend）整体拼接：

```
旧 pathEntries  ∪  旧 discover 表  ∪  toolchainEntries（面板清单）  ∪  autoScan 时的扫描目录
```

- 同一个目录被两个来源认领时，先出现的来源胜出（`status` 的 `←` 后显示 source），不会重复上 PATH。
- 取消勾选的行只停用、不参与合并，也不会被报成「缺失」。
- 无法展开（未定义 `%VAR%`、相对路径）的条目单独报告；不存在的目录单独报告。

## 设置面板

左侧栏图标 → 主区域页面（`sidebar.panellist` 只画图标，页面注册在 keyed 根 slot `main`，key 与图标 id 相同）。

| 区块 | 内容 |
|---|---|
| 工具栏 | 保存（`#0e639c` 主按钮）/ 还原 / 状态提示（有未保存的更改、已保存…） |
| 工具链清单 | 每行：启用勾选、id 徽标、等宽路径、备注、命令徽标、已生效/已停用标记、删除；底部一行是「id + 路径 + 备注」+ 添加 |
| 生效方式 | 自动发现开关、位置（跟随配置 / append / prepend），改动即时保存 |
| 自动发现 | 通过 `/toolchain scan --json` 列出本机已安装目录、命令与版本，逐项「加入」清单；**没有可用会话时整块隐藏**，清单编辑不依赖会话 |
| 生效状态 | 通过 `/toolchain list --json` 显示当前真正生效的目录数与位置 |
| 格式与行为 | 折叠的帮助区：文本格式、宿主 PATH 的生效范围、零持久化说明 |

面板通过 `configForms` 读写 volatile 配置，Host 在下一次工具调用前比较配置签名，变了就立刻重算 PATH。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关；关闭时 PATH 保持原样 |
| `position` | `append` | `append`（不抢解析）或 `prepend` |
| `pathEntries` | `[]` | 额外目录，按顺序（旧字段，继续支持） |
| `discover` | `true` | 是否使用内置管理器表 |
| `managers` | `[]` | 为空表示全部；填 id 则只取这些 |
| `toolchainEntries` | `''` | **面板清单**，多行「id &#124; path &#124; note」（volatile，改完下一条命令生效） |
| `toolchainAutoScan` | `true` | **自动发现**：把扫描到的已存在目录也加入（volatile） |
| `toolchainPosition` | `''` | 面板选择的位置；空表示跟随 `position`（volatile） |
| `refreshTtlMs` | `30000` | 运行中按此间隔重查候选目录（`0` 关闭） |
| `selfTestOnActivate` | `true` | 激活后跑一次真实 pwsh 探针，只告警不阻断 |
| `warnOnVersionFile` | `true` | `.node-version`/`.nvmrc`/`engines` 与默认版本不同时记一条告警 |
| `verifyCommands` | `[]` | `verify` 探测的命令；空则从已加目录推导 |
| `reportDir` | `''` | 审计目录；空表示 `~/.dsh/toolchain-env` |
| `audit` | `true` | 是否写审计 |
| `powershell` | `''` | 探针用的 PowerShell；空则先试绝对路径再退回 PATH |

### `toolchainEntries` 文本格式

```yaml
toolchainEntries: |
  fnm | %APPDATA%\fnm\aliases\default | Node via fnm
  %LOCALAPPDATA%\pnpm | pnpm 全局
  !C:\Tools\old | 暂时停用
  # 井号开头是注释
```

- `id | path | note`：path 支持 `%VAR%` 和开头的 `~`；相对路径会被拒绝（并报告）。
- 两种简写：只写 `path`，或 `path | note`（第一段像目录时按路径理解）。
- 行首 `!` 表示停用；面板的勾选框就写这个标记。
- `id` 只用于显示与审计，可以省略（页面显示「无 id」）。

## 工具与命令

`toolchain_env`：`status`、`which <命令>`、`verify [命令]`、`scan [versions]`、`list`、`refresh`、`audit [条数]`、`save_entries <文本>`。

`/toolchain [status|list|scan|refresh|verify|audit|which <命令>] [--json] [--versions]`

- `scan`：结构化浏览本机候选目录（`{ id, label, manager, path, exists, entries, commands, version, listed }`）。
  加 `versions`/`--versions` 才对每个已安装目录的首个可执行文件跑一次 `--version`（每个 3 秒超时，只跑 `.exe`）。
- `list`：当前**有效清单**——配置了什么、展开成什么、缺什么（`configured` / `wanted` / `missing` / `unresolved`）。
- `--json`：`scan`、`list` 输出的机器可读形式；面板就是靠它取数。
- `save_entries`：把面板清单写进 volatile 配置（`settings` 服务，无需会话）；不给文本时只报告哪些配置项可写——诊断与 CLI 通道。

### 面板保存

保存直接调 `settings.mutate('toolchain-env', …)`，写前用 `settings.describe()` 读**权威 revision**（浏览器侧的 settings mirror 可能过期），冲突时重读再重试一次；失败会把真实错误显示在状态行，而不是只写「保存失败」。

## 生效范围

| 对象 | 生效 |
|---|---|
| `pwsh` / `bash` 工具 | ✅ 每次 spawn 继承宿主 env |
| Web 侧栏终端、MCP server、子 agent | ✅ 同一宿主进程 |
| DSH 自己的 Node 运行时 | ❌ 已启动，不受影响 |
| 其它应用、另一个 DSH 进程 | ❌ 进程隔离 |

## 已知限制

- **不做按目录切版本。** 托管 shell 没有 per-call env，`fnm --use-on-cd` / `mise activate` 这类按
  `.node-version` 切换的行为无法复现。插件只**报告**这种不一致（`warnOnVersionFile`），不静默切换。
- **`toolchainAutoScan` 与 `discover` 重叠。** 两者都来自同一张内置表，重复目录只加一次；如果想让 PATH
  完全静态（只留手写清单），把两个都设成 `false`。
- **宿主 PATH 是行为契约，不是声明契约。** 如果将来 DSH 改成启动时快照环境、按白名单重建 PATH，
  或把 shell 挪到别的进程，插件会**静默变回没装**（失败方向是安全的：回到「找不到 node」，不会跑错二进制）。
  因此 `engines.dsh` 用收紧区间，升级 DSH 后请在新会话跑一次 `toolchain_env verify`。
- **空 PATH 段会被丢弃**（Windows 上空段等于「当前目录」，是隐患），`status` 会报告数量。
- **`status` 的段数是宿主进程的值。** pwsh 启动时会把自身安装目录加到 PATH 最前面（实测 +1），
  所以子进程里 `$env:Path` 的段数比 `status` 多 1；`verify` 才是「子进程实际解析」的基准。
- **面板保存的是配置，不是 PATH。** 生效发生在本进程：已经跑起来的子进程（例如你正开着的终端）不会回溯更新。
- 只覆盖本 profile；换 profile 需要再装一次。

## 安装

插件目录里执行安装（或 Plugins → Add plugin 选本地目录）：

```
plugin_manager install_bundle  target: <本包绝对路径>
```

装好后新开一个会话，左侧栏会出现「工具链」入口；`toolchain_env status` 应列出新增目录，
`toolchain_env verify` 应与 pwsh 的解析一致。
