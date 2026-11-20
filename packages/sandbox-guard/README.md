# @inlve/dsh-sandbox-guard

在 Windows 上，让 DSH 的沙箱在**第一次运行受限命令之前**就把工作区权限准备到位：检查并补齐
沙箱写入授权所需的前置条件，而不是等 `sandbox-local` 报错、shell 不可用之后再回头修。

- 提前：插件加载后扫描全部已注册工作区，新会话创建时检查其工作目录
- 有序：会话内第一次调用工具前会等这次检查完成，修复不会和第一条命令抢时间
- 最小：只给当前登录用户补「完全控制」，不删权限项、不改所有者、不动 Deny 与完整性标签
- 可回滚：每次修改前备份原 DACL，并生成独立的恢复脚本
- 可手动：`/acl` 命令 + `workspace_acl` 工具

## 背景

DSH 的 Windows 沙箱（`@deepseek-ai/dsh-sandbox-windows-acl`）在某个工作区第一次运行受限命令时，
会用一次 `SetNamedSecurityInfoW` 写入沙箱授权：一个沙箱能力 SID 的允许项、一条 Everyone 的
`FILE_DELETE_CHILD` 拒绝、一条 Low 完整性标签。

这次写入要求目录同时满足：

1. 当前登录用户是目录的**所有者**；
2. 目录 ACL 授予当前用户 **WRITE_OWNER（取得所有权）**。

而「所有者」身份本身只隐含 **READ_CONTROL** 和 **WRITE_DAC**，不含 WRITE_OWNER。所以当一个
工作区的 ACL 只有「修改」权限（从别处复制来的目录、由安装器创建的目录、或者父目录只给 Modify
时新建的目录），沙箱授权写入就会失败：

```text
Win32 5 (拒绝访问)  →  sandbox-local 无法供给 →  该工作区里的每条受限命令在启动前失败
```

实测本机根因就是父目录只给 Modify：`D:\Projects`、`D:\Projects\Repos` 对当前用户没有
WRITE_OWNER，于是它们下面新建的每个目录都继承不到——这解释了为什么「新工作区」会反复踩同一个坑。

## 判定与修复

| 判定 | 含义 | 处理 |
|---|---|---|
| `ready` | 是所有者，且已具备更改权限 + 取得所有权 | 不动 |
| `needs-grant` | 是所有者、有更改权限，但缺取得所有权 | 给当前用户补完全控制 |
| `blocked` | 既非所有者、又无更改权限 | 只报告，不夺取所有权 |
| `null-dacl` | DACL 为 NULL（所有人完全控制） | 跳过，往里加权限项会变成「只有这一条」 |
| `reparse-point` / `not-directory` / `missing` | 不是普通目录 | 只报告 |

修复动作只有一步：给当前用户补一条**可继承的完全控制**。同身份已有权限项时会合并成一条，
不产生重复项。

写入走 `SetNamedSecurityInfoW` 的 **DACL 段**：不需要 `SeSecurityPrivilege`，也不会把沙箱的
Low 完整性标签（SACL）写坏——这是 PowerShell `Set-Acl` 做不到的，它会连带持久化 SACL。

## 自动运行时机

1. 插件加载约 2.5 秒后，扫描工作区注册表里的全部工作区；
2. 每个新会话创建时，检查该会话的工作目录；
3. 会话内第一次调用工具前，如果该目录还没检查过，会等检查（必要时修复）完成再放行。

第 3 条按「会话 + 目录」只做一次，最多等 20 秒；等不到也不会阻塞工具。同一路径结果缓存
60 秒。`autoRepair: false` 时只检查、不修改。

## 使用

对话里输入：

```text
/acl                       检查当前会话的工作目录
/acl prepare               修复当前会话的工作目录
/acl prepare-all           修复所有已注册工作区
/acl status D:\path\to\ws  检查指定目录
```

智能体工具 `workspace_acl`：`action` 取 `status` / `prepare` / `prepare_all`，`path` 可选
（默认当前会话工作目录）。适合在刚新建或选定工作区之后、运行第一条命令之前调用。

## 授权覆盖（reach）

沙箱授权是**一个常驻 ACE + 一条 Low 标签，落在工作区根上**：之后新建的子目录会继承，但**授权前已存在的子目录不会**——于是根目录显示 `ready`，构建却写不进 `src-tauri/target`、`dist`、`.git`。

- `workspace_acl` 的 `reach`：只读扫描，报告多少目录缺 ACE / 缺标签。
- `reach_repair`：把根上已有的 ACE 与标签原样补到缺失目录，逐个回读校验，写备份与回滚脚本。
- 命令：`/acl reach`、`/acl reach-repair`。

SID、掩码、继承标志全部从根上读写出来，不自行推导；根上还没有授权时直接跳过。

> 注意：沙箱边界是**会话启动时的工作区**，`working_directory` 切目录不会把边界搬过去。验证某个工作区的覆盖，要由在该工作区启动的会话来做。

## 提权策略（高于工作区、低于完全权限）

沙箱只有三档，但每个受约束的工具都支持**单次提权**（`pwsh` / `bash` / `write` / `edit` 的 `sandbox_permissions` + `justification`）。这一步正常会弹审批；把规则配好之后，命中就直接放行，不命中照旧问你。

```yaml
escalation:
  enabled: true
  rules:
    - id: cargo-fetch
      title: cargo 拉取依赖（需要联网）
      tools: [pwsh, bash]
      commandPattern: '^cargo\s+fetch(\s+[^\s]+)*$'
      maxMode: danger-full-access
    - id: npm-ci-noscripts
      title: npm 安装依赖但不跑生命周期脚本
      tools: [pwsh, bash]
      commandPattern: '^npm\s+ci\s+--ignore-scripts(\s+[^\s]+)*$'
      maxMode: danger-full-access
```

（本仓库的 bundle patch 里就是这两条，装好即生效；Plugins 页里改会覆盖它。）

不建议放行 `cargo build` / `npm install`：两者都会执行仓库里的构建脚本，放行一条命令等于放行任意代码。

护栏：默认关闭；命令含 `;` `|` `&` `<` `>` 反引号 `$(` 一律不自动放行；工作目录默认必须在会话工作目录内；`maxMode` 缺省为最窄档；规则解析失败会被丢弃并报错，不做宽松兜底。

每次提权写入 `<reportDir>/escalations.jsonl`，包含会话、调用 id、命令/路径、命中规则和 **Agent 给出的理由**。查看方式：`escalation_policy` 工具（`list` / `test` / `audit`）或 `/grants` 命令。

> 审批是 waterfall：如果还有别的更宽的回答者排在前面，本插件用 `prepend` 保证自己先判；但**未命中**的提权仍会落到那个回答者那里。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖 `sandbox-guard` 行，或在 Plugins 页里改：

| 字段 | 默认 | 说明 |
|---|---|---|
| `autoRepair` | `true` | 发现缺取得所有权时直接补权限；`false` 只检查 |
| `checkOnSessionStart` | `true` | 新会话检查工作目录，并启用首次工具调用前的闸门 |
| `scanOnActivate` | `true` | 插件加载后扫描全部已注册工作区 |
| `reportDir` | `~/.dsh/sandbox-guard` | 备份与历史记录目录 |
| `powershell` | 空 | 指定 PowerShell；空则先试 `pwsh.exe`，再试 `powershell.exe` |
| `timeoutMs` | `180000` | 单次检查/修复超时 |
| `cacheTtlMs` | `60000` | 同一路径结果缓存时间 |
| `escalation.enabled` | `false` | 是否让规则替代人工审批 |
| `escalation.rules` | `[]` | 规则列表，字段见上一节 |

## 安全与回滚

- 不删除任何权限项，不改所有者，不动 Deny、SACL、继承标志；
- 修改前把原 DACL 写进 `reportDir/acl-backup-*.json`，并生成同名 `.restore.ps1`；
- 修改后重新读取 ACL 校验，不通过就用备份 DACL 原样还原；
- 每次检查/修复向 `reportDir/history.jsonl` 写一行记录。

恢复命令会在工具/命令输出里直接给出：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<restore.ps1>" -Path "<目录>" -RuleJson "<backup.json>"
```

## 限制

- 仅 Windows；其他平台返回 `unsupported`。
- 第一次给大目录加可继承权限项会触发整树传播，可能数十秒。
- 原权限项若是继承来的，修复后该用户会有一条显式完全控制项，不再随父目录变化。
- 有覆盖 WRITE_OWNER 的 Deny 时修复无效：会用备份 DACL 撤销并报 `repair-not-effective`。
- 插件运行在 DSH 宿主进程内、不受会话沙箱约束（改权限必须如此）；安装即信任。

## 信任目录（缓存等公共可写根）

受限命令只能写工作区和会话私有临时目录。工具把缓存留在默认位置（`%LOCALAPPDATA%\npm-cache`、`~\.cargo` 等）时，命令会在沙箱里失败。

`trust.roots` 让指定目录**带上与工作区相同的沙箱写授权**——能力 SID 的 allow ACE + Low 完整性标签，两者都从当前工作区根**读出来复制**，不自行派生：

```yaml
trust:
  roots:
    - path: '%LOCALAPPDATA%\npm-cache'
      note: npm 缓存
    - path: '%LOCALAPPDATA%\pnpm'
      note: pnpm 全局
  autoGrantOnSessionStart: true
```

- **授权按工作区签发**：同一个目录要在多个工作区可写，就分别补一次（会话启动时自动补，幂等）。
- **每条授权都会降低该目录的完整性等级**——任何低完整性进程都能写，不只是 DSH。所以：
  - 硬禁止：盘根、用户主目录及其祖先、PATH 上的目录、`C:\Windows`、`Program Files`；
  - 风险项需显式确认：`%LOCALAPPDATA%`/`%APPDATA%` 根、顶层含可执行文件、包含当前工作区的目录 → 必须 `acknowledgeRisk: true`。
- 入口：`workspace_acl` 的 `trust_list` / `trust_check` / `trust_grant` / `trust_revoke` / `trust_self_test`，以及 `/trust` 命令。
- 每次授权写 DACL/标签备份与 `.restore.ps1`；撤销只删该工作区 SID 的 ACE，仅在目录上不再有任何能力 ACE 时清标签。

## 界面

左侧栏多一个「沙箱信任」图标入口；点它会在**主区域**打开完整页面（`sidebar.panellist` 只提供图标与标签，`main` 提供页面）。

页面是一个 VSCode 设置风格的编辑器：

- 「信任目录」列表：每行一个目录（等宽字体）+ 备注 + `!ack` 标记 + 移除按钮；
- 底部输入框添加新目录（支持 `%VAR%`），回车即加；
- 顶部「保存 / 还原」与保存状态；有未保存更改时提示；
- 「授权状态」区可刷新（需要能拿到会话；**编辑本身不需要会话**）；
- 折叠的帮助区列出风险、硬禁止目录、需确认的目录与生效范围。

**两层结构**：

| 层 | 谁管 | 何时 |
|---|---|---|
| 信任清单（全局偏好） | 面板写入 volatile 配置 `trustRoots` | 立即保存，无需重启 |
| 写入授权（按工作区） | Host 读清单后对工作区打 ACE + 标签 | 下一次命令、或新会话；启动后还会对已注册工作区补一次 |

因此面板**完全不需要 session id**。撤销仍只移除该工作区的能力 ACE。

**移除对账**：清单里删掉一条后，Host 会在下一次命令/启动时对**所有已注册工作区**撤销该目录的 ACE；当目录上不再有任何工作区的能力 ACE 时，同时清掉 Low 标签。上一次的清单存在 `~/.dsh/sandbox-guard/last-trust-roots.json`，用于比对。

## 许可

[MIT](../../LICENSE) © Inlve
