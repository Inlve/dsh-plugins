# dsh-plugins

Inlve 的个人 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件集。

每个插件是一个独立的组合包（bundle），互不依赖，可以单独安装。所有包统一使用
`@inlve` 作用域。

> 非官方项目：与 deepseek-ai 无隶属关系，也不属于官方插件市场。

## 插件

| 插件 | 作用 | 版本 |
|---|---|---|
| [`@inlve/dsh-web-fetch-clash`](packages/web-fetch-clash) | 让 `web_fetch` 在 Clash / Mihomo Fake-IP（TUN）环境下正常工作：识别 fake-IP 占位符，向 Clash 复核真实解析，校验后固定连接；支持局域网白名单、校验缓存与 **Plugins 页可视化配置** | 0.2.2 |

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
│   └── web-fetch-clash/          # @inlve/dsh-web-fetch-clash
│       ├── index.js              # 宿主半边（零构建，纯 JS）
│       ├── client.js             # 客户端半边（Plugins 页可视化配置）
│       ├── cordis.patch.yml      # 插入插件行
│       ├── package.json
│       └── test/                 # node:test 单元测试
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
