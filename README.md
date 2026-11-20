# dsh-plugins

Inlve 的个人 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件集。

每个插件是一个独立的组合包（bundle），互不依赖，可以单独安装。所有包统一使用
`@inlve` 作用域。

> 非官方项目：与 deepseek-ai 无隶属关系，也不属于官方插件市场。

## 插件

| 插件 | 作用 | 版本 |
|---|---|---|
| [`@inlve/dsh-sandbox-guard`](packages/sandbox-guard) | 沙箱治理：① Windows 工作区权限前置检查 + **授权覆盖修复**（已存在的子目录补 ACE 与 Low 标签，可回滚）；② **信任目录**——把缓存等公共目录纳入沙箱可写范围（按工作区授权，硬禁止盘根/PATH/系统目录，风险项需二次确认）；③ 可配置的**提权策略**——预先认可的越界操作不再逐次打扰，每次放行记录 Agent 给出的理由 | 1.1.0 |
| [`@inlve/dsh-toolchain-env`](packages/toolchain-env) | 类 IDEA 的工具链设置：自动扫描 fnm/pnpm/pyenv/Volta/mise/winget… 等管理器，左侧栏面板里勾选、覆盖路径并保存即生效；把选中目录追加进 DSH 子进程的 PATH（受管 shell、终端、MCP、子 agent 共享），只追加不覆盖、退出即还原、每次变更留审计 | 0.2.0 |
| [`@inlve/dsh-mcp-panel`](packages/mcp-panel) | 左侧栏 MCP 服务器面板：列出 mcp-manager 的服务器与配置文件/插件提供的服务器，可添加、修改、停用、删除；绿/红状态点显示连接结果并在失败时给出简短原因，点状态点即重新检测，还能重启卡住的实例；添加/编辑是独立整页表单（分组卡片、参数/环境变量/请求头逐行增删） | 0.2.0 |

## 已弃用

[`@inlve/dsh-web-fetch-clash`](packages/web-fetch-clash/README.md)（最后版本 0.3.1）已弃用，不再推荐安装或继续维护。
官方 HTTP 抓取器已支持通过系统解析器和代理策略访问 Fake-IP TUN 目标，不再需要此兼容插件。
该变更记录在官方 **从 `v0.2.1-rc.2` 升级到后续版本**的迁移指南中；已在 DSH `0.2.2-rc.5` 环境验证卸载后 `web_fetch` 可访问 GitHub。
旧版用户应先升级 DSH，再按[迁移说明](packages/web-fetch-clash/README.md#迁移到官方-http-抓取器)卸载和清理残留配置。源码及旧说明保留供历史追溯。

## 安装

以下示例使用仍在维护的 MCP 面板；请勿再安装已弃用的 Clash 抓取插件。

方式一：DSH 的 Plugins 页 → Add plugin，填入 pnpm spec（支持 `github:` 子目录形式）。

方式二：`dsh` CLI：

```bash
dsh plugin --profile <profile> add "github:Inlve/dsh-plugins#path:packages/mcp-panel"
```

方式三：本地开发用软链：

```bash
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-plugins/packages/mcp-panel
```

安装后按各插件 README 的说明在 profile 的 `cordis.patch.yml` 里选择该插件，然后重启 DSH。

## 仓库结构

```text
.
├── packages/
│   ├── web-fetch-clash/          # 已弃用，保留历史源码
│   │   ├── index.js              # 宿主半边（零构建，纯 JS）
│   │   ├── client.js             # 客户端半边（Plugins 页可视化配置）
│   │   ├── cordis.patch.yml      # 插入插件行
│   │   ├── package.json
│   │   └── test/                 # node:test 单元测试
│   ├── sandbox-guard/           # @inlve/dsh-sandbox-guard
│   │   ├── index.js              # 宿主半边：检查/修复/信任目录/闸门/工具/命令
│   │   ├── lib/                  # 提权规则、信任分类与审计（纯函数 + 追加日志）
│   │   ├── scripts/acl.ps1       # 权限判定、DACL-only 修复、信任授权
│   │   ├── locale/、docs/、icon.svg
│   │   ├── cordis.patch.yml
│   │   └── test/
│   ├── toolchain-env/           # @inlve/dsh-toolchain-env
│   │   ├── index.js              # 宿主 PATH 组合、TTL 刷新、工具/命令、pwsh 探针
│   │   ├── lib/                  # PATH 组合、管理器发现、版本比较、审计
│   │   ├── locale/、docs/、icon.svg
│   │   ├── cordis.patch.yml
│   │   └── test/
│   └── mcp-panel/               # @inlve/dsh-mcp-panel
│       ├── index.js              # 宿主半边只占一行（页面全部走既有 Remote）
│       ├── client.js             # 侧栏入口 + MCP 管理页（状态点/增删改/探测）
│       ├── locale/、docs/、icon.svg
│       └── cordis.patch.yml
├── .github/workflows/check.yml   # CI：语法检查 + 单元测试
├── package.json                  # pnpm workspace 根
└── pnpm-workspace.yaml
```

## 开发

- 纯 JavaScript、零构建：没有 `src/`、没有编译步骤，`index.js` / `client.js` 直接运行。
- 不引入第三方运行时依赖；对 DSH 自带包的引用只出现在 `peerDependencies`（由 DSH 的模块解析路由到安装中的副本）。配置 schema 使用 `@deepseek-ai/schemastery`，客户端半边只 `require('react')`。
- 配置字段声明为 `.volatile()`，Plugins 页保存后立即生效，无需重启。

```bash
pnpm install          # 仅用于 workspace 链接，不需要安装运行时依赖
pnpm test             # node --test
pnpm check            # node --check
```

## 发布

```bash
git tag v0.2.0
git push origin main --tags
```

## 许可

[MIT](LICENSE) © Inlve
