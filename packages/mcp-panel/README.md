# @inlve/dsh-mcp-panel

A visual MCP server manager for the DeepSeek Harness Web GUI: one sidebar page
that lists the host's MCP servers, adds, edits, disables and deletes them, and
shows each server's connection result as a green/red status dot with a short
failure reason. Clicking the dot probes that server again.

## Where it shows up

- A **MCP** entry in the left sidebar (a global panel, not tied to a session).
- Selecting it opens the page in the main column; **← 返回对话** returns to the
  conversation.
- The bundle also appears in **Plugins** like any other bundle.

## What the page does

| Area | Behavior |
| --- | --- |
| Server list | Every server in the volatile `mcp-manager.servers` map, plus servers an installed plugin registers (marked `插件注册`), plus the `@deepseek-ai/dsh-mcp-client` rows other configuration layers supply (read-only, with their Loader phase). |
| Status dot | Green: connected (shows the tool count). Amber: connecting, reconnecting, or waiting for credentials. Red: failed, with the reason (`重连次数用尽`, `加载失败`, …) and the last error. Grey: disabled or never checked. |
| Click the dot | Runs a one-shot probe (connect, list tools, close) on the host and keeps the result until the live state changes. |
| 重启 | Rebuilds that server's instance and resets its reconnect budget. |
| 编辑 / 停用 / 删除 | Writes the entry through the Settings Remote; the host reconciles at once, with no restart. |
| 添加服务器 / 编辑 | Opens a full-page form: grouped cards, `类型` as a right-aligned segmented control, one input row per argument, and key/value rows with a delete icon plus a full-width **添加** button for arguments, environment variables and headers. A third card holds the advanced fields (startup timeout, tool call timeout, reconnect, `credential` templates, enabled). **保存** sits at the bottom right. |
| Search | Filters by name, command line, or URL once more than three servers exist. |
| 配置行与插件提供的服务器 | Read-only section: static `dsh-mcp-client` rows report a Loader phase (loaded / loading / failed with its diagnostic), not connectivity. |

## Where servers are stored

The page edits the `mcp-manager` entry's `servers` field in the profile's
`cordis.patch.yml` through the `settings` Remote. Saving is one revision-checked
write; the host then mounts, rebuilds, or unmounts exactly the entry that
changed. The page itself persists nothing.

A name must be unique, because it is also the MCP tool namespace. A static
`dsh-mcp-client` row with the same name wins the namespace, and the managed
entry then fails with a "name taken" style error, which the dot reports.

Secrets belong in the credentials store: use `${credential:NAME}` in `env` or
`headers` values instead of writing the value into the configuration.

## Known limits

- Static `@deepseek-ai/dsh-mcp-client` rows (for example the ones magpie writes)
  are read-only here: moving one into the panel means deleting that row from
  `cordis.patch.yml` and recreating it with **添加服务器**.
- A probe starts a real process for a STDIO server, so **依次检测** runs them one
  after another rather than all at once.
- No OAuth flow: a server that answers with an authorization challenge is shown
  as a connection failure.
- The panel manages the manager plane only; MCP instances composed by an agent
  preset are not listed.
