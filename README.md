# dsh-plugins

Inlve 的个人 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件集。

每个插件是一个独立的组合包（bundle），互不依赖，可以单独安装。所有包统一使用
`@inlve` 作用域。

> 非官方项目：与 deepseek-ai 无隶属关系，也不属于官方插件市场。

## 插件

| 插件 | 作用 | 版本 |
|---|---|---|
| [`@inlve/dsh-web-fetch-clash`](packages/web-fetch-clash) | 让 `web_fetch` 在 Clash / Mihomo Fake-IP（TUN）环境下正常工作：识别 fake-IP 占位符，向 Clash 复核真实解析，校验后固定连接；支持局域网白名单、校验缓存、**Plugins 页可视化配置**与凭据服务 | 0.3.1 |
| [`@inlve/dsh-sandbox-guard`](packages/sandbox-guard) | 沙箱治理：① Windows 工作区权限前置检查 + **授权覆盖修复**（已存在的子目录补 ACE 与 Low 标签，可回滚）；② **信任目录**——把缓存等公共目录纳入沙箱可写范围（按工作区授权，硬禁止盘根/PATH/系统目录，风险项需二次确认）；③ 可配置的**提权策略**——预先认可的越界操作不再逐次打扰，每次放行记录 Agent 给出的理由 | 1.1.0 |
| [`@inlve/dsh-toolchain-env`](packages/toolchain-env) | 类 IDEA 的工具链设置：自动扫描 fnm/pnpm/pyenv/Volta/mise/winget… 等管理器，左侧栏面板里勾选、覆盖路径并保存即生效；把选中目录追加进 DSH 子进程的 PATH（受管 shell、终端、MCP、子 agent 共享），只追加不覆盖、退出即还原、每次变更留审计 | 0.2.0 |

## 安装

方式一：DSH 的 Plugins 页 → Add plugin，填入 pnpm spec（支持 `github:` 子目录形式）。

方式二：`dsh` CLI：

```bash
dsh plugin --profile <profile> add "github:Inlve/dsh-plugins#path:packages/web-fetch-clash"
```

方式三：本地开发用软链：

```bash
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-plugins/packages/web-fetch-clash
```

安装后按各插件 README 的说明在 profile 的 `cordis.patch.yml` 里选择该插件，然后重启 DSH。

## 仓库结构

```text
.
├── packages/
│   ├── web-fetch-clash/          # @inlve/dsh-web-fetch-clash
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
│   └── toolchain-env/           # @inlve/dsh-toolchain-env
│       ├── index.js              # 宿主 PATH 组合、TTL 刷新、工具/命令、pwsh 探针
│       ├── lib/                  # PATH 组合、管理器发现、版本比较、审计
│       ├── locale/、docs/、icon.svg
│       ├── cordis.patch.yml
│       └── test/
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
