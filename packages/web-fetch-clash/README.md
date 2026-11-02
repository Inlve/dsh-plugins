# @inlve/dsh-web-fetch-clash

让 DeepSeek Harness 的 `web_fetch` 在 **Clash / Mihomo 的 Fake-IP（TUN）环境**下正常工作：
识别 Fake-IP 占位符，向 Clash 复核真实解析，校验通过后再固定连接。

- 系统解析优先：**Windows Hosts 生效**，国内域名直连
- Fake-IP 命中时才问 Clash：**域名分流规则照常生效**（连接仍走 fake IP）
- 校验结果按 host 缓存：**同一域名重复抓取 0 次额外查询**
- 保留 SSRF 的地址类别校验，失败一律 fail closed

## 背景

DSH 的 `web_fetch` 在建立连接前要求域名解析结果是**公共单播地址**，否则拒绝：

```
URL hostname "api.github.com" resolves to a non-public IP address
```

而 Clash / Mihomo 在 TUN 模式下使用 Fake-IP：未命中 `fake-ip-filter` 的域名会被解析成
`198.18.0.0/15`（RFC 2544 保留段）里的占位地址，于是抓取全部被拒。这个防护本身是必要的
（防提示注入导致的 SSRF），不能简单关掉。

## 原理

```text
web_fetch(url)
  ├─ 系统解析（读 Hosts；Fake-IP 域名得到 198.18.x）
  ├─ 全部公共地址（含 Hosts 指向公网 IP）
  │     → 钉住地址直接连接（不查 Clash）
  ├─ 全部 Fake-IP
  │     ├─ 缓存命中（cacheTtlMs 内校验过）→ 直接用
  │     └─ 缓存未命中 → GET /dns/query?name=...&type=A|AAAA
  │           → 校验返回地址全部为公共单播 → 缓存 → 连接
  └─ 私网 / Fake-IP 与真实混合 → 拒绝
```

`/dns/query` 是 Mihomo 的 REST API，走的是内核 resolver（`ExchangeContext`），**不经过
Fake-IP 处理**，因此能返回上游真实答案：

```text
系统 DNS:   api.github.com → 198.18.0.36
/dns/query: api.github.com → 172.182.252.137
```

### 连接策略

| `connect` | 实际连接 | 效果 |
|---|---|---|
| `fake`（默认） | 198.18.x | Clash 用 Fake-IP → 域名映射转发，**DOMAIN 规则、代理组照常生效** |
| `real` | 校验过的真实 IP | 无二次解析窗口；但路由器只能按 IP 匹配规则（可配合 Clash `sniffer`） |

## 配置

| 字段 | 默认值 | 说明 |
|---|---|---|
| `controller` | `http://127.0.0.1:9090` | Clash external-controller 地址 |
| `secret` | 空 | controller 的 Bearer 密钥 |
| `resolve` | `auto` | `auto` = 系统解析优先；`clash` = 全部问 Clash（不读 Hosts） |
| `connect` | `fake` | 见上表 |
| `fakeCidrs` | `198.18.0.0/15, fdfe:dcba:9876::/48, 2001:2::/48` | Fake-IP 池，需与路由器一致 |
| `lanCidrs` | 空 | 局域网白名单（让 Hosts 里的内网条目可抓取） |
| `cacheTtlMs` | `60000` | 校验缓存，0 = 关闭 |
| `queryTimeoutMs` | `4000` | 单次 controller 查询预算（超时重试一次） |
| `timeoutMs` | `30000` | 抓取超时 |
| `maxResponseBytes` | `5000000` | 响应字节上限 |
| `maxBodyChars` | `100000` | 正文字符上限 |
| `maxRedirects` | `5` | 同源重定向跳数 |
| `userAgent` | `deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)` | UA |

```yaml
- insert:
    - id: web-fetch-clash
      name: '@inlve/dsh-web-fetch-clash'
      config:
        controller: http://192.168.0.1:9090
        secret: <你的 secret>
        resolve: auto
        connect: fake
        cacheTtlMs: 60000
        lanCidrs: '192.168.0.0/16'
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: deepseek-official   # 覆盖整行配置，必须一并写回
    fetchProvider: clash-dns
```

## 可视化配置

安装并重启 DSH 后，Plugins 页里本插件行会出现 **Configure**：

- 表单覆盖上表全部字段，secret 以密码框显示；
- 字段声明为 `.volatile()`，**保存后立即生效，不需要重启**；
- 保存写入的就是 profile 里的插件行配置（与手写 YAML 等价）；
- 客户端在提交前做基础校验（数字范围、`http(s)://` 前缀、Fake-IP 池非空），非法输入不会提交。

实现上零第三方依赖：主机端 schema 使用 DSH 自带的 `@deepseek-ai/schemastery`（列在
`peerDependencies`，由 DSH 的模块解析路由到安装中的副本）；客户端半边是手写的
`client.js`，只 `require('react')`，没有 npm 依赖、没有构建步骤。

## 安装

```bash
# 方式一：DSH CLI
dsh plugin --profile <profile> add "github:Inlve/dsh-plugins#path:packages/web-fetch-clash"

# 方式二：Plugins 页 → Add plugin，填同一条 spec
```

然后在 profile 的 `cordis.patch.yml` 里按上面的 YAML 选择 `fetchProvider: clash-dns`，
**重启 DSH**。

## 验证

```powershell
# 系统解析是 fake，Clash 的 /dns/query 是真实地址
Resolve-DnsName api.github.com
curl.exe -H "Authorization: Bearer <secret>" "http://192.168.0.1:9090/dns/query?name=api.github.com&type=A"
```

重启后：

- `https://api.github.com/` → 200
- `https://www.baidu.com/` → 200（走真实 IP，不查 Clash）
- `http://127.0.0.1:1/` → 仍被拒（`is not a public address`）

## 安全边界

- **地址类别校验保留**：Clash 返回的真实解析必须全部是公共单播，否则拒绝；私网/回环/保留段
  一律 fail closed。
- **字面 IP 仍被校验**：`http://127.0.0.1/`、`http://169.254.169.254/` 不会因为插件放行。
- **`lanCidrs` 是显式放宽**：一旦开启，该网段内的目标不再被拦截（用于 Hosts 的本地服务）。
- **不防 DNS 污染**：插件信任 Clash 的上游 DNS；污染防护依赖 DoH/DoT 与 TLS，DSH 不负责。
- **`connect: fake` 有二次解析窗口**：连接时 Clash 会按自己的映射再解析一次（TTL 可能很短）。
  需要严格时用 `connect: real`，或配合 Clash `sniffer` 保留域名规则。
- **真实解析落在 Fake-IP 段**：无法与占位符区分，插件会拒绝（fail closed）。

## 已知限制

- `resolve: clash` 或缓存未命中时依赖 controller；路由器不可达会让外网抓取失败。
- 缓存 TTL 内不再复核；连接失败会立即失效该条目。
- 本机 Hosts 指向内网地址时需要配置 `lanCidrs`。
- Fake-IP 池变化（路由器更换配置/重启）后若连接失败，缓存会失效并重新校验。

## 许可

[MIT](../../LICENSE) © Inlve
