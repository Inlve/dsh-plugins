# Changelog

All notable changes to this repository are documented here.

## [0.2.0] - 2026-11-20

### Changed

- `@inlve/dsh-mcp-panel` 的添加/编辑改成整页表单，按参考稿分组：名称、类型（右侧分段控件）、
  启动命令、参数/环境变量/请求头（逐行输入 + 删除图标 + 通栏「添加」按钮）、工作目录，
  高级组放启动超时、工具调用超时、断线重连、凭据模板展开与启用开关；保存按钮在右下角。
- 表单数据模型从文本域改为数组，编辑时保留原有未建模字段（`closeTimeoutMs`、`maxInstructionBytes` 等）。

### Fixed

- 主按钮（添加服务器）悬停时背景被通用 hover 规则覆盖成浅色而文字仍是白色，导致看不见：给
  `.mc-btn.primary:hover` 单独的更高优先级规则，悬停时背景变深、文字保持白色。
- 配置行（只读）现在带「配置行 / 只读」标签，和面板条目区分开，避免误以为缺少编辑/删除。

## [0.1.0] - 2026-11-20

### Added

- `@inlve/dsh-mcp-panel`：左侧栏 MCP 面板。服务器清单来自 mcp-manager 的
  `servers`（可增删改、停用、重启），实时状态走 `mcpManager.watch`，状态点绿/红
  并附失败原因，点击状态点执行一次 `mcpManager.probe`；配置行与插件注册的服务器
  只读展示加载阶段。保存通过 Settings Remote 写 profile 的 `mcp-manager` 行，
  即时协调、无需重启。

## [0.3.1] - 2026-11-03

### Fixed

- `web_fetch` 报 `cannot get property "credentials" without inject`：插件未声明 credentials 注入，
  Cordis 的服务代理拒绝了直接访问。改为先走无守卫的 `ctx.get('credentials')`，服务缺失或访问
  被拒绝时安静回退到环境变量/字面密钥，不再让抓取失败。

## [0.3.0] - 2026-11-03

### Added

- `secretRef` 配置：控制器密钥优先通过 DSH 凭据服务（`ctx.credentials.resolve`）读取，遵循
  DSH 的存储文件 > 启动环境 > 项目 `.env` > 家目录 `.env` 优先级；凭据服务缺失或引用未配置时
  回退到 `secretEnv` / `secret`。
- Plugins 页表单新增「凭据服务引用名」字段；README 说明 `$DSH_HOME/.credentials.yaml` 的写法
  与“非加密存储、只做 DSH 管理”的安全边界。

## [0.2.2] - 2026-11-03

### Added

- `secretEnv` 配置：优先从环境变量读取 controller 的 Bearer 密钥（默认 `DSH_CLASH_SECRET`），
  未设置时回退到 `secret` 字段；Plugins 页表单同步新增该字段。
- README 补充 Windows / macOS / Linux 环境变量差异（大小写、GUI 启动继承、`setx` 生效时机）。

## [0.2.1] - 2026-11-03

### Fixed

- 启用失败 `fakeCidrs must be a non-empty CIDR list`：DSH 0.2 的配置字段是 `Volatile` 引用，
  宿主现在先 `get()` 解包再校验；否则在线安装后插件行无法激活。

### Added

- bundle patch 现在同时把 `web.fetchProvider` 切到 `clash-dns`，在线安装即可用，不再需要手写
  profile YAML（覆盖整行配置，`searchProvider` 按默认 `deepseek-official` 一并写回）。
- 监听 `loader/volatile-update`：Plugins 页保存后立即重建 provider；非法编辑保留上一个可用运行时。

## [0.2.0] - 2026-11-03

### Added

- `@inlve/dsh-web-fetch-clash` 0.2.0
  - 可视化配置：Plugins 页本插件行的 Configure 页面，覆盖 controller / secret / resolve / connect / fakeCidrs / lanCidrs / cacheTtlMs 及各项上限
  - 配置 schema 使用 DSH 自带的 `@deepseek-ai/schemastery`（peer），字段 `.volatile()`，保存后立即生效
  - 手写 `client.js`（仅 `require('react')`，零构建、零第三方依赖）

## [0.1.0] - 2026-11-03

### Added

- `@inlve/dsh-web-fetch-clash` 0.1.0
  - Fake-IP aware `web.fetch` provider (`clash-dns`) for Clash / Mihomo TUN environments
  - System-first resolution so Windows Hosts entries keep working
  - Clash `/dns/query` verification with public-unicast validation and connection pinning
  - `connect: fake | real` transport selection
  - Per-host verification cache (`cacheTtlMs`) with failure invalidation
  - Explicit LAN allowlist (`lanCidrs`)
  - Unit tests and GitHub Actions syntax/unit check workflow
