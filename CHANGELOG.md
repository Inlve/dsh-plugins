# Changelog

All notable changes to this repository are documented here.

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
