# 工具链环境（toolchain-env）设计说明

> 0.2.0 起附带可视化设置页（左侧栏「工具链」）：清单、位置、自动发现都在页面里改，
> 保存后下一条命令生效。本文先讲机制，再讲清单语法、扫描、面板，最后是边界。

## 问题

DSH 的模型 shell 是 `pwsh -NoLogo -NoProfile -NonInteractive -Command`（POSIX 上是 `bash -c`）。
不加载 profile 是为了确定性，但代价是：**任何靠 profile 激活自己的工具链都不可见**。

在这台机器上，`fnm` 的激活写在第 3 行 profile 里：

```powershell
fnm env --version-file-strategy=recursive --use-on-cd --resolve-engines --shell powershell | Out-String | Invoke-Expression
```

DSH 不跑它，于是 `node`、`npm`、`npx`、`corepack`、以及所有 `npm i -g` 装出来的命令都不在 PATH 上。
用户 PATH 里其实已经有 `~/.cargo/bin`、`~/.pyenv/pyenv-win/shims`、WinGet Links、`~/go/bin`、
`~/.dotnet/tools`——说明「管理器把 bin 目录写进用户 PATH」这条路是可行的，只是 `fnm` 用的是 profile 钩子。

## 机制：为什么只能改宿主 PATH

子进程服务（`@deepseek-ai/dsh-subprocess`）的 `scrubbedParentEnv()` 每次 spawn 都遍历一次
`process.env`，剔除 credential 形状的变量名（`*KEY*`/`*PASSWORD*`/`*SECRET*`/`*TOKEN*`）与所有
`DSH_*`，**PATH 原样保留**。宿主进程的 PATH 就是全部子进程的默认 PATH。

因此插件的动作只有一次属性赋值：

```
Path = (baseline 去掉上次加的) + wanted        # append
```

`wanted` 是四个来源合并的结果（见下节）。`baseline` 只在第一次应用前采集一次，存进
`globalThis[Symbol.for('@inlve/dsh-toolchain-env')]`。每次重算都**从 baseline 重建**，而不是在当前值上追加
——这是幂等的来源：重载 N 次结果不变。

三个实现细节都来自这台机器的实测：

1. **键名是 `Path`，不是 `PATH`。** Windows 环境变量名大小写不敏感，但 `process.env` 里保留原始拼写。
   硬写 `process.env.PATH = …` 可能生成第二个键，子进程环境块里就会出现两条 PATH。所以先找已存在的键名
   再赋值；有多个时全部写同一个值，不新增。
2. **目录比较要折叠大小写**（`C:\Foo` 与 `c:\foo` 是一个目录），并在 Windows 上保留 `C:\` 这种盘根。
3. **空 PATH 段要丢弃。** Windows 上空段意味着「当前目录」，是隐患；`status` 报告丢弃了多少段。

### 一个容易误读的地方

`status` 报的是**宿主进程**的段数。实测：从 2 段的 PATH 启动 `pwsh -NoProfile`，子进程看到 3 段，
最前面是 `C:\Program Files\PowerShell\7`——pwsh 会把自身安装目录加到 PATH 最前面。所以

```
子进程 $env:Path 段数 = status.current + 1
```

这不影响追加语义（fnm 目录仍在末尾，不抢任何解析），但对比数字时要知道差在哪。
`verify` 直接反映子进程的实际解析，是判断「有没有生效」的可靠依据。

## 清单语法与合并（0.2.0）

面板把清单存成一个字符串字段 `toolchainEntries`，所以它必须同时是「人能写」和「机器能读」的。
语法与解析规则在 `lib/entries.js`（纯函数，有单测），client 半边镜像同一套规则（浏览器里不能 import node 模块）：

| 写法 | 含义 |
|---|---|
| id &#124; path &#124; note | 完整形式 |
| `path` | 只要有路径 |
| path &#124; note | 第一段像目录、第二段不像，按「路径 + 备注」理解 |
| `!…` 前缀 | 停用该行（面板的勾选框写这个），保留在文本里但不参与合并 |
| `#…` | 注释 |

「像目录」的判据是 `looksLikePath()`：盘符、UNC、开头的 `/` 或 `~`、`%VAR%`、或含路径分隔符。
这条规则决定了 `a | b` 是 `id | path` 还是 `path | note`，所以它被单测固定住。

合并顺序（也是 `prepend` 时的顺序）：旧 `pathEntries` → 内置表 `discover` → 面板清单 → `autoScan` 扫描目录。
去重键是 `keyOf()`（Windows 上折叠大小写），先出现的来源胜出；因此面板里重复写一个管理器目录不会让 PATH 出现两条。
停用的行既不进 `wanted`，也不进 `missing`——它只是没生效，不是配错。

`autoScan` 与 `discover` 出自同一张表，重叠部分靠上面的去重消掉；它真正的价值是把「内置表」和
「用户在面板上的选择」在语义上分开：`discover: false` 时仍可用 `autoScan: true` 恢复自动目录，
两个都关才是「PATH 只由手写清单决定」。

## 扫描与版本探测

`lib/scan.js` 复用 `lib/discover.js` 的 `MANAGERS` 表，但回答的是另一个问题：
不是「该加哪些目录」，而是「这台机器上有什么」。每个候选目录一行：

```
{ id, manager, label, note, template, path, unresolved, exists, entries, empty, commands, version, listed }
```

- `id` 在单目录管理器上就是 manager id；`pnpm` 有两个候选目录，写成 `pnpm#1` / `pnpm#2` 保证唯一。
- `template` 是表里的原始模板（`%APPDATA%\fnm\aliases\default`），`path` 是展开后的绝对路径。
  面板「加入」时存的是 `template`，所以清单保持可移植。
- `commands`：readdir 后按平台筛出可执行文件，取命令名、去重、排序、最多 6 个。
  Windows 只看 `.exe/.cmd/.bat/.com`；POSIX 收无扩展名文件，排除明显的数据扩展名。
- `version` **默认不取**：`scan versions` / `--versions` 才为每个已安装目录依次尝试前 6 个命令的
  `--version`，每个 3 秒超时。只 spawn 解析到 `.exe` 的命令——Node 不允许直接 spawn `.cmd`，
  而把文件系统来的路径交给 shell 换一个「参考性版本号」不值得。第一个能解析的候选常常是 npm 垫片，
  所以是「逐个试」而不是「只试第一个」。
- readdir 抛错（权限）只让该目录的 `commands` 为空，不让整次扫描失败。

`describe: false` 时跳过 readdir，只做 `exists`——PATH 组合走这条路：一次重算只需要 15 次 stat。

## 保存即生效：volatile + 签名

面板写的是 volatile 字段，运行时值是「稳定引用 + `.get()`」，所以保存不需要重启插件。
但重算只有两类触发点：文件系统的 TTL 检查（默认 30 秒）和 `tools/pre-execute`。
为了不让面板的改动等 30 秒，Host 在每次 `tools/pre-execute` 前比较一个**便宜的配置签名**
（`enabled`、`discover`、`managers`、`pathEntries`、清单文本、`autoScan`、位置），变了就立刻 `sync('config-change')`。
签名只读内存、不碰文件系统，代价可以忽略。

`toolchainPosition` 默认是空字符串而不是 `append`：空表示「跟随配置文件的 `position`」，
这样升级前写了 `position: prepend` 的 profile 不会被面板默认值悄悄改回 append。
`resolvePosition()` 是这条规则的唯一实现，`status` 会报告位置来自 `panel` 还是 `config`。

## 设置面板（client 半边）

`client.js` 走的是 DSH 的 client 插件约定（与 sandbox-guard 相同）：

- `package.json` 的 `dsh.client = { platform: 'web', immediately: true, inject: ['@deepseek-ai/dsh-client-ui-sidebar'] }`，
  并导出 `./client`。
- `sidebar.panellist` 只画图标（`id` + `label`）；页面注册在 keyed 根 slot `main`，`key` 与图标 id 相同，
  shell 点击时调 `layout.selectPanel(id)`。
- 表单读写走 `ctx.inject(['configForms'], child => child.configForms.get('toolchain-env'))`，
  条目 id 就是 `cordis.patch.yml` 里的 `toolchain-env`。store 的 `getSnapshot()` / `subscribe()` / `set(field, value)`
  都不需要 session id。
- 文案按 `ctx.locale.getLocale().active` 选 zh/en 字典（写在 client.js 里）。
- 自动发现是唯一需要会话的部分：它执行 `/toolchain scan --json`。拿不到会话时整块隐藏，
  清单编辑、保存、位置/自动发现开关全部照常工作。
- 页面用 `color-mix()` 继承主题前景色，只有主按钮是固定的 VSCode 蓝 `#0e639c`；路径一律等宽字体。

## 被否决的入口

| 入口 | 为什么不行 |
|---|---|
| per-call env | `pwsh` 工具 schema 没有 env 参数；env 分层是「terminal overrides → caller env → dshEnv」写死的 |
| `ctx.shellEnv.register` | 只接受 `DSH_*` 键（`dsh-shell-env/src/index.ts:122`） |
| `~/.dsh/.env` | app-boot 明确拒绝 `PATH`/`DSH_*`/`XDG_*` 这类决定进程启动的变量 |
| 替身执行器（自定义 `ctx.shell` provider） | 要替换出厂执行器，耦合深一个数量级；且只覆盖 shell，不覆盖终端/MCP/子 agent |
| 生成 `.cmd` 垫片 | 每个命令一个文件、有持久残留、需要监视目标目录重新生成；一条 PATH 目录即可覆盖 |
| 改注册表用户 PATH | 能覆盖所有应用，但改机器配置，且不解决按目录选版本 |

## 为什么单独一个插件，不并入 sandbox-guard

1. **组合风险**：sandbox-guard 按命令字符串预授权（`cargo fetch` → `danger-full-access`），
   命令串最终落到哪个二进制由 PATH 决定。两者合并后，PATH 配错一次就等于「预授权」变成
   「免审执行任意二进制」。
2. **guard 自身依赖 PATH**：guard 用裸名启动 `pwsh.exe` / `powershell.exe`，
   PATH 异常会让 ACL 修复跑偏。
3. **变更节奏不同**：PATH 随装/升级工具变（反射机器状态）；授权规则是信任决策，应该少变、可审计。
4. **失败方向不同**：guard 坏了 → 多问你几次（安全）；PATH 坏了 → 跑错二进制（不安全）。
   不该把不安全的那半，放进你依赖其正确性的那个组件里。

两个包零 import、独立发布，同仓库同一套 check/test。

## 升级风险与三道保险

已核对该安装（0.2.2-rc.5）的全部升级指南索引（v0.1.7-rc.2 → v0.2.2-rc.4）：
**没有任何一条改动 PATH、子进程环境构造或 subprocess env**。但这是观察结果，不是承诺。

- **声明面**（`Config`、`apply`、`ctx.effect`、`ctx.tools.register`、`ctx.commands.register`、
  `ctx.on('tools/pre-execute')`）受 DSH 兼容性闸门保护：`engines.dsh` 声明为
  `>=0.2.0-0 <0.3.0-0`，不兼容时 bundle 被 skip、启动时打印、保留原选择。**大声失败。**
  （DSH 的区间匹配是 `semver.satisfies(version, range, { includePrerelease: true })`，
  所以上界写 `-0` 才能挡住 `0.3.0-rc.1`。）
- **行为面**（`process.env` → 子进程 env）没有任何声明能保护，只能靠自检：
  `selfTestOnActivate` 在激活后真起一次 `pwsh -NoProfile` 探针，把「我以为」变成「我验证过」；
  `toolchain_env verify` 随时可手动跑。
- **发现表漂移**（fnm 改布局、pnpm 改全局 bin）：由 `status` 的 `missing` / `empty` 可见。

## 边界

- **不做按目录切版本。** 没有 per-call env，`.node-version` 的选择无法复现；
  `warnOnVersionFile` 只报告「工作区要求的 major 与管理器默认不同」，从不阻断。
- **生效范围是整个宿主进程**：所有子进程共享同一个 PATH，没有「只对某个会话生效」的概念。
  面板保存的是配置，已经跑起来的子进程不会回溯更新。
- **零持久化**：DSH 退出即还原；唯一留下的是审计文件与 profile 里的配置值。
- **`autoScan` 只扩大、不缩小发现范围**：它和 `discover` 同表，重叠靠去重消掉；
  想让 PATH 完全静态（只留手写清单）就把两者都设成 `false`。
- **版本号是参考值**：`scan --versions` 只 spawn 解析到的 `.exe`，`.cmd`/`.bat` 垫片与
  扩展名脚本一律跳过，所以某些目录会显示 `version: null`，这不是「没装」。
- 只管「可见性」。工作区外的**写入**（npm 缓存、`~/.agent-browser`、`target/`）属于权限问题，
  归 sandbox-guard 的提权规则，与本插件无关。
